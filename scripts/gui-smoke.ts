/**
 * GUI-Smoke — faehrt die 9 Pruefpunkte aus docs/SMOKE.md gegen ein LAUFENDES Obsidian
 * (CORE-TEST-02 b), Zweitinstanz-Rezept aus der Dach-AGENTS.md § Staging-Vaults.
 *
 * A1-A5: Schluesselbund (Settings-Tab, Preset, Token setzen/entfernen, Endpunkt entfernen).
 * B1-B3: API (list/resolve/models) gegen einen im Treiber selbst laufenden Fake-Endpunkt
 *        (koda-agent-Muster `startFakeEndpoint`) — unabhaengig davon, ob irgendwo ein
 *        echter LLM-Server laeuft.
 * C1:    Restricted-Mode-Guard eines frischen Zweitinstanz-Profils.
 *
 * ## Zweitinstanz (eigenes Profil, eigener Port — NICHT die reguläre Instanz anfassen)
 *
 *   echo "$STAGING_VAULTS_DIR"                                         # muss gesetzt sein
 *   npm run build && npm run smoke:gui -- --setup
 *   UD=/tmp/obs-test-llm-endpoint-manager; mkdir -p "$UD"
 *   lsof -nP -iTCP:9346 -sTCP:LISTEN && echo "Port belegt — anderen nehmen"
 *   node -e 'const p=process.env.STAGING_VAULTS_DIR+"/llm-endpoint-manager";require("fs").writeFileSync(process.argv[1]+"/obsidian.json",JSON.stringify({vaults:{"llm-endpoint-manager":{path:p,ts:Date.now(),open:true}}}))' "$UD"
 *   cp ~/Library/Application\ Support/obsidian/obsidian-*.asar "$UD"/   # aktuelle Version statt gebuendelter (minAppVersion 1.11.4)
 *   /Applications/Obsidian.app/Contents/MacOS/Obsidian --user-data-dir="$UD" --remote-debugging-port=9346 &
 *   python3 ~/.claude/hooks/obsidian-cdp-lock.py acquire --label llm-endpoint-manager --intent "GUI-Smoke Task 13" --exclusive focus --ttl 300
 *   npm run smoke:gui -- --port 9346
 *   python3 ~/.claude/hooks/obsidian-cdp-lock.py release
 *
 * Ein frisches Profil startet im Restricted Mode — C1 schaltet ihn per
 * `app.plugins.setEnable(true)` frei, bevor irgendetwas anderes gemessen wird.
 *
 * Typen: `tsconfig.scripts.json` (im `gate` ueber `npm run typecheck:scripts`).
 */
import { createServer, type Server } from "node:http";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cwd } from "node:process";
import type { AddressInfo } from "node:net";

import { Cdp, attachTo, clickReal, pollUntil, requireVisible } from "../../tools/obsidian-cdp/cdp.js";
import { buildVault, stagingVaultDir } from "../../tools/obsidian-cdp/vault.js";

const REPO_NAME = "llm-endpoint-manager";
const PLUGIN_ID = "llm-endpoint-manager";
const REPO_ROOT = cwd();
const FIXTURE_DIR = join(REPO_ROOT, "fixtures/vault");

type Zustand = "gruen" | "rot" | "uebersprungen";
interface Check { name: string; zustand: Zustand; detail: string }
const checks: Check[] = [];
function record(name: string, passed: boolean, detail: string): void {
  checks.push({ name, zustand: passed ? "gruen" : "rot", detail });
  console.log(`${passed ? "  ✓" : "  ✗"} ${name} — ${detail}`);
}
function skipped(name: string, reason: string): void {
  checks.push({ name, zustand: "uebersprungen", detail: reason });
  console.log(`  · ${name} — übersprungen: ${reason}`);
}

const q = (s: unknown): string => JSON.stringify(s);

// --- Fake-Endpunkt (koda-agent-Muster) -------------------------------------------------
/**
 * Eigener Mini-HTTP-Server statt eines evtl. laufenden echten LLM-Servers: die B-Punkte
 * pruefen die API-Schicht (list/resolve/models, Cache), nicht einen echten Provider. Ein
 * fester Port waere zerbrechlich (belegt/frei je nach Rechner) — `listen(0, …)` laesst das
 * OS einen freien waehlen, `close()` gibt ein Promise, weil B3 denselben Server-Zustand
 * (Port) fuer die Wieder-Erreichbarkeits-Probe braucht.
 */
