import { describe, it, expect } from "vitest";
import { PRESETS, providerProbe } from "../src/core/provider";
import { APPLE_SHORTCUTS_URL, DEFAULT_SHORTCUT_NAME, DEFAULT_SHORTCUT_TIMEOUT_MS } from "../src/core/model";

describe("providerProbe", () => {
  it("openai und ollama sprechen /v1/models und lesen data[].id", () => {
    for (const p of ["openai", "ollama"] as const) {
      const pp = providerProbe(p);
      expect(pp?.path).toBe("/v1/models");
      expect(pp?.models({ data: [{ id: "b" }, { id: "a" }] })).toEqual(["a", "b"]);
    }
  });
  it("a1111 liest /sdapi/v1/sd-models title; comfy hat keine Modell-Liste", () => {
    expect(providerProbe("a1111")?.path).toBe("/sdapi/v1/sd-models");
    expect(providerProbe("a1111")?.models([{ title: "sdxl.safetensors [abc]" }, { title: "x" }])).toEqual(["sdxl.safetensors [abc]", "x"]);
    expect(providerProbe("comfy")?.path).toBe("/system_stats");
    expect(providerProbe("comfy")?.models({ system: {} })).toEqual([]);
  });
  it("apple-shortcuts hat KEINEN HTTP-Pfad", () => {
    expect(providerProbe("apple-shortcuts")).toBeNull();
  });
  it("Presets tragen Provider und Fähigkeiten", () => {
    expect(PRESETS.map(p => [p.label, p.provider, p.capabilities])).toEqual([
      ["LM Studio", "openai", ["chat", "vision", "embedding"]],
      ["Ollama", "ollama", ["chat", "embedding"]],
      ["OpenAI-compatible cloud", "openai", ["chat"]],
      ["Apple Intelligence (on-device)", "apple-shortcuts", ["chat"]],
    ]);
  });
  it("Presets mit eigener Bezeichnung tragen einen i18n-Schluessel (Marken wie LM Studio und Ollama nicht)", () => {
    expect(PRESETS.map(p => [p.label, p.labelKey])).toEqual([
      ["LM Studio", undefined],
      ["Ollama", undefined],
      ["OpenAI-compatible cloud", "preset.cloud"],
      ["Apple Intelligence (on-device)", "preset.apple"],
    ]);
  });
  it("Apple-Preset traegt transport/shortcut und die feste Sentinel-URL", () => {
    const preset = PRESETS.find((p) => p.provider === "apple-shortcuts");
    expect(preset?.url).toBe(APPLE_SHORTCUTS_URL);
    expect(preset?.transport).toBe("shortcuts");
    expect(preset?.shortcut).toEqual({ name: DEFAULT_SHORTCUT_NAME, timeoutMs: DEFAULT_SHORTCUT_TIMEOUT_MS });
  });
});
