import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { makeFakeApp, Setting, TextComponent, ToggleComponent, DropdownComponent } from "./vendor/kit/obsidian-mock";
import LlmEndpointManagerPlugin from "../src/main";
import { LlmEndpointManagerSettingTab } from "../src/obsidian/settings-tab";

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
});
