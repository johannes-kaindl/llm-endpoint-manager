import { describe, it, expect, vi } from "vitest";
import { autoResolvable, createReachabilityCache, firstActiveUrl, materialize, resolveFirst } from "../src/core/reachability";
import type { ManagedEndpoint } from "../src/core/model";

const ep = (o: Partial<ManagedEndpoint> & { url: string }): ManagedEndpoint => ({
  id: o.id ?? o.url, label: o.url, url: o.url, provider: o.provider ?? "openai", capabilities: o.capabilities ?? ["chat"],
  enabled: o.enabled ?? true, ...(o.model ? { model: o.model } : {}), ...(o.secretId ? { secretId: o.secretId } : {}),
  ...(o.transport ? { transport: o.transport } : {}),
});

describe("createReachabilityCache", () => {
  it("liefert null ohne Eintrag, den Wert innerhalb der TTL, null danach", () => {
    let t = 0;
    const c = createReachabilityCache(() => t, 1000);
    expect(c.get("http://a")).toBeNull();
    c.set("http://a/v1", true);                 // normalisiert: /v1 fällt weg
    expect(c.get("http://a")).toBe(true);
    t = 999; expect(c.get("http://a")).toBe(true);
    t = 1001; expect(c.get("http://a")).toBeNull();
  });
  it("invalidate entfernt genau eine URL, clear alle", () => {
    const c = createReachabilityCache(() => 0);
    c.set("http://a", true); c.set("http://b", false);
    c.invalidate("http://a");
    expect(c.get("http://a")).toBeNull(); expect(c.get("http://b")).toBe(false);
    c.clear(); expect(c.get("http://b")).toBeNull();
  });
});

describe("materialize", () => {
  it("baut EndpointConfig mit Token und Modell", () => {
    const m = materialize(ep({ url: "http://a", secretId: "s", model: "m" }), () => "tok");
    expect(m).toEqual({ ep: expect.objectContaining({ url: "http://a" }), config: { url: "http://a", apiKey: "tok", model: "m" } });
  });
  it("ohne secretId kein apiKey; deaktiviert → disabled; secretId ohne Token → secret-missing", () => {
    expect((materialize(ep({ url: "http://a" }), () => null) as { config: unknown }).config).toEqual({ url: "http://a" });
    expect(materialize(ep({ url: "http://a", enabled: false }), () => null)).toEqual({ error: "disabled" });
    expect(materialize(ep({ url: "http://a", secretId: "s" }), () => null)).toEqual({ error: "secret-missing" });
  });
});

describe("resolveFirst", () => {
  it("nimmt den ersten erreichbaren, aktivierten Eintrag mit der Fähigkeit und cached die Probe", async () => {
    const list = [
      ep({ url: "http://off", enabled: false, capabilities: ["chat"] }),
      ep({ url: "http://emb", capabilities: ["embedding"] }),
      ep({ url: "http://dead" }),
      ep({ url: "http://ok" }),
    ];
    const cache = createReachabilityCache(() => 0);
    const probe = vi.fn((m: { config: { url: string } }) => Promise.resolve(m.config.url === "http://ok"));
    const r = await resolveFirst(list, "chat", cache, probe, () => null);
    expect((r as { ep: ManagedEndpoint }).ep.url).toBe("http://ok");
    expect(probe.mock.calls.map(c => c[0].config.url)).toEqual(["http://dead", "http://ok"]);
    expect(cache.get("http://dead")).toBe(false);
    expect(cache.get("http://ok")).toBe(true);
    // Zweiter Aufruf: keine Probe, alles aus dem Cache
    probe.mockClear();
    await resolveFirst(list, "chat", cache, probe, () => null);
    expect(probe).not.toHaveBeenCalled();
  });
  it("überspringt Einträge mit fehlendem Token und meldet no-endpoint, wenn nichts bleibt", async () => {
    const list = [ep({ url: "http://a", secretId: "s" })];
    const r = await resolveFirst(list, "chat", createReachabilityCache(() => 0), () => Promise.resolve(true), () => null);
    expect(r).toEqual({ error: "no-endpoint" });
  });
  it("überspringt IMMER transport:shortcuts — resolve() kennt kein Opt-in (Default fest http)", async () => {
    const list = [
      ep({ url: "apple-shortcuts://on-device", provider: "apple-shortcuts", transport: "shortcuts" }),
      ep({ url: "http://ok" }),
    ];
    const probe = vi.fn((m: { config: { url: string } }) => Promise.resolve(true));
    const r = await resolveFirst(list, "chat", createReachabilityCache(() => 0), probe, () => null);
    expect((r as { ep: ManagedEndpoint }).ep.url).toBe("http://ok");
    expect(probe.mock.calls.map(c => c[0].config.url)).toEqual(["http://ok"]);
  });
});

