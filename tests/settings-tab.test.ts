import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { requestUrl } from "obsidian";
import { makeFakeApp, Modal, Setting, TextComponent, ToggleComponent, DropdownComponent, ButtonComponent, ExtraButtonComponent } from "./vendor/kit/obsidian-mock";
import LlmEndpointManagerPlugin from "../src/main";
import { helpSettingDefinition } from "../src/vendor/kit-obsidian/help-setting";
import { LlmEndpointManagerSettingTab, helpOptions, presetText, presetTooltip } from "../src/obsidian/settings-tab";
import { setLang } from "../src/vendor/kit/i18n";
import { ENDPOINT_STATUS_TEXTS_DE, ENDPOINT_STATUS_TEXTS_EN } from "../src/vendor/kit-obsidian/endpoint-status-text";

// Testumgebung ist "node" (kein jsdom, siehe vitest.config.ts) — die Endpunkt-Liste probt beim
// Rendern jede Zeile über src/obsidian/http.ts, das window.setTimeout/clearTimeout braucht
// (obsidianmd/prefer-window-timers). Stub global.window mit den echten Node-Timern und mach das
// nach dieser Datei wieder rückgängig (Muster aus tests/http.test.ts).
const hadWindow = "window" in globalThis;
const previousWindow = (globalThis as { window?: unknown }).window;
beforeAll(() => {
  (globalThis as { window?: unknown }).window = { setTimeout, clearTimeout };
});
afterAll(() => {
  if (hadWindow) (globalThis as { window?: unknown }).window = previousWindow;
  else delete (globalThis as { window?: unknown }).window;
});

interface FakeEl { children: FakeEl[]; __setting?: Setting; textContent: string; querySelectorAll(s: string): FakeEl[] }

async function tab(data: unknown, app = makeFakeApp()): Promise<{ tab: LlmEndpointManagerSettingTab; el: FakeEl; plugin: LlmEndpointManagerPlugin }> {
  const p = new LlmEndpointManagerPlugin(app, { id: "llm-endpoint-manager", name: "x", version: "0", minAppVersion: "1.11.4", description: "", author: "", authorUrl: "", isDesktopOnly: false, dir: "" });
  (p as unknown as { loadData: () => Promise<unknown> }).loadData = () => Promise.resolve(data);
  (p as unknown as { saveData: () => Promise<void> }).saveData = () => Promise.resolve();
  await p.onload();
  const t = new LlmEndpointManagerSettingTab(app, p);
  t.display();
  return { tab: t, el: t.containerEl as unknown as FakeEl, plugin: p };
}
const settingsIn = (el: FakeEl): Setting[] => el.querySelectorAll(".setting-item").map(e => e.__setting).filter((s): s is Setting => !!s);

describe("presetText", () => {
  it("uebersetzt Presets mit Schluessel und laesst Marken stehen, in beiden Sprachen", async () => {
    await tab({ endpoints: [] });   // onload registriert die Strings
    setLang("de");
    expect(presetText({ label: "OpenAI-compatible cloud" })).toBe("OpenAI-kompatible Cloud");
    expect(presetText({ label: "Apple Intelligence (on-device)" })).toBe("Apple Intelligence (auf dem Gerät)");
    expect(presetText({ label: "LM Studio" })).toBe("LM Studio");
    setLang("en");
    expect(presetText({ label: "OpenAI-compatible cloud" })).toBe("OpenAI-compatible cloud");
    expect(presetText({ label: "Apple Intelligence (on-device)" })).toBe("Apple Intelligence (on-device)");
  });
});

