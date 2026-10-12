import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest";
import { requestUrl } from "obsidian";
import { listModels, loadModelContext, probeStatus } from "../src/obsidian/http";
import { classifyEndpointStatus } from "../src/vendor/kit/endpoint_diagnostics";

// Der vendorte Obsidian-Mock (tests/vendor/kit/obsidian-mock.ts) baut `requestUrl` mit einem
// eigenen, dependency-freien Spy-Helfer (`fn`/`MockFn`), nicht mit `vi.fn` — er kennt deshalb
// `mockReset`/`mockClear` und `.mock.calls`, aber NICHT vitests `toHaveBeenCalledWith`/
// `toHaveBeenLastCalledWith` (die verlangen intern eine per tinyspy erkannte Spy-Instanz).
// Aufrufe werden deshalb direkt über `.mock.calls` geprüft statt über die Matcher.
interface MockFnLike {
  (...args: unknown[]): unknown;
  mock: { calls: unknown[][] };
  mockClear(): void;
  mockResolvedValue(v: unknown): void;
  mockRejectedValue(v: unknown): void;
  mockImplementation(impl: (...args: unknown[]) => unknown): void;
}
const rq = requestUrl as unknown as MockFnLike;
beforeEach(() => { rq.mockClear(); });

// Testumgebung ist "node" (kein jsdom, siehe vitest.config.ts) — http.ts braucht
// window.setTimeout/clearTimeout (obsidianmd/prefer-window-timers). Stub global.window
// mit den echten Node-Timern und mach das nach dieser Datei wieder rückgängig
// (Muster übernommen aus obsidian-transmute/tests/http.test.ts).
const hadWindow = "window" in globalThis;
const previousWindow = (globalThis as { window?: unknown }).window;
beforeAll(() => {
  (globalThis as { window?: unknown }).window = { setTimeout, clearTimeout };
});
afterAll(() => {
  if (hadWindow) (globalThis as { window?: unknown }).window = previousWindow;
  else delete (globalThis as { window?: unknown }).window;
});

function lastCallArg(): unknown {
  return rq.mock.calls[rq.mock.calls.length - 1]?.[0];
}