async function startFakeEndpoint(): Promise<{ url: string; close: () => Promise<void> }> {
  const server: Server = createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      req.url?.includes("/v1/models") === true
        ? JSON.stringify({ data: [{ id: "smoke-model", object: "model" }] })
        : JSON.stringify({ ok: true }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => { server.close(() => { resolve(); }); }),
  };
}

// --- Settings-Stelle: Modal (< 1.13) oder eigenes Fenster (>= 1.13) --------------------
/** Uebernommen aus anysource-sideloader/scripts/gui-smoke.ts (Modal-vs-eigenes-Fenster-
 *  Unterscheidung), 2026-09-15 — Obsidian 1.13 macht aus den Einstellungen ein eigenes
 *  Fenster ohne `window.app`; DOM-Pruefungen laufen deshalb ueber `stelle`, Zustands-
 *  Pruefungen (Plugin-Settings, Secrets, API) immer ueber die Workspace-Verbindung `cdp`. */
interface SettingsStelle {
  cdp: Cdp;
  eigenesFenster: boolean;
  el: (ausdruck: string) => string;
}
async function settingsStelle(cdp: Cdp, port: number): Promise<SettingsStelle | null> {
  const alsModal = await cdp.evaluate<boolean>(`return Boolean(document.querySelector(".modal.mod-settings"));`);
  if (alsModal) {
    return {
      cdp,
      eigenesFenster: false,
      el: (ausdruck) => `(() => { const root = document.querySelector(".modal.mod-settings"); if (!root) return null; return (${ausdruck}) ?? null; })()`,
    };
  }
  const fenster = await attachTo("settings", port, REPO_NAME);
  if (!fenster) return null;
  return {
    cdp: fenster,
    eigenesFenster: true,
    el: (ausdruck) => `(() => { const root = document; return (${ausdruck}) ?? null; })()`,
  };
}

async function openSettings(cdp: Cdp, port: number): Promise<SettingsStelle> {
  await cdp.evaluate(`
    app.setting.open();
    await new Promise((r) => setTimeout(r, 500));
    app.setting.openTabById(${q(PLUGIN_ID)});
    await new Promise((r) => setTimeout(r, 1000));
    return true;
  `);
  const stelle = await settingsStelle(cdp, port);
  if (!stelle) throw new Error("Kein Einstellungen-Fenster/Modal gefunden.");
  if (stelle.eigenesFenster) await requireVisible(stelle.cdp).catch(() => undefined);
  return stelle;
}

function closeSettings(cdp: Cdp, stelle: SettingsStelle): void {
  if (stelle.eigenesFenster) stelle.cdp.close();
  else void cdp.evaluate(`app.setting.close(); return true;`).catch(() => undefined);
}

/** Settings-Ansicht neu aufbauen (nach einer Mutation, damit ein Re-Render sicher gesehen
 *  wird) — schliesst dabei die VORHERIGE Verbindung, wenn sie ein eigenes Fenster war, sonst
 *  bleibt eine verwaiste WebSocket-Verbindung auf demselben Fenster offen. */
async function reopenSettings(cdp: Cdp, port: number, previous: SettingsStelle | null): Promise<SettingsStelle> {
  if (previous?.eigenesFenster) previous.cdp.close();
  return openSettings(cdp, port);
}

// --- Kleine DOM-Helfer (immer ueber stelle.el) ------------------------------------------
async function count(stelle: SettingsStelle, selector: string): Promise<number> {
  const r = await stelle.cdp.evaluate<{ n: number | null }>(`return { n: ${stelle.el(`root.querySelectorAll(${q(selector)}).length`)} };`);
  return r.n ?? 0;
}

/** Ein `.clickable-icon`-Button einer Zeile ueber sein `aria-label` treffen (das `setTooltip`
 *  auf `extraSettingsEl` setzt) statt ueber seine Position — die Reihenfolge der Icons haengt
 *  von asynchron nachgeladenen Elementen ab (Modell-Refresh-Knopf laedt erst nach dem
 *  Cache-Promise), Text ist stabil. `text` matcht exakt gegen EN- oder DE-String. */