describe("Status- und Hinweistexte der Endpunkt-Zeile", () => {
  it("kommen aus dem Kit (endpoint-status-text), in beiden Sprachen", async () => {
    const { tab: t } = await tab({ endpoints: [] });
    const strings = (t as unknown as { endpointStrings(): { statusTooltip(s: { kind: string; raw?: string }): string; warnings(w: { rule: string; message: string }[]): string } }).endpointStrings();
    setLang("en");
    expect(strings.statusTooltip({ kind: "ok" })).toBe(ENDPOINT_STATUS_TEXTS_EN.kinds.ok);
    expect(strings.statusTooltip({ kind: "unknown", raw: "boom" })).toBe("Not reachable — boom");
    expect(strings.warnings([{ rule: "port", message: "x" }])).toBe(ENDPOINT_STATUS_TEXTS_EN.warnings.port);
    setLang("de");
    expect(strings.statusTooltip({ kind: "timeout" })).toBe(ENDPOINT_STATUS_TEXTS_DE.kinds.timeout);
    expect(strings.warnings([{ rule: "scheme", message: "x" }, { rule: "gibts-nicht", message: "Eigene Meldung" }])).toBe(`${ENDPOINT_STATUS_TEXTS_DE.warnings.scheme} · Eigene Meldung`);
    setLang("en");
  });
  it("Kontextlänge und Leer-Option tragen den Kit-Wortlaut in beiden Sprachen", async () => {
    const { tab: t } = await tab({ endpoints: [] });
    type S = { emptyModel?: string; contextText?(c: { loadedContextLength?: number; maxContextLength?: number }): string };
    const build = (): S => (t as unknown as { endpointStrings(): S }).endpointStrings();
    setLang("en");
    const strings = build();
    expect(strings.emptyModel).toBe("— (server picks)");
    expect(strings.contextText?.({ loadedContextLength: 65536, maxContextLength: 262144 })).toBe("Context: loaded 65,536 · max 262,144 tokens");
    expect(strings.contextText?.({ maxContextLength: 8192 })).toBe("Context: max 8,192 tokens");
    setLang("de");
    const de = build();
    expect(de.emptyModel).toBe("— (Server wählt)");
    expect(de.contextText?.({ loadedContextLength: 4096 })).toBe("Kontext: geladen 4.096 Token");
    setLang("en");
  });
});

