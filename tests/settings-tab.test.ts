import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { requestUrl } from "obsidian";
import { makeFakeApp, Setting, TextComponent, ToggleComponent, DropdownComponent, ButtonComponent, ExtraButtonComponent } from "./vendor/kit/obsidian-mock";
import LlmEndpointManagerPlugin from "../src/main";
import { helpSettingDefinition } from "../src/vendor/kit-obsidian/help-setting";
import { LlmEndpointManagerSettingTab, helpOptions, presetText } from "../src/obsidian/settings-tab";
import { setLang } from "../src/vendor/kit/i18n";

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
  it("shows stored model rows with family dropdown and a backend row per endpoint", async () => {
    const { el } = await tab({ endpoints: [{ id: "o", label: "LGS", url: "https://h/api", capabilities: ["chat"], backend: "openwebui", models: [{ id: "verdigado-pro", family: "gpt-oss" }] }] });
    const settings = el.querySelectorAll(".setting-item").map((n) => n.__setting!).filter(Boolean);
    const row = settings.find((s) => s.nameValue === "verdigado-pro")!;
    const dd = row.components.find((c): c is DropdownComponent => c instanceof DropdownComponent)!;
    expect(dd.getValue()).toBe("gpt-oss");
    expect(Object.keys(dd.options)).toEqual(["", "qwen3.8", "qwen3.6", "gemma4", "gpt-oss"]);
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
