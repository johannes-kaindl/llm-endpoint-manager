import { describe, it, expect, vi } from "vitest";
import { createManagerApi, type ApiDeps } from "../src/core/api";
import { loadSettings, type ManagerSettings } from "../src/core/model";
import { MemorySecretStore } from "../src/vendor/kit/secrets";
import { LLM_ENDPOINT_MANAGER_API_VERSION } from "../src/core/api-types";
import { isLlmEndpointManagerApi } from "../src/vendor/kit/endpoint-source";

function deps(initial: ManagerSettings, over: Partial<ApiDeps> = {}) {
  let settings = initial;
  const secrets = new MemorySecretStore();
  const replaceSettings = vi.fn((next: ManagerSettings) => { settings = next; return Promise.resolve(); });
  const probe = vi.fn(() => Promise.resolve(true));
  const listModels = vi.fn(() => Promise.resolve(["b", "a"]));
  let n = 0;
  const d: ApiDeps = { settings: () => settings, replaceSettings, secrets, probe, listModels, now: () => 0, mint: () => `id${++n}`, ...over };
  return { d, secrets, replaceSettings, probe, listModels, current: () => settings };
}
const base = () => loadSettings({ endpoints: [
  { id: "a", label: "A", url: "http://a", capabilities: ["chat"] },
  { id: "b", label: "B", url: "http://b", capabilities: ["embedding", "chat"], model: "m-b", secretId: "llm-endpoint-manager-b" },
] });

describe("createManagerApi", () => {
  it("list/get liefern ApiEndpoint mit defaultModel und hasSecret, ohne Token", () => {
    const { d, secrets } = deps(base());
    secrets.set("llm-endpoint-manager-b", "tok");
    const { api } = createManagerApi(d);
    expect(api.version).toBe(1);
    expect(api.list({ capability: "embedding" }).map(e => e.id)).toEqual(["b"]);
    const b = api.get("b");
    expect(b).toEqual({ id: "b", label: "B", url: "http://b", provider: "openai", capabilities: ["embedding", "chat"], defaultModel: "m-b", enabled: true, hasSecret: true });
    expect(JSON.stringify(b)).not.toContain("tok");
    expect(api.get("zzz")).toBeNull();
  });
  it("resolve nimmt den ersten erreichbaren mit Fähigkeit, trägt Token und Modell, merkt den Aufrufer", async () => {
    const { d, secrets, probe } = deps(base());
    secrets.set("llm-endpoint-manager-b", "tok");
    const h = createManagerApi(d);
    const r = await h.api.resolve("embedding", { caller: "vault-rag" });
    expect(r).toEqual({ id: "b", label: "B", config: { url: "http://b", apiKey: "tok", model: "m-b" }, defaultModel: "m-b" });
    expect(probe).toHaveBeenCalledTimes(1);
    expect(h.callers()).toEqual([{ caller: "vault-rag", capability: "embedding", at: 0 }]);
  });
  it("resolve meldet no-endpoint als Wert; materialize meldet not-found/disabled/secret-missing", async () => {
    const s = base(); s.endpoints[0]!.enabled = false;
    const { d } = deps(s);
    const { api } = createManagerApi(d);
    expect(await api.resolve("vision")).toEqual({ error: "no-endpoint" });
    expect(await api.materialize("nope")).toEqual({ error: "not-found" });
    expect(await api.materialize("a")).toEqual({ error: "disabled" });
    expect(await api.materialize("b")).toEqual({ error: "secret-missing" });
  });
  it("models cached je Endpunkt, force lädt neu", async () => {
    const { d, listModels } = deps(base());
    const { api } = createManagerApi(d);
    expect(await api.models("a")).toEqual(["a", "b"]);
    expect(await api.models("a")).toEqual(["a", "b"]);
    expect(listModels).toHaveBeenCalledTimes(1);
    await api.models("a", { force: true });
    expect(listModels).toHaveBeenCalledTimes(2);
    expect(await api.models("nope")).toEqual({ error: "not-found" });
  });
  it("importEndpoints schreibt Zustand und Secrets und feuert changed", async () => {
    const { d, secrets, replaceSettings, current } = deps(base());
    const h = createManagerApi(d);
    const cb = vi.fn();
    const off = h.api.on("changed", cb);
    const r = await h.api.importEndpoints([{ url: "http://c", apiKey: "sk-c" }, { url: "http://a/v1" }], "vision");
    expect(r).toEqual({ added: ["c"], merged: ["A"], skipped: [] });
    expect(replaceSettings).toHaveBeenCalledTimes(1);
    expect(current().endpoints.map(e => e.url)).toEqual(["http://a", "http://b", "http://c"]);
    expect(current().endpoints[0]?.capabilities).toEqual(["chat", "vision"]);
    expect(secrets.get("llm-endpoint-manager-id1")).toBe("sk-c");
    expect(cb).toHaveBeenCalledTimes(1);
    off();
    h.notifyChanged();
    expect(cb).toHaveBeenCalledTimes(1);
  });
  it("importEndpoints wirft nie, wenn secrets.set wirft — gibt secret-missing als Wert zurück", async () => {
    const throwingSecrets: import("../src/core/api").ApiDeps["secrets"] = {
      get: () => null, has: () => false,
      set: () => { throw new Error("Obsidian SecretStorage did not persist"); },
      delete: () => { /* unbenutzt */ },
    };
    const { d } = deps(base(), { secrets: throwingSecrets });
    const { api } = createManagerApi(d);
    await expect(api.importEndpoints([{ url: "http://c", apiKey: "sk-c" }], "vision")).resolves.toEqual({ error: "secret-missing" });
  });
  it("importEndpoints: replaceSettings ist abgeschlossen, bevor Secrets geschrieben werden — kein verwaistes Secret nach Teilausfall", async () => {
    const order: string[] = [];
    const { d, secrets } = deps(base(), {
      replaceSettings: async () => { order.push("settings"); },
    });
    const originalSet = secrets.set.bind(secrets);
    secrets.set = (id: string, value: string) => { order.push("secret"); originalSet(id, value); };
    const { api } = createManagerApi(d);
    await api.importEndpoints([{ url: "http://c", apiKey: "sk-c" }], "vision");
    expect(order).toEqual(["settings", "secret"]);
  });
  it("Fehler in probe werden als unreachable-Cache-Eintrag behandelt, nicht geworfen", async () => {
    const { d } = deps(base(), { probe: () => Promise.reject(new Error("boom")) });
    const { api } = createManagerApi(d);
    expect(await api.resolve("chat")).toEqual({ error: "no-endpoint" });
  });
  it("die echte API-Instanz besteht die Konsumenten-Formprüfung isLlmEndpointManagerApi", () => {
    const { d } = deps(base());
    const { api } = createManagerApi(d);
    expect(isLlmEndpointManagerApi(api)).toBe(true);
  });
});

