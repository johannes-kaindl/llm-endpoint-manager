import { describe, it, expect } from "vitest";
import { dropEmbeddingOnChatModels, embeddingVerdict, modelKindAskable } from "../src/core/embedding-check";
import { fetchModelKind, type CapabilityFetch, type ModelKind } from "../src/vendor/kit/capabilities";
import type { ManagedEndpoint } from "../src/core/model";

const ep = (over: Partial<ManagedEndpoint> = {}): ManagedEndpoint => ({
  id: "a", label: "A", url: "http://localhost:1234", provider: "openai", capabilities: ["chat", "embedding"], enabled: true, model: "qwen/qwen3.8-27b", ...over,
});

/** Antworten wie gemessen (2026-11-12, lokales LM Studio und Ollama): LM Studio v0 `type` embeddings|llm|vlm, v1 `type` embedding|llm, Ollama `capabilities`. */
const lmstudioV0 = { data: [{ id: "qwen/qwen3.8-27b", type: "llm" }, { id: "text-embedding-nomic-embed-text-v1.5", type: "embeddings" }] };
const lmstudioV1 = { models: [{ key: "qwen/qwen3.8-27b", type: "llm", loaded_instances: [] }, { key: "text-embedding-nomic-embed-text-v1.5", type: "embedding", loaded_instances: [] }] };
const ollamaChat = { capabilities: ["completion", "tools"] };
const ollamaEmbedding = { capabilities: ["tools", "embedding"] };

const server = (answers: Record<string, unknown>): CapabilityFetch => async (req) => {
  const key = `${req.method ?? "GET"} ${new URL(req.url).pathname}`;
  return key in answers ? { json: answers[key] } : null;
};

describe("embeddingVerdict", () => {
  it("ohne Fähigkeit embedding: nichts zu sagen", () => {
    expect(embeddingVerdict(ep({ capabilities: ["chat"] }), "chat")).toBe("none");
  });
  it("ein Chat-Modell mit embedding ist ein Widerspruch", () => {
    expect(embeddingVerdict(ep(), "chat")).toBe("mismatch");
  });
  it("ein Embedding-Modell mit embedding ist in Ordnung", () => {
    expect(embeddingVerdict(ep({ model: "text-embedding-nomic-embed-text-v1.5" }), "embedding")).toBe("ok");
  });
  it("unbekannt, kein Modell oder kein Server ist ungeprüft, nie ein Widerspruch", () => {
    expect(embeddingVerdict(ep(), "unknown")).toBe("unverified");
    expect(embeddingVerdict(ep({ model: undefined }), "chat")).toBe("unverified");
    expect(embeddingVerdict(ep({ model: "  " }), "chat")).toBe("unverified");
  });
  it("Bild-, Kurzbefehl- und Claude-Zeilen haben keine Modelltyp-Abfrage: kein Urteil", () => {
    for (const provider of ["a1111", "comfy", "apple-shortcuts", "anthropic"] as const) expect(embeddingVerdict(ep({ provider }), "chat")).toBe("none");
  });
});

describe("modelKindAskable", () => {
  it("nur openai und ollama mit einem Modell", () => {
    expect(modelKindAskable(ep())).toBe(true);
    expect(modelKindAskable(ep({ provider: "ollama" }))).toBe(true);
    expect(modelKindAskable(ep({ model: "" }))).toBe(false);
    expect(modelKindAskable(ep({ provider: "a1111" }))).toBe(false);
  });
});

describe("Modelltyp aus den gemessenen Serverantworten (Kit fetchModelKind) → Urteil, in beide Richtungen", () => {
  const verdict = async (e: ManagedEndpoint, answers: Record<string, unknown>) => embeddingVerdict(e, await fetchModelKind(server(answers), "http://localhost:1234", e.model ?? ""));
  it("LM Studio v0: qwen/qwen3.8-27b warnt, text-embedding-nomic-embed-text-v1.5 nicht", async () => {
    expect(await verdict(ep(), { "GET /api/v0/models": lmstudioV0 })).toBe("mismatch");
    expect(await verdict(ep({ model: "text-embedding-nomic-embed-text-v1.5" }), { "GET /api/v0/models": lmstudioV0 })).toBe("ok");
  });
  it("LM Studio v1: dasselbe", async () => {
    expect(await verdict(ep(), { "GET /api/v1/models": lmstudioV1 })).toBe("mismatch");
    expect(await verdict(ep({ model: "text-embedding-nomic-embed-text-v1.5" }), { "GET /api/v1/models": lmstudioV1 })).toBe("ok");
  });
  it("Ollama: llama3.2:3b warnt, qwen3-embedding:8b nicht", async () => {
    expect(await verdict(ep({ provider: "ollama", model: "llama3.2:3b" }), { "POST /api/show": ollamaChat })).toBe("mismatch");
    expect(await verdict(ep({ provider: "ollama", model: "qwen3-embedding:8b" }), { "POST /api/show": ollamaEmbedding })).toBe("ok");
  });
  it("kein Server oder ein Server ohne Antwort zum Modell ist gelb (ungeprüft), nicht rot", async () => {
    expect(await verdict(ep(), {})).toBe("unverified");
    expect(await verdict(ep({ model: "gibt-es-nicht" }), { "GET /api/v0/models": lmstudioV0 })).toBe("unverified");
  });
});

