import { describe, it, expect } from "vitest";
import { byCapability, importEndpoints } from "../src/core/list-ops";
import type { ManagedEndpoint } from "../src/core/model";

const ep = (o: Partial<ManagedEndpoint> & { url: string }): ManagedEndpoint => ({
  id: o.id ?? o.url, label: o.label ?? o.url, url: o.url, provider: o.provider ?? "openai",
  capabilities: o.capabilities ?? ["chat"], enabled: o.enabled ?? true, ...(o.model ? { model: o.model } : {}), ...(o.secretId ? { secretId: o.secretId } : {}),
});
const mint = (() => { let n = 0; return () => `n${++n}`; })();

describe("byCapability", () => {
  it("filtert nach Fähigkeit, ohne Filter alles, Reihenfolge bleibt", () => {
    const list = [ep({ url: "a", capabilities: ["chat"] }), ep({ url: "b", capabilities: ["embedding", "chat"] })];
    expect(byCapability(list, "embedding").map(e => e.url)).toEqual(["b"]);
    expect(byCapability(list).map(e => e.url)).toEqual(["a", "b"]);
  });
});

describe("importEndpoints", () => {
  it("legt neue Einträge an: Label aus Host, provider openai, Fähigkeit des Aufrufers, Token als Secret", () => {
    const out = importEndpoints([], [{ url: "http://localhost:1234/v1", apiKey: "sk-1", model: "m" }], "vision", mint, () => false);
    expect(out.result).toEqual({ added: ["localhost:1234"], merged: [], skipped: [] });
    const e = out.endpoints[0];
    expect(e).toMatchObject({ url: "http://localhost:1234", label: "localhost:1234", provider: "openai", capabilities: ["vision"], model: "m", enabled: true });
    expect(e && "apiKey" in e).toBe(false);
    expect(out.secrets).toEqual([{ secretId: `llm-endpoint-manager-${e?.id}`, value: "sk-1" }]);
  });
  it("führt gleiche normalisierte URL zusammen: Fähigkeiten vereinigt, vorhandenes Token bleibt", () => {
    const existing = [ep({ url: "http://a", capabilities: ["chat"], secretId: "llm-endpoint-manager-a" })];
    const out = importEndpoints(existing, [{ url: "http://a/v1/", apiKey: "neu" }], "embedding", mint, () => true);
    expect(out.result).toEqual({ added: [], merged: ["http://a"], skipped: [] });
    expect(out.endpoints[0]?.capabilities).toEqual(["chat", "embedding"]);
    expect(out.secrets).toEqual([]);                      // vorhandenes Token wird nicht überschrieben
  });
  it("setzt beim Zusammenführen ein Token, wenn noch keins gespeichert ist", () => {
    const existing = [ep({ url: "http://a", id: "idA" })];
    const out = importEndpoints(existing, [{ url: "http://a", apiKey: "neu" }], "chat", mint, () => false);
    expect(out.secrets).toEqual([{ secretId: "llm-endpoint-manager-ida", value: "neu" }]);
    expect(out.endpoints[0]?.secretId).toBe("llm-endpoint-manager-ida");
  });
  it("überspringt leere URLs und Duplikate innerhalb der Eingabe", () => {
    const out = importEndpoints([], [{ url: " " }, { url: "http://b" }, { url: "http://b/" }], "chat", mint, () => false);
    expect(out.result.added).toEqual(["b"]);
    expect(out.result.skipped.length).toBe(2);
  });
});