describe("api-types Re-Export", () => {
  it("LLM_ENDPOINT_MANAGER_API_VERSION kommt aus dem gevendorten Kit-Modul — eine Quelle", () => {
    expect(LLM_ENDPOINT_MANAGER_API_VERSION).toBe(1);
  });
});

describe("backend and models (additive, API v1)", () => {
  const withMeta = () => loadSettings({ endpoints: [{
    id: "o", label: "LGS", url: "https://h/api", capabilities: ["chat"], model: "verdigado-pro",
    backend: "openwebui", models: [{ id: "verdigado-pro", family: "gpt-oss" }],
  }] });
  it("list/get carry backend and models, version stays 1", () => {
    const { d } = deps(withMeta());
    const { api } = createManagerApi(d);
    expect(api.version).toBe(1);
    expect(isLlmEndpointManagerApi(api)).toBe(true);
    expect(api.get("o")).toMatchObject({ backend: "openwebui", models: [{ id: "verdigado-pro", family: "gpt-oss" }], defaultModel: "verdigado-pro" });
  });
  it("resolve and materialize carry backend and models", async () => {
    const { d } = deps(withMeta());
    const { api } = createManagerApi(d);
    expect(await api.resolve("chat")).toMatchObject({ id: "o", backend: "openwebui", models: [{ id: "verdigado-pro", family: "gpt-oss" }] });
    expect(await api.materialize("o")).toMatchObject({ backend: "openwebui" });
  });
  it("endpoints without meta stay byte-identical to before (existing consumers)", () => {
    const { d } = deps(base());
    const { api } = createManagerApi(d);
    expect(api.get("a")).toEqual({ id: "a", label: "A", url: "http://a", provider: "openai", capabilities: ["chat"], enabled: true, hasSecret: false });
  });
});
