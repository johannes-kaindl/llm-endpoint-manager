import { describe, it, expect } from "vitest";
import { DEFAULT_SETTINGS, labelFromUrl, loadSettings, normalizeEndpointEntry, secretIdOf, toPersisted } from "../src/core/model";

const mint = (() => { let n = 0; return () => `id-${++n}`; })();

describe("normalizeEndpointEntry", () => {
  it("ergänzt fehlende Felder mit Defaults und vergibt eine ID", () => {
    expect(normalizeEndpointEntry({ url: "http://localhost:1234" }, () => "x1")).toEqual({
      id: "x1", label: "localhost:1234", url: "http://localhost:1234",
      provider: "openai", capabilities: ["chat"], enabled: true,
    });
  });
  it("verwirft Einträge ohne URL, unbekannte Provider/Fähigkeiten und jedes apiKey", () => {
    expect(normalizeEndpointEntry({ url: "  " }, () => "x")).toBeNull();
    const e = normalizeEndpointEntry({ url: "http://a", provider: "azure", capabilities: ["chat", "magic", "chat"], apiKey: "sk", model: " m " }, () => "x");
    expect(e).toEqual({ id: "x", label: "a", url: "http://a", provider: "openai", capabilities: ["chat"], enabled: true, model: "m" });
    expect(e && "apiKey" in e).toBe(false);
  });
  it("behält id, label, secretId, enabled=false", () => {
    expect(normalizeEndpointEntry({ id: "keep", label: "L", url: "http://a", enabled: false, secretId: "llm-endpoint-manager-keep" }, () => "x"))
      .toMatchObject({ id: "keep", label: "L", enabled: false, secretId: "llm-endpoint-manager-keep" });
  });
});

describe("loadSettings", () => {
  it("liefert Defaults bei null/undefined/Müll", () => {
    expect(loadSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings("x")).toEqual(DEFAULT_SETTINGS);
  });
  it("normalisiert die Liste und setzt version 1", () => {
    const s = loadSettings({ version: 99, endpoints: [{ url: "http://a" }, { url: "" }, 5] }, mint);
    expect(s.version).toBe(1);
    expect(s.endpoints.map(e => e.url)).toEqual(["http://a"]);
  });
});

describe("toPersisted", () => {
  it("entfernt apiKey, auch wenn es zur Laufzeit gesetzt wurde", () => {
    const s = loadSettings({ endpoints: [{ url: "http://a" }] }, mint);
    (s.endpoints[0] as { apiKey?: string }).apiKey = "leak";
    expect("apiKey" in (toPersisted(s).endpoints[0] ?? {})).toBe(false);
  });
});

describe("Hilfen", () => {
  it("secretIdOf nutzt den Plugin-Präfix", () => {
    expect(secretIdOf("3f2a")).toBe("llm-endpoint-manager-3f2a");
  });
  it("labelFromUrl nimmt Host und Port, ohne Schema und Pfad", () => {
    expect(labelFromUrl("http://localhost:1234/v1")).toBe("localhost:1234");
    expect(labelFromUrl("https://api.openai.com")).toBe("api.openai.com");
    expect(labelFromUrl("kaputt")).toBe("kaputt");
  });
});