describe("probeStatus/listModels", () => {
  it("openai: GET <base>/v1/models mit Bearer, Modelle sortiert", async () => {
    rq.mockResolvedValue({ status: 200, text: JSON.stringify({ data: [{ id: "z" }, { id: "a" }] }) });
    const st = await probeStatus({ url: "http://h:1234/v1/", apiKey: "tok" }, "openai", 100);
    expect(st.reachable).toBe(true);
    expect(lastCallArg()).toEqual(expect.objectContaining({ url: "http://h:1234/v1/models", headers: { Authorization: "Bearer tok" } }));
    rq.mockResolvedValue({ status: 200, text: JSON.stringify({ data: [{ id: "z" }, { id: "a" }] }) });
    expect(await listModels({ url: "http://h:1234" }, "openai", 100)).toEqual(["a", "z"]);
  });
  it("a1111: eigener Pfad, Titel als Modelle; comfy: erreichbar ohne Modelle", async () => {
    rq.mockResolvedValue({ status: 200, text: JSON.stringify([{ title: "sd" }]) });
    expect(await listModels({ url: "http://h:7860" }, "a1111", 100)).toEqual(["sd"]);
    expect(lastCallArg()).toEqual(expect.objectContaining({ url: "http://h:7860/sdapi/v1/sd-models" }));
    rq.mockResolvedValue({ status: 200, text: "{}" });
    expect((await probeStatus({ url: "http://h:8188" }, "comfy", 100)).reachable).toBe(true);
    expect(await listModels({ url: "http://h:8188" }, "comfy", 100)).toEqual([]);
  });
  it("Netzfehler → nicht erreichbar, leere Liste, kein Wurf", async () => {
    rq.mockRejectedValue(new Error("ECONNREFUSED"));
    expect((await probeStatus({ url: "http://h" }, "openai", 100)).reachable).toBe(false);
    expect(await listModels({ url: "http://h" }, "openai", 100)).toEqual([]);
  });
  it("synchroner Wurf von requestUrl selbst → nicht erreichbar, leere Liste, kein Wurf", async () => {
    // requestUrl(...) kann synchron werfen (bevor .then()/.catch() angehaengt sind) — anders als
    // ein rejected Promise, das mockRejectedValue simuliert. Deckt src/obsidian/http.ts' send().
    rq.mockImplementation(() => { throw new Error("sync boom"); });
    expect((await probeStatus({ url: "http://h" }, "openai", 100)).reachable).toBe(false);
    expect(await listModels({ url: "http://h" }, "openai", 100)).toEqual([]);
  });
  it("apple-shortcuts: reiner Plattform-Check, NIE ein Netzwerk-Aufruf (Spec § Baustein 2)", async () => {
    const st = await probeStatus({ url: "apple-shortcuts://on-device" }, "apple-shortcuts", 100);
    expect(st.reachable).toBe(true);   // obsidian-mock: Platform.isMacOS = true
    expect(rq.mock.calls.length).toBe(0);
    expect(await listModels({ url: "apple-shortcuts://on-device" }, "apple-shortcuts", 100)).toEqual([]);
    expect(rq.mock.calls.length).toBe(0);
  });
  it("a1111/comfy-klartext bei 2xx ist an classifyEndpointStatus['ok'] gebunden, kein freistehendes Literal", async () => {
    // http.ts kann KLARTEXT nicht importieren (privates const in endpoint_diagnostics.ts) und
    // traegt den Text deshalb als eigenes Literal — dieser Test verriegelt beide Werte gegeneinander,
    // damit ein Re-Vendoring mit geaendertem KLARTEXT["ok"] hier sichtbar auseinanderlaeuft statt
    // lautlos zu driften.
    const referenz = classifyEndpointStatus({ kind: "response", status: 200, body: { data: [] } });
    expect(referenz.kind).toBe("ok");
    rq.mockResolvedValue({ status: 200, text: "{}" });
    const a1111 = await probeStatus({ url: "http://h:7860" }, "a1111", 100);
    const comfy = await probeStatus({ url: "http://h:8188" }, "comfy", 100);
    expect(a1111.klartext).toBe(referenz.klartext);
    expect(comfy.klartext).toBe(referenz.klartext);
  });
});

describe("loadModelContext", () => {
  it("LM Studio: fragt /api/v0/models mit dem Schlüssel der Zeile und liefert geladen/max", async () => {
    rq.mockResolvedValue({ status: 200, text: JSON.stringify({ data: [{ id: "m", loaded_context_length: 65536, max_context_length: 262144 }] }) });
    const ctx = await loadModelContext({ url: "http://h:1234/v1", apiKey: "tok", model: "m" }, "openai");
    expect(ctx).toEqual({ loadedContextLength: 65536, maxContextLength: 262144 });
    expect(lastCallArg()).toEqual(expect.objectContaining({ url: "http://h:1234/api/v0/models", headers: { Authorization: "Bearer tok" } }));
  });
  it("ohne Modell, bei a1111/comfy/apple-shortcuts: null und KEINE Anfrage", async () => {
    rq.mockClear();
    expect(await loadModelContext({ url: "http://h:1234" }, "openai")).toBeNull();
    for (const p of ["a1111", "comfy", "apple-shortcuts"] as const) expect(await loadModelContext({ url: "http://h", model: "m" }, p)).toBeNull();
    expect(rq.mock.calls.length).toBe(0);
  });
  it("Server nennt keine Zahl oder antwortet nicht: null, kein Wurf", async () => {
    rq.mockRejectedValue(new Error("ECONNREFUSED"));
    expect(await loadModelContext({ url: "http://h:1234", model: "m" }, "openai")).toBeNull();
  });
});