describe("dropEmbeddingOnChatModels (Bestand beim Laden)", () => {
  const kinds = (m: Record<string, ModelKind>) => (e: ManagedEndpoint): Promise<ModelKind> => Promise.resolve(m[e.id] ?? "unknown");
  it("nimmt embedding von einem Chat-Modell weg und lässt alles andere unberührt", async () => {
    const eps = [
      ep({ id: "chat-llm", label: "LM Studio" }),
      ep({ id: "emb", label: "Embedder", model: "text-embedding-nomic-embed-text-v1.5" }),
      ep({ id: "dead", label: "Offline" }),
      ep({ id: "plain", label: "Nur Chat", capabilities: ["chat"] }),
    ];
    const r = await dropEmbeddingOnChatModels(eps, kinds({ "chat-llm": "chat", emb: "embedding", dead: "unknown", plain: "chat" }));
    expect(r.dropped).toEqual(["LM Studio"]);
    expect(r.endpoints.find((e) => e.id === "chat-llm")?.capabilities).toEqual(["chat"]);
    expect(r.endpoints.find((e) => e.id === "emb")?.capabilities).toEqual(["chat", "embedding"]);
    expect(r.endpoints.find((e) => e.id === "dead")?.capabilities).toEqual(["chat", "embedding"]);
    expect(r.endpoints.find((e) => e.id === "plain")?.capabilities).toEqual(["chat"]);
  });
  it("fragt nur, wo es eine Antwort geben kann (embedding gesetzt, openai/ollama, Modell da)", async () => {
    const asked: string[] = [];
    const eps = [ep({ id: "x" }), ep({ id: "img", provider: "a1111" }), ep({ id: "nomodel", model: undefined }), ep({ id: "nocap", capabilities: ["chat"] })];
    await dropEmbeddingOnChatModels(eps, (e) => { asked.push(e.id); return Promise.resolve("chat"); });
    expect(asked).toEqual(["x"]);
  });
  it("ändert die Eingabe nicht und meldet bei nichts zu tun eine leere Liste", async () => {
    const eps = [ep()];
    const r = await dropEmbeddingOnChatModels(eps, kinds({ a: "embedding" }));
    expect(r.dropped).toEqual([]);
    const r2 = await dropEmbeddingOnChatModels(eps, kinds({ a: "chat" }));
    expect(r2.dropped).toEqual(["A"]);
    expect(eps[0]?.capabilities).toEqual(["chat", "embedding"]);
  });
  it("eine Ollama-Zeile behält embedding, auch wenn der Server „Chat“ meint: dort ist Chat nur aus der fehlenden Fähigkeit geschlossen, und es wird nicht einmal gefragt", async () => {
    const asked: string[] = [];
    const r = await dropEmbeddingOnChatModels([ep({ id: "oll", label: "Ollama", provider: "ollama", model: "llama3.2:3b" })], (e) => { asked.push(e.id); return Promise.resolve("chat"); });
    expect(asked).toEqual([]);
    expect(r.dropped).toEqual([]);
    expect(r.endpoints[0]?.capabilities).toEqual(["chat", "embedding"]);
    expect(r.complete).toBe(true);
  });
  it("complete: wahr, wenn jede gefragte Zeile geantwortet hat; ein stummer Server macht es falsch; nichts zu fragen ist vollständig", async () => {
    const eps = [ep({ id: "a" }), ep({ id: "b", capabilities: ["chat"] })];
    expect((await dropEmbeddingOnChatModels(eps, kinds({ a: "embedding" }))).complete).toBe(true);
    expect((await dropEmbeddingOnChatModels(eps, kinds({ a: "chat" }))).complete).toBe(true);
    expect((await dropEmbeddingOnChatModels(eps, kinds({ a: "unknown" }))).complete).toBe(false);
    expect((await dropEmbeddingOnChatModels(eps, () => Promise.reject(new Error("weg")))).complete).toBe(false);
    expect((await dropEmbeddingOnChatModels([], kinds({}))).complete).toBe(true);
    expect((await dropEmbeddingOnChatModels([ep({ id: "c", capabilities: ["chat"] })], kinds({}))).complete).toBe(true);
  });
});
