/**
 * Aufnahme-Treiber fuer `docs/images/` — faehrt den Vertrag aus `docs/images/README.md`
 * gegen ein **laufendes** Obsidian (Skill `readme-shots`).
 *
 * Das Plugin hat keine eigene View: jedes Bild zeigt seinen Einstellungs-Tab. Der Tab ist
 * seit Obsidian 1.13 ein **eigenes Fenster** ohne `window.app` — Zustand (Endpunkte,
 * Token, Aufrufer) wird deshalb ueber das Workspace-Fenster gesetzt, aufgenommen wird im
 * Einstellungs-Fenster.
 *
 * ## Ablauf
 *
 * ```bash
 * npm run build && npm run shots -- --setup            # Vault aus dem Fixture bauen
 * # Obsidian mit Vault + englischer Oberflaeche starten (Zweitinstanz, eigener Port)
 * npm run shots -- --port 9324 [--only hero] [--out docs/images]
 * ```
 *
 * Der Treiber stellt seinen Zustand selbst her: drei Endpunkte (zwei antworten aus Fake-
 * Servern des Treibers, einer nicht), ein Platzhalter-Token, ein Aufruf einer erfundenen
 * Konsumenten-Plugin-Kennung. Am Ende raeumt er auf (Endpunkte, Token). Auf Ports `1235`
 * und `11435` liegen die Fake-Server — die echten Standardports `1234`/`11434` bleiben
 * unberuehrt, damit ein laufendes LM Studio oder Ollama kein Bild veraendert.
 *
 * ⚠️ Das Token ist ein ASCII-Platzhalter (`demo-token`), nie ein maskierter Wert
 * (Dach-AGENTS.md, README-Bilder: ein Rezept maskiert in der Darstellung, nicht im Speicher).
 */

import { execFileSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import { argv, cwd, exit } from "node:process";

import { Cdp, attachTo, pollUntil, requireVisible } from "../../tools/obsidian-cdp/cdp.js";
import { capture, setWindowSize, writeShot, type Rect } from "../../tools/obsidian-cdp/shot.js";
import { buildVault, stagingVaultDir } from "../../tools/obsidian-cdp/vault.js";

const PLUGIN_ID = "llm-endpoint-manager";
const REPO_NAME = "llm-endpoint-manager";
const CAPTURE_WIDTH = 1200;
const THUMB_WIDTH = 380;
const WINDOW = { width: 1000, height: 900 };   // unter der kleinsten Bildschirmhoehe, sonst lehnt Electron ab

const LM_PORT = 1235;
const OLLAMA_PORT = 11435;
const CLOSED_PORT = 1237;
const DEMO_TOKEN = "demo-token";

const q = (s: unknown): string => JSON.stringify(s);

// --- Fake-Server ------------------------------------------------------------------------
type Fake = { close: () => Promise<void> };

function listen(server: Server, port: number): Promise<Fake> {
  return new Promise((resolve, reject) => {
    server.once("error", (e) => { reject(new Error(`Port ${port} ist belegt oder nicht bindbar: ${(e as Error).message}`)); });
    server.listen(port, "127.0.0.1", () => {
      resolve({ close: () => new Promise<void>((r) => { server.close(() => { r(); }); server.closeAllConnections(); }) });
    });
  });
}

const json = (res: import("node:http").ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};

/** LM-Studio-Attrappe: `/v1/models` (Erreichbarkeit, Modell-Liste) und `/api/v1/models`
 *  (Backend-Erkennung). Nichts davon laedt ein Modell — wie beim echten Manager. */
function startFakeLmStudio(): Promise<Fake> {
  const server = createServer((req, res) => {
    if (req.url?.includes("/api/v1/models")) return json(res, 200, { data: [{ id: "qwen/qwen3.8-27b", capabilities: {} }] });
    if (req.url?.includes("/v1/models")) {
      return json(res, 200, { data: [
        { id: "qwen/qwen3.8-27b", object: "model" },
        { id: "qwen/qwen3.8-27b@4bit", object: "model" },
        { id: "gemma-4-12b-it", object: "model" },
        { id: "text-embedding-nomic-embed-text-v1.5", object: "model" },
      ] });
    }
    return json(res, 404, { error: "not found" });
  });
  return listen(server, LM_PORT);
}

function startFakeOllama(): Promise<Fake> {
  const server = createServer((req, res) => {
    if (req.url?.includes("/v1/models")) return json(res, 200, { data: [{ id: "llama3.2:3b", object: "model" }, { id: "nomic-embed-text", object: "model" }] });
    return json(res, 404, { error: "not found" });
  });
  return listen(server, OLLAMA_PORT);
}

// --- Zustand ----------------------------------------------------------------------------
const ENDPOINTS = [
  {
    id: "demo-lmstudio", label: "LM Studio (desktop)", url: `http://localhost:${LM_PORT}`, provider: "openai",
    capabilities: ["chat", "vision", "embedding"], enabled: true, model: "qwen/qwen3.8-27b", backend: "lmstudio",
    models: [
      { id: "qwen/qwen3.8-27b", family: "qwen3.8" },
      { id: "qwen/qwen3.8-27b@4bit", aliasOf: "qwen/qwen3.8-27b" },
    ],
  },
  {
    id: "demo-ollama", label: "Ollama (laptop)", url: `http://localhost:${OLLAMA_PORT}`, provider: "ollama",
    capabilities: ["chat", "embedding"], enabled: true, model: "llama3.2:3b", backend: "ollama",
  },
  {
    id: "demo-office", label: "Office server", url: `http://localhost:${CLOSED_PORT}`, provider: "openai",
    capabilities: ["chat"], enabled: true, secretId: `${PLUGIN_ID}-demo-office`,
  },
];

async function setState(ws: Cdp): Promise<void> {
  await ws.evaluate(`
    const p = app.plugins.plugins[${q(PLUGIN_ID)}];
    if (!p) throw new Error("Plugin nicht geladen");
    p.settings.endpoints = ${q(ENDPOINTS)};
    app.secretStorage.setSecret(${q(`${PLUGIN_ID}-demo-office`)}, ${q(DEMO_TOKEN)});
    p.handle.reachability.clear();
    await p.saveSettings();
    await p.api.resolve("chat", { caller: "Notes Assistant" });
    await p.api.resolve("embedding", { caller: "Vault Search" });
    return true;
  `);
}

async function cleanup(ws: Cdp): Promise<void> {
  await ws.evaluate(`
    const p = app.plugins.plugins[${q(PLUGIN_ID)}];
    if (p) { p.settings.endpoints = []; await p.saveSettings(); }
    app.secretStorage.setSecret(${q(`${PLUGIN_ID}-demo-office`)}, "");
    return true;
  `).catch(() => { console.log("  ! Aufraeumen fehlgeschlagen — data.json und Schluesselbund von Hand pruefen"); });
}

// --- Settings-Fenster ---------------------------------------------------------------------
async function openSettings(ws: Cdp, port: number): Promise<Cdp> {
  await ws.evaluate(`
    app.setting.open();
    await new Promise((r) => setTimeout(r, 500));
    app.setting.openTabById(${q(PLUGIN_ID)});
    await new Promise((r) => setTimeout(r, 1200));
    return true;
  `);
  const fenster = await attachTo("settings", port, REPO_NAME);
  if (!fenster) throw new Error("Kein Einstellungen-Fenster gefunden");
  await requireVisible(fenster).catch(() => undefined);
  return fenster;
}

/** Scrollt den Einstellungs-Container und liefert die Box von `von` bis `bis` (Ausdruecke, die
 *  ein Element liefern, in Fenster-Koordinaten NACH dem Scrollen). Links/rechts: die
 *  Inhaltsspalte ohne die Seitenleiste der Einstellungen (`x0`..Fensterrand). */
async function ausschnitt(win: Cdp, opts: { scrollTop?: number; scrollTo?: string; von: string; bis: string; x0?: number; width?: number; padTop?: number; padBottom?: number }): Promise<Rect> {
  const raw = await win.evaluate<string | null>(`
    const sc = document.querySelector(".vertical-tab-content");
    const nameEl = (t, i = 0) => [...document.querySelectorAll(".setting-item-name")].filter((e) => e.textContent.trim().startsWith(t))[i];
    const rowOf = (i) => [...document.querySelectorAll("input[aria-label='Endpoint address']")][i].closest(".setting-item");
    ${opts.scrollTo ? `const anchor = ${opts.scrollTo}; sc.scrollTop = 0; sc.scrollTop = anchor.getBoundingClientRect().top - sc.getBoundingClientRect().top - 24;` : `sc.scrollTop = ${opts.scrollTop ?? 0};`}
    await new Promise((r) => setTimeout(r, 400));
    const von = (${opts.von}).getBoundingClientRect(), bis = (${opts.bis}).getBoundingClientRect();
    return JSON.stringify({ top: von.top, bottom: bis.bottom, w: innerWidth });
  `);
  if (!raw) throw new Error("Ausschnitt nicht bestimmbar");
  const r = JSON.parse(raw) as { top: number; bottom: number; w: number };
  const x0 = opts.x0 ?? 270;
  const y = Math.max(0, r.top - (opts.padTop ?? 16));
  return { x: x0, y, width: opts.width ?? r.w - x0, height: r.bottom + (opts.padBottom ?? 16) - y };
}

async function win_scroll0(win: Cdp): Promise<void> {
  await win.evaluate(`document.querySelector(".vertical-tab-content").scrollTop = 0; await new Promise((r) => setTimeout(r, 300)); return true;`);
}

async function aufnehmen(win: Cdp, name: string, box: Rect | undefined, outDir: string): Promise<void> {
  const png = await capture(win, box, 2);
  console.log(" ", await writeShot(win, name, png, { outDir, captureWidth: CAPTURE_WIDTH, thumbWidth: THUMB_WIDTH }));
}

function setup(): void {
  const vaultDir = stagingVaultDir(REPO_NAME);
  const log = buildVault({ repoRoot: cwd(), vaultDir, fixtureDir: "docs/images/fixture", pluginId: PLUGIN_ID });
  console.log(`Vault: ${vaultDir}`);
  for (const zeile of log) console.log(" ·", zeile);
  console.log("\nObsidian mit diesem Vault UND englischer Oberflaeche starten (Zweitinstanz, eigener Port), dann:\n  npm run shots -- --port <port>");
}

async function main(): Promise<void> {
  const args = argv.slice(2);
  const flag = (name: string): string | undefined => {
    const i = args.indexOf(`--${name}`);
    return i === -1 ? undefined : args[i + 1];
  };
  if (args.includes("--setup")) { setup(); return; }

  const port = Number(flag("port") ?? 9222);
  const only = flag("only");
  const outDir = flag("out") ?? "docs/images";
  const explore = args.includes("--explore");

  const ws = await attachTo("workspace", port, REPO_NAME);
  if (!ws) throw new Error(`Kein Obsidian-Fenster fuer Vault „${REPO_NAME}" auf Port ${port}`);

  const fakes: Fake[] = [];
  let settingsWin: Cdp | null = null;
  try {
    if (process.platform === "darwin") {
      try { execFileSync("osascript", ["-e", 'tell application "Obsidian" to activate']); await new Promise((r) => setTimeout(r, 1200)); }
      catch { console.log("  (Hinweis: osascript activate schlug fehl)"); }
    }
    await requireVisible(ws);

    // Aufnahmesprache: Englisch (README.md ist kanonisch). Die Pruefung liest die Sprache aus
    // dem Plugin selbst, nicht aus einer Vermutung ueber obsidian.json.
    const sprache = await ws.evaluate<{ lang: string }>(`return { lang: window.moment ? window.moment.locale() : "?" };`);
    if (!sprache.lang.startsWith("en")) {
      throw new Error(`Oberflaeche ist „${sprache.lang}", nicht Englisch — obsidian.json UND localStorage["language"] auf "en", dann Neustart.`);
    }

    fakes.push(await startFakeLmStudio(), await startFakeOllama());
    await setState(ws);

    settingsWin = await openSettings(ws, port);
    await setWindowSize(settingsWin, WINDOW.width, WINDOW.height);
    await new Promise((r) => setTimeout(r, 2500));   // Statusleuchten kommen asynchron
    await pollUntil<string>(settingsWin, `return document.querySelector(".lem-cap") ? "ok" : null;`, 15_000, 250);

    if (explore) {
      const png = await capture(settingsWin, undefined, 1);
      console.log(await writeShot(settingsWin, "_explore.png", png, { outDir, captureWidth: 1000, thumbWidth: THUMB_WIDTH }));
      console.log(await settingsWin.evaluate<string>(`
        const sc = document.querySelector(".vertical-tab-content");
        return JSON.stringify({ win: [innerWidth, innerHeight], scroll: sc ? [sc.scrollHeight, sc.clientHeight] : null,
          names: [...document.querySelectorAll(".vertical-tab-content .setting-item-name, .vertical-tab-content .setting-item-heading, .lem-cap, .lem-keychain-status, .lem-consumers-empty")]
            .filter((e) => e.textContent.trim())
            .map((e) => [e.className, e.textContent.trim().slice(0, 40), Math.round(e.getBoundingClientRect().top)]) });
      `));
      return;
    }
    const want = (n: string): boolean => only === undefined || only === n;
    if (want("hero")) {
      await win_scroll0(settingsWin);
      const fenster = await settingsWin.evaluate<{ w: number; h: number }>(`return { w: innerWidth, h: innerHeight };`);
      console.log(`  Fenster ${fenster.w}x${fenster.h}`);
      await aufnehmen(settingsWin, "hero.png", { x: 0, y: 0, width: fenster.w, height: fenster.h }, outDir);
    }
    if (want("endpoints")) {
      const box = await ausschnitt(settingsWin, {
        scrollTo: "rowOf(1)", von: "rowOf(1)", bis: "[...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Check connections')", width: 712, padBottom: 20,
      });
      await aufnehmen(settingsWin, "endpoints.png", box, outDir);
    }
    if (want("models")) {
      const box = await ausschnitt(settingsWin, {
        scrollTo: "nameEl('Models')", von: "nameEl('Models')", bis: "nameEl('Backend', 0).closest('.setting-item')", width: 712, padBottom: 12,
      });
      await aufnehmen(settingsWin, "models.png", box, outDir);
    }
    if (want("consumers")) {
      const box = await ausschnitt(settingsWin, {
        scrollTo: "nameEl('API tokens')", von: "nameEl('API tokens')", bis: "nameEl('Notes Assistant').closest('.setting-item')", width: 712, padBottom: 4,
      });
      await aufnehmen(settingsWin, "consumers.png", box, outDir);
    }
  } finally {
    if (settingsWin) settingsWin.close();
    await cleanup(ws);
    for (const f of fakes) await f.close().catch(() => undefined);
    ws.close();
  }
}

await main().catch((fehler: Error) => { console.error(fehler.message); exit(1); });