async function clickIconByLabel(stelle: SettingsStelle, rowExpr: string, textEn: string, textDe: string): Promise<boolean> {
  return (await stelle.cdp.evaluate<{ ok: boolean }>(`
    const row = ${stelle.el(rowExpr)};
    if (!row) return { ok: false };
    const btn = Array.from(row.querySelectorAll(".clickable-icon")).find((b) => {
      const label = b.getAttribute("aria-label") || "";
      return label === ${q(textEn)} || label === ${q(textDe)};
    });
    if (!btn) return { ok: false };
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    return { ok: true };
  `)).ok;
}

function setup(): void {
  const vaultDir = stagingVaultDir(REPO_NAME);
  const log = buildVault({ repoRoot: REPO_ROOT, vaultDir, fixtureDir: FIXTURE_DIR, pluginId: PLUGIN_ID });
  console.log(`Staging-Vault gebaut: ${vaultDir}`);
  for (const l of log) console.log(`  · ${l}`);
  console.log(
    "\nZweitinstanz starten (Rezept im Dateikopf), dann:\n" +
    "  npm run smoke:gui -- --port 9346",
  );
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("--setup")) { setup(); return; }
  const flag = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i === -1 ? undefined : argv[i + 1];
  };
  const port = Number(flag("port") ?? 9346);

  console.log(`GUI-Smoke llm-endpoint-manager — Obsidian auf Port ${port}`);
  const cdp = await attachTo("workspace", port, REPO_NAME);
  if (!cdp) {
    throw new Error(
      `Kein Obsidian-Hauptfenster auf Port ${port} fuer Vault „${REPO_NAME}". ` +
      "Laeuft die Zweitinstanz mit --remote-debugging-port? (siehe Kopfkommentar)",
    );
  }

  let fake: { url: string; close: () => Promise<void> } | null = null;
  let settings: SettingsStelle | null = null;

  try {
    if (process.platform === "darwin") {
      try {
        execFileSync("osascript", ["-e", 'tell application "Obsidian" to activate']);
        await new Promise((r) => setTimeout(r, 1500));
      } catch { console.log("  (Hinweis: osascript activate schlug fehl — Fenster ggf. von Hand nach vorn holen)"); }
    }
    await requireVisible(cdp);

    const vaultName = await cdp.evaluate<string>(`return window.app ? app.vault.getName() : "";`);
    if (!vaultName) throw new Error("Obsidians `app` ist im Renderer nicht erreichbar.");
    console.log(`Vault: ${vaultName}\n`);

    // --- C1: Restricted-Mode-Guard -------------------------------------------------
    console.log("C · Zweitinstanz-Grundlage");
    // Plugin neu laden, BEVOR irgendetwas gemessen wird: Obsidian haelt main.js im Speicher,
    // ein frisch deploytes Bundle wirkt sonst erst nach einem manuellen Reload (koda-agent-
    // Lehre, LESSONS 2026-09-03). War es noch nicht aktiv (Restricted Mode), scheitert dieser
    // Aufruf leise — C1 uebernimmt dann das Freischalten.
    await cdp.evaluate(`
      try {
        await app.plugins.disablePlugin(${q(PLUGIN_ID)});
        await app.plugins.enablePlugin(${q(PLUGIN_ID)});
      } catch { /* noch nicht aktiv — C1 schaltet frei */ }
      return true;
    `);
    let geladen = (await cdp.evaluate<{ g: boolean }>(`return { g: Boolean(app.plugins.plugins[${q(PLUGIN_ID)}]) };`)).g;
    let frei = "";
    if (!geladen) {
      frei = (await cdp.evaluate<{ s: string }>(`
        try {
          if (app.plugins.setEnable) await app.plugins.setEnable(true);
          await app.plugins.enablePluginAndSave(${q(PLUGIN_ID)});
          await new Promise((r) => setTimeout(r, 1200));
          return { s: app.plugins.plugins[${q(PLUGIN_ID)}] ? "freigeschaltet" : "Aufruf ohne Wirkung" };
        } catch (e) { return { s: "Fehler: " + (e && e.message ? e.message : String(e)) }; }
      `)).s;
      geladen = (await cdp.evaluate<{ g: boolean }>(`return { g: Boolean(app.plugins.plugins[${q(PLUGIN_ID)}]) };`)).g;
    }
    record("C1 Restricted-Mode-Guard (Plugin nach setEnable geladen)", geladen, geladen ? `Vault ${vaultName}${frei ? ` (${frei})` : " (bereits aktiv)"}` : `app.plugins.plugins.${PLUGIN_ID} fehlt — ${frei || "kein Freischaltversuch"}`);
    if (!geladen) throw new Error("Ohne geladenes Plugin ist jeder weitere Punkt gegenstandslos.");

    // Frischer Ausgangszustand: alle evtl. vom letzten Lauf verbliebenen Endpunkte weg.
    await cdp.evaluate(`
      const p = app.plugins.plugins[${q(PLUGIN_ID)}];
      p.settings.endpoints = [];
      await p.saveSettings();
      return true;
    `);

    // --- A1-A5: Schluesselbund --------------------------------------------------------
    console.log("\nA · Schlüsselbund");
    settings = await openSettings(cdp, port);

    const adderRows = await count(settings, ".okit-ep-row");
    const adderUrl = await settings.cdp.evaluate<{ v: string | null }>(`return { v: ${settings.el(`root.querySelector(".okit-ep-row input[type=text]")`)} ? ${settings.el(`root.querySelector(".okit-ep-row input[type=text]")`)}.value : null };`);
    record("A1 Settings-Tab offen, Adder-Zeile leer", adderRows === 1 && adderUrl.v === "", `${adderRows} .okit-ep-row, Adder-URL=${q(adderUrl.v)}`);

    // A2 — Preset "LM Studio" klicken.
    const presetOk = await clickReal(settings.cdp, settings.el(`Array.from(root.querySelectorAll("button")).find((b) => b.textContent.trim() === "LM Studio")`));
    const nachPreset = await pollUntil<{ ok: boolean }>(settings.cdp, `return (${settings.el(`root.querySelectorAll(".okit-ep-row").length`)}) === 2 ? { ok: true } : null;`, 8000, 300);
    const ep0 = await cdp.evaluate<{ url: string; provider: string; caps: string[]; id: string } | null>(`
      const e = app.plugins.plugins[${q(PLUGIN_ID)}].settings.endpoints[0];
      return e ? { url: e.url, provider: e.provider, caps: [...e.capabilities].sort(), id: e.id } : null;
    `);
    const capsOk = ep0 !== null && JSON.stringify(ep0.caps) === JSON.stringify(["chat", "embedding", "vision"]);
    record(
      "A2 Preset LM Studio → Zeile localhost:1234, openai, chat/vision/embedding",
      presetOk && nachPreset !== null && ep0?.url === "http://localhost:1234" && ep0.provider === "openai" && capsOk,
      `Klick=${presetOk}, Zeile=${JSON.stringify(ep0)}`,
    );
    if (!ep0) throw new Error("A2 fehlgeschlagen — ohne Endpunkt sind A3-A5 gegenstandslos.");
    const epId = ep0.id;

    // A3 — Token setzen.
    const secretTyped = await settings.cdp.evaluate<{ ok: boolean }>(`
      const pw = ${settings.el(`root.querySelector(".okit-ep-row input[type=password]")`)};
      if (!pw) return { ok: false };
      pw.focus();
      pw.value = "sk-test";
      pw.dispatchEvent(new Event("input", { bubbles: true }));
      pw.dispatchEvent(new Event("blur", { bubbles: true }));
      return { ok: true };
    `);
    const secretSet = await pollUntil<{ ok: boolean }>(cdp, `
      const e = app.plugins.plugins[${q(PLUGIN_ID)}].settings.endpoints.find((x) => x.id === ${q(epId)});
      return e && e.secretId ? { ok: true } : null;
    `, 8000, 300);
    const secretVal = await cdp.evaluate<{ v: string | null }>(`
      const e = app.plugins.plugins[${q(PLUGIN_ID)}].settings.endpoints.find((x) => x.id === ${q(epId)});
      const v = e && e.secretId ? await app.secretStorage.getSecret(e.secretId) : null;
      return { v: v ?? null };
    `);
    const vaultDirForFile = stagingVaultDirSafe();
    let dataJsonClean = true;
    let dataJsonDetail = "data.json nicht geprueft (STAGING_VAULTS_DIR fehlt)";
    if (vaultDirForFile) {
      try {
        const raw = readFileSync(join(vaultDirForFile, ".obsidian", "plugins", PLUGIN_ID, "data.json"), "utf-8");
        dataJsonClean = !raw.includes("sk-test");
        dataJsonDetail = dataJsonClean ? "data.json enthaelt kein sk-test" : "data.json ENTHAELT sk-test!";
      } catch (e) { dataJsonDetail = `data.json nicht lesbar: ${(e as Error).message}`; }
    }
    // Die Zeile rendert erst NACH afterSecret()s Kette (save → reconnect → rerender) neu —
    // der State-Poll oben (secretSet) kann bereits durchkommen, bevor rerender() fertig ist.
    // Gepollt statt einmal gelesen, sonst ist der Punkt an einem Zeitfenster rot, das nichts
    // mit dem Plugin zu tun hat (gemessen 2026-09-15, erster Lauf nach Plugin-Reload).
    const secretRowText = await pollUntil<{ t: string }>(settings.cdp, `
      const t = ${settings.el(`root.querySelector(".okit-ep-secret") ? root.querySelector(".okit-ep-secret").textContent : null`)};
      return t ? { t } : null;
    `, 8000, 300) ?? { t: null as unknown as string };
    const savedTextOk = secretRowText.t === "token saved" || secretRowText.t === "Token gespeichert";
    record(
      "A3 Token setzen → secretStorage=sk-test, data.json ohne sk-test, Zeile „Token gespeichert“",
      secretTyped.ok && secretSet !== null && secretVal.v === "sk-test" && dataJsonClean && savedTextOk,
      `getSecret=${q(secretVal.v)} · ${dataJsonDetail} · Zeilentext=${q(secretRowText.t)}`,
    );

    // A4 — Token entfernen. Der Knopf traegt kein stabiles Klassenmerkmal (extraButton
    // "key-round"), wohl aber ein `aria-label` aus `setTooltip` — darüber treffen statt
    // über die Position (die Reihenfolge der Icons haengt vom asynchron nachgeladenen
    // Modell-Refresh-Knopf ab, siehe clickIconByLabel).
    const clearOkResult = await clickIconByLabel(settings, `root.querySelector(".okit-ep-row")`, "Remove token", "Token entfernen");
    const clearOk = { ok: clearOkResult };
    const secretCleared = await pollUntil<{ ok: boolean }>(cdp, `
      const e = app.plugins.plugins[${q(PLUGIN_ID)}].settings.endpoints.find((x) => x.id === ${q(epId)});
      return e && !e.secretId ? { ok: true } : null;
    `, 8000, 300);
    const secretValAfterClear = await cdp.evaluate<{ v: string | null }>(`
      const v = await app.secretStorage.getSecret(${q(`${PLUGIN_ID}-${epId}`)});
      return { v: v ?? null };
    `);
    settings = await reopenSettings(cdp, port, settings); // sicherheitshalber neu holen (reconnect() rendert bereits selbst neu)
    const pwFieldBack = await count(settings, ".okit-ep-row input[type=password]");
    record(
      "A4 Token entfernen → Secret null, Zeile zeigt Passwortfeld",
      clearOk.ok && secretCleared !== null && (secretValAfterClear.v === null || secretValAfterClear.v === "") && pwFieldBack >= 1,
      `clear=${clearOk.ok}, secret=${q(secretValAfterClear.v)}, Passwortfelder=${pwFieldBack}`,
    );

    // A5 — Endpunkt entfernen. Wieder ueber aria-label statt Position (siehe A4).
    const rowByUrlExpr = `Array.from(root.querySelectorAll(".okit-ep-row")).find((r) => { const inp = r.querySelector("input[type=text]"); return inp && inp.value === "http://localhost:1234"; })`;
    const removeOkResult = await clickIconByLabel(
      settings,
      rowByUrlExpr,
      "Remove endpoint (also removes its token)",
      "Endpunkt entfernen (entfernt auch sein Token)",
    );
    const removeOk = { ok: removeOkResult };
    const removed = await pollUntil<{ ok: boolean }>(cdp, `
      return app.plugins.plugins[${q(PLUGIN_ID)}].settings.endpoints.length === 0 ? { ok: true } : null;
    `, 8000, 300);
    const secretValAfterRemove = await cdp.evaluate<{ v: string | null }>(`
      const v = await app.secretStorage.getSecret(${q(`${PLUGIN_ID}-${epId}`)});
      return { v: v ?? null };
    `);
    record(
      "A5 Endpunkt entfernen → Secret null, Liste leer",
      removeOk.ok && removed !== null && (secretValAfterRemove.v === null || secretValAfterRemove.v === ""),
      `remove=${removeOk.ok}, secret=${q(secretValAfterRemove.v)}, endpoints=${(await cdp.evaluate<number>(`return app.plugins.plugins[${q(PLUGIN_ID)}].settings.endpoints.length;`))}`,
    );

    // --- B1-B3: API gegen den Fake-Endpunkt --------------------------------------------
    console.log("\nB · API gegen den Fake-Endpunkt");
    fake = await startFakeEndpoint();
    console.log(`  Fake-Endpunkt: ${fake.url}`);

    const fakeId = await cdp.evaluate<string>(`
      const p = app.plugins.plugins[${q(PLUGIN_ID)}];
      const id = crypto.randomUUID();
      p.settings.endpoints.push({ id, label: "gui-smoke fake", url: ${q(fake.url)}, provider: "openai", capabilities: ["chat", "embedding"], enabled: true });
      await p.saveSettings();
      return id;
    `);

    // B1 — api.list({capability:"embedding"}) liefert genau den Fake-Eintrag.
    const listRes = await cdp.evaluate<Array<{ id: string; url: string; capabilities: string[] }>>(`
      return app.plugins.plugins[${q(PLUGIN_ID)}].api.list({ capability: "embedding" });
    `);
    record(
      "B1 api.list({capability:\"embedding\"}) → genau der Fake-Eintrag",
      listRes.length === 1 && listRes[0]?.id === fakeId && (listRes[0]?.capabilities ?? []).includes("embedding"),
      `${listRes.length} Eintraege: ${JSON.stringify(listRes.map((e) => ({ id: e.id, url: e.url, capabilities: e.capabilities })))}`,
    );

    // B2 — api.resolve("chat", {caller}) → config.url = Fake-Server; Konsumenten-Übersicht
    // zeigt "gui-smoke — chat" nach Re-Render.
    const resolveRes = await cdp.evaluate<{ error?: string; config?: { url: string } }>(`
      return await app.plugins.plugins[${q(PLUGIN_ID)}].api.resolve("chat", { caller: "gui-smoke" });
    `);
    settings = await reopenSettings(cdp, port, settings);
    const consumerRowText = await settings.cdp.evaluate<{ texts: string[] }>(`
      return { texts: Array.from(${settings.el(`root.querySelectorAll(".setting-item-name")`)}).map((n) => n.textContent) };
    `);
    const consumerOk = consumerRowText.texts.some((t) => t === "gui-smoke — chat" || t === "gui-smoke — Chat");
    record(
      "B2 api.resolve(\"chat\",{caller}) → config.url=Fake-Server, Konsumenten-Übersicht zeigt gui-smoke — chat",
      resolveRes.config?.url !== undefined && resolveRes.config.url.startsWith(fake.url) && consumerOk,
      `resolve=${JSON.stringify(resolveRes)}, Konsumenten-Zeilen=${JSON.stringify(consumerRowText.texts)}`,
    );

    // B3 — Fake-Server stoppen: resolve() muss no-endpoint liefern. Die Reachability-Cache
    // von B2 traegt ansonsten ein positives Ergebnis fuer die volle TTL (30 s) weiter — ein
    // erneutes resolve() ohne Invalidierung wuerde die tote Verbindung also faelschlich als
    // erreichbar melden. `handle.invalidateUrl` ist genau das, was jede Listenmutation in
    // der Settings-UI ohnehin ausloest (siehe endpoint-list.ts commit()); es hier direkt zu
    // rufen entspricht also reeller Nutzung, nicht einem Sonderpfad des Treibers.
    await fake.close();
    console.log("  Fake-Endpunkt gestoppt");
    const fakeUrl = fake.url;
    await cdp.evaluate(`app.plugins.plugins[${q(PLUGIN_ID)}].handle.invalidateUrl(${q(fakeUrl)}); return true;`);
    const resolveDown1 = await cdp.evaluate<{ error?: string }>(`return await app.plugins.plugins[${q(PLUGIN_ID)}].api.resolve("chat");`);

    // Server wieder starten, WÄHREND der Cache das negative Ergebnis noch haelt (TTL 30 s,
    // keine erneute Invalidierung) — resolve() muss trotz laufendem Server weiter
    // no-endpoint melden, weil der Cache nicht erneut probt. Derselbe Port (nicht irgendein
    // neuer): "innerhalb der TTL" prueft denselben Endpunkt-Eintrag, nur mit wiederkehrendem
    // Server dahinter — ein neuer Port waere ein neuer, noch nie gecachter Endpunkt.
    const fake3 = await startFakeEndpointOnPort(fakeUrl);
    const resolveDown2 = await cdp.evaluate<{ error?: string }>(`return await app.plugins.plugins[${q(PLUGIN_ID)}].api.resolve("chat");`);

    // api.models(id,{force:true}) haengt an einem EIGENEN Cache (model-list-cache in
    // api.ts), der die Reachability-Cache von resolve() gar nicht kennt — force zwingt
    // ihn zu einer frischen, direkten Probe gegen den jetzt wieder laufenden Server.
    const modelsRes = await cdp.evaluate<{ error?: string } | string[]>(`
      return await app.plugins.plugins[${q(PLUGIN_ID)}].api.models(${q(fakeId)}, { force: true });
    `);
    await fake3.close();
    const modelsOk = Array.isArray(modelsRes) && modelsRes.includes("smoke-model");
    record(
      "B3 Fake-Server stoppen → no-endpoint; innerhalb TTL trotz Neustart weiter no-endpoint (Cache); api.models(force) wieder erreichbar",
      (resolveDown1 as { error?: string }).error === "no-endpoint"
        && (resolveDown2 as { error?: string }).error === "no-endpoint"
        && modelsOk,
      `stop→${JSON.stringify(resolveDown1)} · restart-in-TTL→${JSON.stringify(resolveDown2)} · models(force)→${JSON.stringify(modelsRes)}`,
    );
    fake = null;
  } finally {
    if (settings) closeSettings(cdp, settings);
    if (fake) await fake.close().catch(() => undefined);
    cdp.close();
  }

  const failed = checks.filter((c) => c.zustand === "rot");
  const skippedN = checks.filter((c) => c.zustand === "uebersprungen").length;
  console.log(`\n${checks.length - failed.length - skippedN}/${checks.length} grün, ${skippedN} übersprungen`);
  if (failed.length > 0) {
    console.log("Rot:");
    for (const c of failed) console.log(`  - ${c.name}: ${c.detail}`);
    process.exitCode = 1;
  }
}