describe("firstActiveUrl", () => {
  const tok = (sid: string): string | null => (sid === "ok" ? "t" : null);
  it("liefert die normalisierte URL des ersten aktiven, erreichbaren Eintrags mit der Fähigkeit", () => {
    const eps = [ep({ url: "http://a", enabled: false }), ep({ url: "http://b" }), ep({ url: "http://c/v1" })];
    const known = new Map([["http://b", false], ["http://c", true]]);
    expect(firstActiveUrl(eps, "chat", (u) => known.get(u), tok)).toBe("http://c");
  });
  it("überspringt Einträge ohne Fähigkeit, ohne Token und Kurzbefehle wie resolve", () => {
    const eps = [ep({ url: "http://a", capabilities: ["embedding"] }), ep({ url: "http://b", secretId: "weg" }), ep({ url: "apple-shortcuts://x", transport: "shortcuts" }), ep({ url: "http://d", secretId: "ok" })];
    expect(firstActiveUrl(eps, "chat", () => true, tok)).toBe("http://d");
  });
  it("liefert null, solange kein Eintrag als erreichbar bekannt ist", () => {
    expect(firstActiveUrl([ep({ url: "http://a" })], "chat", () => undefined, tok)).toBeNull();
    expect(firstActiveUrl([ep({ url: "http://a" })], "chat", () => false, tok)).toBeNull();
  });
});

describe("resolve() und transports (Welle 23: anthropic hinter dem Opt-in)", () => {
  const claude = ep({ url: "https://api.anthropic.com", provider: "anthropic", transport: "anthropic", secretId: "ok" });
  const local = ep({ url: "http://ok" });
  const tok = (sid: string): string | null => (sid === "ok" ? "t" : null);
  it("autoResolvable: ohne Opt-in nur http; anthropic nur mit Opt-in; Kurzbefehle nie", () => {
    expect(autoResolvable(local)).toBe(true);
    expect(autoResolvable(claude)).toBe(false);
    expect(autoResolvable(claude, ["http", "anthropic"])).toBe(true);
    expect(autoResolvable(local, ["anthropic"])).toBe(false);
    const apple = ep({ url: "apple-shortcuts://x", transport: "shortcuts" });
    expect(autoResolvable(apple, ["http", "shortcuts", "anthropic"])).toBe(false);
  });
  it("resolveFirst ohne Opt-in überspringt den Claude-Endpunkt, auch wenn er zuerst steht", async () => {
    const probe = vi.fn((m: { config: { url: string } }) => Promise.resolve(true));
    const r = await resolveFirst([claude, local], "chat", createReachabilityCache(() => 0), probe, tok);
    expect((r as { ep: ManagedEndpoint }).ep.url).toBe("http://ok");
    expect(probe.mock.calls.map((c) => c[0].config.url)).toEqual(["http://ok"]);
  });
  it("resolveFirst mit Opt-in nimmt ihn in Listenreihenfolge", async () => {
    const r = await resolveFirst([claude, local], "chat", createReachabilityCache(() => 0), () => Promise.resolve(true), tok, ["http", "anthropic"]);
    expect((r as { ep: ManagedEndpoint }).ep.provider).toBe("anthropic");
  });
  it("firstActiveUrl folgt derselben Regel (die Zeile „aktiv“ zeigt, was resolve wählt)", () => {
    expect(firstActiveUrl([claude, local], "chat", () => true, tok)).toBe("http://ok");
    expect(firstActiveUrl([claude, local], "chat", () => true, tok, ["http", "anthropic"])).toBe("https://api.anthropic.com");
  });
});
