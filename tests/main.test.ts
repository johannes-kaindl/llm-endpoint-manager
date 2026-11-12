import { describe, it, expect, vi } from "vitest";
import { makeFakeApp } from "./vendor/kit/obsidian-mock";
import LlmEndpointManagerPlugin from "../src/main";

// Modelltyp-Abfrage ersetzen: der Server, den sie fragt, liegt nicht im Test; die Parser und der Ablauf sind in embedding-check.test.ts gegen die gemessenen Antworten geprüft.
const kinds = vi.hoisted(() => ({ byModel: {} as Record<string, "chat" | "embedding" | "unknown">, asked: [] as string[] }));
vi.mock("../src/obsidian/http", async (orig) => ({
  ...(await orig<typeof import("../src/obsidian/http")>()),
  loadLmStudioModelKind: (cfg: { model?: string }) => { kinds.asked.push(cfg.model ?? ""); return Promise.resolve(kinds.byModel[cfg.model ?? ""] ?? "unknown"); },
}));

function plugin(data: unknown, app = makeFakeApp()): LlmEndpointManagerPlugin {
  const p = new LlmEndpointManagerPlugin(app, { id: "llm-endpoint-manager", name: "x", version: "0", minAppVersion: "1.11.4", description: "", author: "", authorUrl: "", isDesktopOnly: false, dir: "" });
  (p as unknown as { loadData: () => Promise<unknown> }).loadData = () => Promise.resolve(data);
  const saved: unknown[] = [];
  (p as unknown as { saveData: (d: unknown) => Promise<void> }).saveData = (d) => { saved.push(d); return Promise.resolve(); };
  (p as unknown as { __saved: unknown[] }).__saved = saved;
  return p;
}

