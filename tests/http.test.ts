import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest";
import { requestUrl } from "obsidian";
import { listModels, probeStatus } from "../src/obsidian/http";

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
});