describe("LlmEndpointManagerSettingTab", () => {
  it("zeichnet je Endpunkt eine Zusatzzeile mit Label, Protokoll, vier Fähigkeiten und Aktiv-Schalter", async () => {
    const { el } = await tab({ endpoints: [{ id: "e1", url: "http://a", capabilities: ["chat"] }] });
    const extra = el.querySelectorAll(".okit-ep-extra");
    expect(extra.length).toBe(1);
    const inExtra = settingsIn(extra[0]!);
    const toggles = inExtra.flatMap(s => s.components.filter((c: unknown): c is ToggleComponent => c instanceof ToggleComponent));
    expect(toggles.length).toBe(5);   // 4 Fähigkeiten + aktiv
    const dropdowns = inExtra.flatMap(s => s.components.filter((c: unknown): c is DropdownComponent => c instanceof DropdownComponent));
    expect(dropdowns.length).toBe(1);
    const labels = inExtra.flatMap(s => s.components.filter((c: unknown): c is TextComponent => c instanceof TextComponent));
    expect(labels[0]?.getValue()).toBe("a");
  });
  it("markiert die Zeile mit den vier Fähigkeits-Schaltern mit lem-cap-row (statt :has in styles.css)", async () => {
    const { el } = await tab({ endpoints: [{ id: "e1", url: "http://a", capabilities: ["chat"] }] });
    const inExtra = settingsIn(el.querySelectorAll(".okit-ep-extra")[0]!);
    const marked = inExtra.filter(s => s.settingEl.hasClass("lem-cap-row"));
    expect(marked.length).toBe(1);
    expect(marked[0]!.components.filter((c: unknown) => c instanceof ToggleComponent).length).toBe(4);
  });
  it("hat die Hilfe-Zeile als erstes Element, mit Doku-Index und Issues dieses Repos", async () => {
    const { tab: t, el } = await tab({ endpoints: [] });
    const first = t.getSettingDefinitions()[0] as unknown as { type?: string; name: string; render: (s: Setting) => void };
    expect(first.type).toBeUndefined();   // keine Gruppe, keine Überschrift davor
    expect(first.name).toBe("Help");
    // Fallback-Pfad: die erste gezeichnete Zeile ist dieselbe, mit Text- und Icon-Knopf
    const row = settingsIn(el)[0]!;
    expect(row.nameValue).toBe("Help");
    expect(row.components.some((c: unknown) => c instanceof ButtonComponent && c.textValue === "Open documentation")).toBe(true);
    expect(row.components.some((c: unknown) => c instanceof ExtraButtonComponent && c.iconName === "bug")).toBe(true);
    // beide Knöpfe öffnen die richtigen URLs
    const opened: string[] = [];
    const probe = new Setting(el as never);
    helpSettingDefinition(helpOptions((u) => opened.push(u))).render!(probe as never, {} as never);
    probe.components.forEach((c: ButtonComponent | ExtraButtonComponent) => c.clickCB?.());
    expect(opened).toEqual([
      "https://github.com/johannes-kaindl/llm-endpoint-manager/blob/main/docs/README.md",
      "https://github.com/johannes-kaindl/llm-endpoint-manager/issues",
    ]);
  });
  it("schaltet eine Fähigkeit und speichert", async () => {
    const { el, plugin } = await tab({ endpoints: [{ id: "e1", url: "http://a", capabilities: ["chat"] }] });
    const inExtra = settingsIn(el.querySelectorAll(".okit-ep-extra")[0]!);
    const toggles = inExtra.flatMap(s => s.components.filter((c: unknown): c is ToggleComponent => c instanceof ToggleComponent));
    toggles[1]!.onChangeCB?.(true);   // embedding
    await new Promise(r => setTimeout(r, 0));
    expect(plugin.settings.endpoints[0]?.capabilities).toEqual(["chat", "embedding"]);
  });
  it("invalidiert den Modell-Cache-Schlüssel des Endpunkts bei Protokollwechsel", async () => {
    // Der Protokollwechsel ändert den Probe-Pfad, nicht die normalisierte URL — der Cache-Schlüssel
    // bleibt also gleich, und nur eine gezielte invalidate(key) räumt den stehenden Eintrag. Ein
    // Nachladen über die echte Endpunkt-Liste ist hier nicht beobachtbar (die UI lädt beim Rerender
    // selbst nach und würde den Cache erneut befüllen, bevor der Test hinsieht) — der Spy prüft
    // deshalb direkt den Aufruf statt den Seiteneffekt danach.
    const { el, tab: t } = await tab({ endpoints: [{ id: "e1", url: "http://a", provider: "openai", capabilities: ["chat"] }] });
    const cache = (t as unknown as { modelLists: import("../src/vendor/kit/model-list-cache").ModelListCache }).modelLists;
    const calls: string[] = [];
    const origInvalidate = cache.invalidate.bind(cache);
    cache.invalidate = (key: string) => { calls.push(key); origInvalidate(key); };
    const inExtra = settingsIn(el.querySelectorAll(".okit-ep-extra")[0]!);
    const dropdowns = inExtra.flatMap(s => s.components.filter((c: unknown): c is DropdownComponent => c instanceof DropdownComponent));
    dropdowns[0]!.onChangeCB?.("a1111");
    expect(calls).toEqual(["http://a"]);   // normalizeEndpoint("http://a")
  });
  it("zeigt ohne Schlüsselbund den Hinweis und keinen Konsumenten-Eintrag", async () => {
    const app = makeFakeApp(); delete app.secretStorage;
    const { el } = await tab({}, app);
    expect(el.textContent).toContain("1.11.4");
    expect(el.textContent).toContain("No plugin has asked");   // pickLang(null) faellt auf en, da der Mock keine getLanguage liefert
  });
  it("Schlüsselbund-Gruppe: verwaiste Einträge werden gezählt und erst nach Bestätigung per Knopf gelöscht", async () => {
    const app = makeFakeApp();
    app.secretStorage.listSecrets = (): string[] => [...(app.secretStorage.__secrets as Map<string, string>).keys()];
    app.secretStorage.setSecret("llm-endpoint-manager-alt1", "x");
    app.secretStorage.setSecret("llm-endpoint-manager-alt2", "y");
    const { el, plugin } = await tab({ endpoints: [{ id: "e1", url: "http://a" }] }, app);
    const row = settingsIn(el).find(s => s.nameValue.includes("2 unused tokens"));
    expect(row).toBeDefined();
    const btn = row!.components.find((c): c is ButtonComponent => c instanceof ButtonComponent)!;
    void btn.clickCB?.();   // wartet auf die Bestätigung, deshalb nicht abwarten
    // Vor der Bestätigung ist nichts gelöscht.
    expect(plugin.orphanSecrets().length).toBe(2);
    const confirm = (Modal.__last!.contentEl.querySelectorAll("button") as Array<{ __component: ButtonComponent }>).map(b => b.__component);
    expect(confirm.map(b => b.textValue)).toEqual(["Cancel", "Delete"]);
    confirm[1]!.clickCB?.();
    await new Promise(r => setTimeout(r, 0));
    expect(plugin.orphanSecrets()).toEqual([]);
  });
  it("Schlüsselbund-Gruppe: ohne verwaiste Einträge keine Aufräum-Zeile", async () => {
    const app = makeFakeApp();
    app.secretStorage.listSecrets = (): string[] => [...(app.secretStorage.__secrets as Map<string, string>).keys()];
    const { el } = await tab({ endpoints: [{ id: "e1", url: "http://a" }] }, app);
    expect(settingsIn(el).some(s => /unused token/.test(s.nameValue))).toBe(false);
  });
  it("shows stored model rows with family dropdown and a backend row per endpoint", async () => {
    const { el } = await tab({ endpoints: [{ id: "o", label: "LGS", url: "https://h/api", capabilities: ["chat"], backend: "openwebui", models: [{ id: "verdigado-pro", family: "gpt-oss" }] }] });
    const settings = el.querySelectorAll(".setting-item").map((n) => n.__setting!).filter(Boolean);
    const row = settings.find((s) => s.nameValue === "verdigado-pro")!;
    const dd = row.components.find((c): c is DropdownComponent => c instanceof DropdownComponent)!;
    expect(dd.getValue()).toBe("gpt-oss");
    expect(Object.keys(dd.options)).toEqual(["", "qwen3.8", "qwen3.6", "gemma4", "gpt-oss", "claude"]);
    const backend = settings.find((s) => s.components.some((c) => c instanceof DropdownComponent && (c as DropdownComponent).getValue() === "openwebui"));
    expect(backend).toBeDefined();
  });
  it("schickt die Zeilen-Prüfung mit dem Token aus dem Schlüsselbund (Authorization-Header)", async () => {
    // Regression: die Settings-Probe nahm den rohen gespeicherten Endpunkt (ohne apiKey) und
    // bekam von einem Bearer-geschützten Server 401 — „nicht erreichbar", obwohl der Token stimmt.
    const rq = requestUrl as unknown as { mockClear(): void; mock: { calls: unknown[][] } };
    rq.mockClear();
    const app = makeFakeApp();
    const data = { endpoints: [{ id: "e1", url: "https://h/api", provider: "openai", capabilities: ["chat"], secretId: "sid1" }] };
    const p = new LlmEndpointManagerPlugin(app, { id: "llm-endpoint-manager", name: "x", version: "0", minAppVersion: "1.11.4", description: "", author: "", authorUrl: "", isDesktopOnly: false, dir: "" });
    (p as unknown as { loadData: () => Promise<unknown> }).loadData = () => Promise.resolve(data);
    (p as unknown as { saveData: () => Promise<void> }).saveData = () => Promise.resolve();
    await p.onload();
    p.secrets.set("sid1", "tok-123");
    new LlmEndpointManagerSettingTab(app, p).display();
    await new Promise((r) => setTimeout(r, 20));
    const calls = rq.mock.calls.map((c) => c[0] as { url: string; headers?: Record<string, string> }).filter((a) => a.url.startsWith("https://h/api"));
    expect(calls.length).toBeGreaterThan(0);
    for (const a of calls) expect(a.headers?.Authorization).toBe("Bearer tok-123");
  });
  it("schickt die Backend-Erkennung mit dem Token aus dem Schlüsselbund", async () => {
    const rq = requestUrl as unknown as { mockClear(): void; mock: { calls: unknown[][] } };
    const app = makeFakeApp();
    const data = { endpoints: [{ id: "e1", url: "https://h/api", provider: "openai", capabilities: ["chat"], secretId: "sid1" }] };
    const p = new LlmEndpointManagerPlugin(app, { id: "llm-endpoint-manager", name: "x", version: "0", minAppVersion: "1.11.4", description: "", author: "", authorUrl: "", isDesktopOnly: false, dir: "" });
    (p as unknown as { loadData: () => Promise<unknown> }).loadData = () => Promise.resolve(data);
    (p as unknown as { saveData: () => Promise<void> }).saveData = () => Promise.resolve();
    await p.onload();
    p.secrets.set("sid1", "tok-123");
    const el = (() => { const t = new LlmEndpointManagerSettingTab(app, p); t.display(); return t.containerEl as unknown as FakeEl; })();
    await new Promise((r) => setTimeout(r, 20));
    rq.mockClear();
    const btn = settingsIn(el).flatMap((s) => s.components).find((c): c is ButtonComponent => c instanceof ButtonComponent && c.textValue.length > 0 && !!c.clickCB && c.textValue !== "Check connection" && /detect|erkennen/i.test(c.textValue))!;
    expect(btn).toBeDefined();
    btn.clickCB!();
    await new Promise((r) => setTimeout(r, 20));
    const calls = rq.mock.calls.map((c) => c[0] as { url: string; headers?: Record<string, string> }).filter((a) => a.url.startsWith("https://h/api/config") || a.url.startsWith("https://h/api/"));
    expect(calls.length).toBeGreaterThan(0);
    for (const a of calls) expect(a.headers?.Authorization).toBe("Bearer tok-123");
  });
  it("gibt einem Preset ohne Host seinen Preset-Namen als Label, nicht „https://“", async () => {
    const { tab: t } = await tab({});
    const complete = (t as unknown as { complete: (e: { url: string; label?: string }[]) => { label: string }[] }).complete.bind(t);
    expect(complete([{ url: "https://" }])[0]?.label).toBe("OpenAI-compatible cloud");
    expect(complete([{ url: "http://localhost:1234" }])[0]?.label).toBe("localhost:1234");   // mit Host bleibt es der Host
    expect(complete([{ url: "kaputt://" }])[0]?.label).toBe("New endpoint");   // kein Preset, kein Host → Platzhalter (en im Mock)
  });
  it("nennt die neue Apple-Zeile bei ihrem (uebersetzten) Preset-Namen, nicht beim Host-Teil „on-device“", async () => {
    const { tab: t } = await tab({});
    const complete = (t as unknown as { complete: (e: { url: string; label?: string }[]) => { label: string }[] }).complete.bind(t);
    expect(complete([{ url: "apple-shortcuts://on-device" }])[0]?.label).toBe("Apple Intelligence (on-device)");
    setLang("de");
    try { expect(complete([{ url: "apple-shortcuts://on-device" }])[0]?.label).toBe(presetText({ label: "Apple Intelligence (on-device)" })); }
    finally { setLang("en"); }
    expect(complete([{ url: "apple-shortcuts://on-device", label: "Mein Kurzbefehl" }])[0]?.label).toBe("Mein Kurzbefehl");   // ein gesetztes Label gewinnt
  });
  it("uebernimmt transport/shortcut aus dem Apple-Preset beim Vervollstaendigen", async () => {
    const { tab: t } = await tab({});
    const complete = (t as unknown as { complete: (e: { url: string; label?: string }[]) => { transport?: string; shortcut?: { name: string; timeoutMs: number } }[] }).complete.bind(t);
    const [e] = complete([{ url: "apple-shortcuts://on-device" }]);
    expect(e?.transport).toBe("shortcuts");
    expect(e?.shortcut).toEqual({ name: "Ask On-Device Model (Obsidian)", timeoutMs: 30000 });
  });
  it("uebernimmt die Modellzeile (displayFamily apple-fm) aus dem Apple-Preset beim Vervollstaendigen", async () => {
    const { tab: t } = await tab({});
    const complete = (t as unknown as { complete: (e: { url: string }[]) => { models?: unknown[] }[] }).complete.bind(t);
    expect(complete([{ url: "apple-shortcuts://on-device" }])[0]?.models).toEqual([{ id: "apple-fm", displayFamily: "apple-fm" }]);
  });
  it("uebernimmt Provider, Transport, Backend und Fähigkeiten aus dem Anthropic-Preset beim Vervollstaendigen", async () => {
    const { tab: t } = await tab({});
    const complete = (t as unknown as { complete: (e: { url: string }[]) => Array<{ label: string; provider: string; transport?: string; backend?: string; capabilities: string[] }> }).complete.bind(t);
    const [e] = complete([{ url: "https://api.anthropic.com" }]);
    expect([e?.provider, e?.transport, e?.backend, e?.capabilities, e?.label]).toEqual(["anthropic", "anthropic", "anthropic", ["chat", "vision"], "Anthropic (Claude API)"]);
  });
  it("Tooltip der Anthropic-Vorlage trägt den einen Satz zu den Plugins (EN/DE); andere Vorlagen bleiben bei „hinzufügen“", async () => {
    await tab({});
    setLang("en");
    expect(presetTooltip({ label: "Anthropic (Claude API)" })).toBe("Add Anthropic (Claude API) Claude with your own Anthropic key. Koda can use it already; the other plugins follow with their next update.");
    expect(presetTooltip({ label: "LM Studio" })).toBe("Add LM Studio");
    setLang("de");
    try { expect(presetTooltip({ label: "Anthropic (Claude API)" })).toContain("Koda kann sie schon nutzen"); }
    finally { setLang("en"); }
  });
  it("eine Claude-Zeile zeigt den Hinweis zum Schlüssel; die Protokoll-Auswahl kennt Anthropic, ein Wechsel zurück nimmt Transport und Backend weg", async () => {
    const { el, plugin } = await tab({ endpoints: [{ id: "c", label: "Claude API", url: "https://api.anthropic.com", provider: "anthropic", capabilities: ["chat", "vision"] }] });
    expect(el.textContent).toContain("Put your Anthropic API key into the token field");
    const providerRow = settingsIn(el).find((s) => s.nameValue === "Protocol")!;
    const dd = providerRow.components.find((c): c is DropdownComponent => c instanceof DropdownComponent)!;
    expect(dd.getValue()).toBe("anthropic");
    expect(Object.keys(dd.options)).toContain("anthropic");
    dd.onChangeCB?.("openai");
    await new Promise((r) => setTimeout(r, 0));
    const stored = plugin.settings.endpoints[0]!;
    expect([stored.provider, stored.transport, stored.backend]).toEqual(["openai", undefined, undefined]);
  });
  it("zeichnet den Apple-Modellblock aus den Kit-Daten (Familien-Bezeichnung) und haengt den Grenzen-Text an", async () => {
    const { el } = await tab({ endpoints: [
      { id: "e2", label: "Apple", url: "apple-shortcuts://on-device", provider: "apple-shortcuts", capabilities: ["chat"], transport: "shortcuts",
        shortcut: { name: "Ask On-Device Model (Obsidian)", timeoutMs: 30000 }, models: [{ id: "apple-fm", displayFamily: "apple-fm" }] },
    ] });
    const row = settingsIn(el).find((s) => s.nameValue === "apple-fm");
    expect(row?.descValue).toBe("Apple Foundation Models");
    expect(el.textContent).toContain("4096-token context");   // Grenzen-Text bleibt als Ergänzung
  });
  it("zeigt Kurzbefehl-Name, Timeout und Probelauf-Knopf nur fuer apple-shortcuts-Zeilen", async () => {
    const { el } = await tab({ endpoints: [
      { id: "e1", url: "http://a", capabilities: ["chat"] },
      { id: "e2", url: "apple-shortcuts://on-device", provider: "apple-shortcuts", capabilities: ["chat"], transport: "shortcuts", shortcut: { name: "My Shortcut", timeoutMs: 20000 } },
    ] });
    const extras = el.querySelectorAll(".okit-ep-extra");
    expect(extras.length).toBe(2);
    const inHttp = settingsIn(extras[0]!);
    expect(inHttp.some((s) => s.components.some((c) => c instanceof TextComponent && (c as TextComponent).getValue() === "My Shortcut"))).toBe(false);
    const inApple = settingsIn(extras[1]!);
    const nameField = inApple.flatMap((s) => s.components).find((c): c is TextComponent => c instanceof TextComponent && c.getValue() === "My Shortcut");
    expect(nameField).toBeDefined();
    const timeoutField = inApple.flatMap((s) => s.components).find((c): c is TextComponent => c instanceof TextComponent && c.getValue() === "20");
    expect(timeoutField).toBeDefined();
    const probeBtn = inApple.flatMap((s) => s.components).find((c): c is ButtonComponent => c instanceof ButtonComponent && c.textValue === "Run test prompt");
    expect(probeBtn).toBeDefined();
  });
  it("Probelauf-Knopf ruft die Shortcuts-Bridge mit Kurzbefehl-Name/Timeout und meldet die Antwort per Notice", async () => {
    const { el, plugin } = await tab({ endpoints: [
      { id: "e2", url: "apple-shortcuts://on-device", provider: "apple-shortcuts", capabilities: ["chat"], transport: "shortcuts", shortcut: { name: "My Shortcut", timeoutMs: 20000 } },
    ] });
    const runCalls: unknown[] = [];
    (plugin as unknown as { shortcutsBridge: { run: (req: unknown) => Promise<unknown> } }).shortcutsBridge = {
      run: (req: unknown) => { runCalls.push(req); return Promise.resolve({ ok: true, result: "funktioniert", durationMs: 5 }); },
    };
    const extras = el.querySelectorAll(".okit-ep-extra");
    const probeBtn = settingsIn(extras[0]!).flatMap((s) => s.components).find((c): c is ButtonComponent => c instanceof ButtonComponent && c.textValue === "Run test prompt")!;
    probeBtn.clickCB!();
    await new Promise((r) => setTimeout(r, 10));
    expect(runCalls).toEqual([{ shortcut: "My Shortcut", input: expect.any(String), timeoutMs: 20000 }]);
  });
  it("zeigt festen Beschreibungstext statt Familie/Backend-Bloecken fuer apple-shortcuts", async () => {
    const { el } = await tab({ endpoints: [
      { id: "e2", label: "Apple", url: "apple-shortcuts://on-device", provider: "apple-shortcuts", capabilities: ["chat"] },
    ] });
    expect(el.textContent).toContain("Apple Intelligence (on-device) — fixed model");
    const settings = el.querySelectorAll(".setting-item").map((n) => n.__setting!).filter(Boolean);
    expect(settings.some((s) => s.components.some((c) => c instanceof DropdownComponent && Object.keys((c as DropdownComponent).options).includes("gpt-oss")))).toBe(false);
  });
});