describe("LlmEndpointManagerPlugin", () => {
  it("lädt Settings, hängt die API an und schreibt nie ein apiKey", async () => {
    const p = plugin({ endpoints: [{ url: "http://a", apiKey: "leak" }] });
    await p.onload();
    expect(p.api.version).toBe(1);
    expect(p.settings.endpoints[0]?.url).toBe("http://a");
    await p.saveSettings();
    const saved = (p as unknown as { __saved: Array<{ endpoints: Array<Record<string, unknown>> }> }).__saved;
    expect(saved.at(-1)?.endpoints[0] && "apiKey" in saved.at(-1)!.endpoints[0]!).toBe(false);
  });
  it("setSecret schreibt in den Schlüsselbund, clearSecret und removeEndpoint räumen ihn", async () => {
    const app = makeFakeApp();
    const p = plugin({ endpoints: [{ id: "e1", url: "http://a" }] }, app);
    await p.onload();
    expect(p.keychain).toBe(true);
    const ep = p.settings.endpoints[0]!;
    await p.setSecret(ep, "tok\n");
    expect(app.secretStorage.getSecret("llm-endpoint-manager-e1")).toBe("tok");
    expect(p.settings.endpoints[0]?.secretId).toBe("llm-endpoint-manager-e1");
    await p.clearSecret(ep);
    // Raw app.secretStorage.getSecret bliebe hier bei "" — Obsidian hat keinen Löschaufruf,
    // obsidianSecretStore.delete() schreibt Leerstring (siehe src/vendor/kit-obsidian/secrets.ts).
    // Geprüft wird deshalb über den SecretStore-Wrapper, der "" als null behandelt.
    expect(p.secrets.get("llm-endpoint-manager-e1")).toBeNull();
    expect(p.settings.endpoints[0]?.secretId).toBeUndefined();
    await p.setSecret(ep, "tok2");
    await p.removeEndpoint("e1");
    expect(p.settings.endpoints.length).toBe(0);
    expect(p.secrets.get("llm-endpoint-manager-e1")).toBeNull();
  });
  it("ohne Schlüsselbund: keychain=false, Memory-Store, kein Wurf", async () => {
    const app = makeFakeApp(); delete app.secretStorage;
    const p = plugin({}, app);
    await p.onload();
    expect(p.keychain).toBe(false);
  });
  it("orphanSecrets zählt nur belegte Einträge ohne Endpunkt, cleanOrphanSecrets räumt genau diese", async () => {
    const app = makeFakeApp();
    app.secretStorage.listSecrets = (): string[] => [...(app.secretStorage.__secrets as Map<string, string>).keys()];
    const p = plugin({ endpoints: [{ id: "e1", url: "http://a" }] }, app);
    await p.onload();
    await p.setSecret(p.settings.endpoints[0]!, "keep");
    app.secretStorage.setSecret("llm-endpoint-manager-alt", "x");
    app.secretStorage.setSecret("llm-endpoint-manager-leer", "");   // von Obsidian nur „gelöscht“ (Leerstring)
    app.secretStorage.setSecret("koda-agent-key", "fremd");
    expect(p.orphanSecrets()).toEqual(["llm-endpoint-manager-alt"]);
    expect(p.cleanOrphanSecrets()).toBe(1);
    expect(p.secrets.get("llm-endpoint-manager-alt")).toBeNull();
    expect(p.secrets.get("llm-endpoint-manager-e1")).toBe("keep");
    expect(app.secretStorage.getSecret("koda-agent-key")).toBe("fremd");
    expect(p.orphanSecrets()).toEqual([]);
  });
  it("orphanSecrets ohne listSecrets (ältere API) wirft nicht und liefert nichts", async () => {
    const p = plugin({}, makeFakeApp());
    await p.onload();
    expect(p.orphanSecrets()).toEqual([]);
  });

  it("beim Laden: embedding an einem Chat-Modell wird ausgeschaltet und gespeichert, ein Embedding-Modell und ein stummer Server bleiben", async () => {
    kinds.byModel = { "qwen/qwen3.8-27b": "chat", "text-embedding-nomic-embed-text-v1.5": "embedding" }; kinds.asked = [];
    const caps = ["chat", "embedding"];
    const p = plugin({ endpoints: [
      { id: "lm", label: "LM Studio", url: "http://localhost:1234", provider: "openai", capabilities: caps, enabled: true, model: "qwen/qwen3.8-27b" },
      { id: "emb", label: "Embedder", url: "http://localhost:1235", provider: "openai", capabilities: caps, enabled: true, model: "text-embedding-nomic-embed-text-v1.5" },
      { id: "dead", label: "Offline", url: "http://localhost:1236", provider: "openai", capabilities: caps, enabled: true, model: "irgendwas" },
    ] });
    await p.onload();
    await vi.waitFor(() => expect(p.settings.endpoints.find((e) => e.id === "lm")?.capabilities).toEqual(["chat"]));
    expect(p.settings.endpoints.find((e) => e.id === "emb")?.capabilities).toEqual(["chat", "embedding"]);
    expect(p.settings.endpoints.find((e) => e.id === "dead")?.capabilities).toEqual(["chat", "embedding"]);
    const saved = (p as unknown as { __saved: Array<{ endpoints: Array<{ id: string; capabilities: string[] }> }> }).__saved;
    expect(saved.at(-1)?.endpoints.find((e) => e.id === "lm")?.capabilities).toEqual(["chat"]);
  });
  it("beim Laden: ohne Fähigkeit embedding wird nichts gefragt und nichts gespeichert", async () => {
    kinds.byModel = { m: "chat" }; kinds.asked = [];
    const p = plugin({ endpoints: [{ id: "a", url: "http://a", provider: "openai", capabilities: ["chat"], enabled: true, model: "m" }] });
    await p.onload();
    await Promise.resolve();
    expect(kinds.asked).toEqual([]);
    expect((p as unknown as { __saved: unknown[] }).__saved).toEqual([]);
  });
  const lm = (over: Record<string, unknown> = {}) => ({ id: "lm", label: "LM Studio", url: "http://localhost:1234", provider: "openai", capabilities: ["chat", "embedding"], enabled: true, model: "qwen/qwen3.8-27b", ...over });
  const savedOf = (p: LlmEndpointManagerPlugin) => (p as unknown as { __saved: Array<{ endpoints: Array<{ id: string; capabilities: string[] }>; migrations?: { embeddingOnChatModels?: boolean } }> }).__saved;
  it("die Bereinigung läuft einmal je Bestand: danach steht die Marke in data.json, und ein bewusst wieder angehaktes embedding bleibt beim nächsten Start stehen", async () => {
    kinds.byModel = { "qwen/qwen3.8-27b": "chat" }; kinds.asked = [];
    const first = plugin({ endpoints: [lm()] });
    await first.onload();
    await vi.waitFor(() => expect(first.settings.endpoints[0]?.capabilities).toEqual(["chat"]));
    await vi.waitFor(() => expect(savedOf(first).at(-1)?.migrations).toEqual({ embeddingOnChatModels: true }));
    // Zweiter Start auf dem gespeicherten Bestand, nachdem der Nutzer embedding bewusst wieder eingeschaltet hat.
    const stored = JSON.parse(JSON.stringify(savedOf(first).at(-1)));
    stored.endpoints[0].capabilities = ["chat", "embedding"];
    kinds.asked = [];
    const second = plugin(stored);
    await second.onload();
    await Promise.resolve(); await Promise.resolve();
    expect(kinds.asked).toEqual([]);
    expect(second.settings.endpoints[0]?.capabilities).toEqual(["chat", "embedding"]);
    expect(second.settings.migrations?.embeddingOnChatModels).toBe(true);
  });
  it("ohne Marke läuft die Bereinigung beim nächsten Start; ein schweigender Server verhindert die Marke und nimmt nichts weg", async () => {
    kinds.byModel = {}; kinds.asked = [];
    const p = plugin({ endpoints: [lm()] });
    await p.onload();
    await vi.waitFor(() => expect(kinds.asked).toEqual(["qwen/qwen3.8-27b"]));
    await Promise.resolve(); await Promise.resolve();
    expect(p.settings.endpoints[0]?.capabilities).toEqual(["chat", "embedding"]);
    expect(p.settings.migrations?.embeddingOnChatModels).toBeUndefined();
    expect(savedOf(p)).toEqual([]);
  });
  it("eine Ollama-Zeile behält embedding und wird nicht gefragt; ein frischer Bestand ohne Zeilen bekommt die Marke sofort", async () => {
    kinds.byModel = { "llama3.2:3b": "chat" }; kinds.asked = [];
    const o = plugin({ endpoints: [lm({ id: "oll", label: "Ollama", provider: "ollama", url: "http://localhost:11434", model: "llama3.2:3b" })] });
    await o.onload();
    await vi.waitFor(() => expect(o.settings.migrations?.embeddingOnChatModels).toBe(true));
    expect(kinds.asked).toEqual([]);
    expect(o.settings.endpoints[0]?.capabilities).toEqual(["chat", "embedding"]);
    const fresh = plugin({ endpoints: [] });
    await fresh.onload();
    await vi.waitFor(() => expect(fresh.settings.migrations?.embeddingOnChatModels).toBe(true));
  });
});