/** `STAGING_VAULTS_DIR` optional lesen, ohne bei Fehlen zu werfen — A3 prueft `data.json`
 *  nur, wenn der Ort bekannt ist; ohne die Variable wird der Punkt trotzdem gemessen (ueber
 *  Schluesselbund + UI-Text), nur die Datei-Halbmessung entfaellt mit Begruendung im Detail. */
function stagingVaultDirSafe(): string | null {
  try { return stagingVaultDir(REPO_NAME); } catch { return null; }
}

/** Denselben Port erneut belegen, NACHDEM er frei wurde (B3: „wieder gestartet"). Ein
 *  einfaches `startFakeEndpoint()` waehlt einen neuen Zufallsport — B3 misst aber bewusst
 *  DENSELBEN Endpunkt-Eintrag, nur mit wiederkehrendem Server dahinter. */
async function startFakeEndpointOnPort(url: string): Promise<{ url: string; close: () => Promise<void> }> {
  const port = Number(new URL(url).port);
  const server: Server = createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      req.url?.includes("/v1/models") === true
        ? JSON.stringify({ data: [{ id: "smoke-model", object: "model" }] })
        : JSON.stringify({ ok: true }),
    );
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return { url, close: () => new Promise<void>((resolve) => { server.close(() => { resolve(); }); }) };
}

main().catch((error: unknown) => {
  console.error(`\nAbbruch: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