describe("Entfernen und Nachziehen im Endpunkt-Tab", () => {
  it("Entfernen über den Listenpfad nimmt Token und Zwischenspeicher mit (derselbe Weg wie removeEndpoint)", async () => {
    const { tab: t, plugin } = await tab({ endpoints: [
      { id: "e1", label: "A", url: "http://a", capabilities: ["chat"], secretId: "llm-endpoint-manager-e1" },
      { id: "e2", label: "B", url: "http://b", capabilities: ["chat"] },
    ] });
    plugin.secrets.set("llm-endpoint-manager-e1", "tok");
    (t as unknown as { applyEndpointList(eps: unknown[]): void }).applyEndpointList([plugin.settings.endpoints[1]]);
    expect(plugin.secrets.get("llm-endpoint-manager-e1")).toBeNull();
    expect(plugin.settings.endpoints.map((e) => e.id)).toEqual(["e2"]);
  });
  it("zeichnet die Liste neu, wenn ein Nachbar importiert, nicht bei der eigenen Speicherung; hide beendet das Abo", async () => {
    const { tab: t, plugin } = await tab({ endpoints: [{ id: "e1", label: "A", url: "http://a", capabilities: ["chat"] }] });
    let renders = 0;
    const w = t as unknown as { refreshUi: () => void; watchChanges(): void };
    // das echte Neuzeichnen ruft watchChanges erneut; ein Abo, das dabei neu anlegt, liefe in der Listener-Menge endlos
    w.refreshUi = () => { renders++; if (renders > 50) throw new Error("Endlosschleife"); w.watchChanges(); };
    (t as unknown as { watchChanges(): void }).watchChanges();
    await plugin.api.importEndpoints([{ url: "http://c" }], "chat");
    const nachImport = renders;
    expect(nachImport).toBeGreaterThan(0);
    expect(nachImport).toBeLessThan(10);   // der Manager meldet je Import zweimal, nicht endlos
    await (t as unknown as { own<T>(f: () => Promise<T>): Promise<T> }).own(() => plugin.saveSettings());
    expect(renders).toBe(nachImport);
    t.hide();
    await plugin.api.importEndpoints([{ url: "http://d" }], "chat");
    expect(renders).toBe(nachImport);
  });
});

