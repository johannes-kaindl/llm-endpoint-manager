import { describe, it, expect } from "vitest";
import { PRESETS, providerProbe } from "../src/core/provider";

describe("providerProbe", () => {
  it("openai und ollama sprechen /v1/models und lesen data[].id", () => {
    for (const p of ["openai", "ollama"] as const) {
      const pp = providerProbe(p);
      expect(pp.path).toBe("/v1/models");
      expect(pp.models({ data: [{ id: "b" }, { id: "a" }] })).toEqual(["a", "b"]);
    }
  });
  it("a1111 liest /sdapi/v1/sd-models title; comfy hat keine Modell-Liste", () => {
    expect(providerProbe("a1111").path).toBe("/sdapi/v1/sd-models");
    expect(providerProbe("a1111").models([{ title: "sdxl.safetensors [abc]" }, { title: "x" }])).toEqual(["sdxl.safetensors [abc]", "x"]);
    expect(providerProbe("comfy").path).toBe("/system_stats");
    expect(providerProbe("comfy").models({ system: {} })).toEqual([]);
  });
  it("Presets tragen Provider und Fähigkeiten", () => {
    expect(PRESETS.map(p => [p.label, p.provider, p.capabilities])).toEqual([
      ["LM Studio", "openai", ["chat", "vision", "embedding"]],
      ["Ollama", "ollama", ["chat", "embedding"]],
      ["OpenAI-compatible cloud", "openai", ["chat"]],
    ]);
  });
});
