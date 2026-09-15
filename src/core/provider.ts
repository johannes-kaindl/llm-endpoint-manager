import { extractModelIds } from "../vendor/kit/endpoint_diagnostics";
import type { Capability, Provider } from "./model";

export interface ProviderProbe {
  /** Pfad relativ zur normalisierten Basis-URL (ohne /v1), der Erreichbarkeit UND Modell-Liste liefert. */
  path: string;
  models(body: unknown): string[];
}

/** Wire-Format → Probe-Pfad. Der Manager spricht keine Bild-API, er prüft nur, ob der Server
 *  antwortet, und liest, wo es eine gibt, die Modell-Liste. */
export function providerProbe(p: Provider): ProviderProbe {
  switch (p) {
    case "openai":
    case "ollama":
      return { path: "/v1/models", models: (body) => extractModelIds(body).sort() };
    case "a1111":
      return {
        path: "/sdapi/v1/sd-models",
        models: (body) => Array.isArray(body)
          ? body.map((m) => (m && typeof m === "object" && typeof (m as { title?: unknown }).title === "string" ? (m as { title: string }).title : "")).filter(Boolean)
          : [],
      };
    case "comfy":
      return { path: "/system_stats", models: () => [] };
  }
}

export const PRESETS: ReadonlyArray<{ label: string; url: string; provider: Provider; capabilities: Capability[] }> = [
  { label: "LM Studio", url: "http://localhost:1234", provider: "openai", capabilities: ["chat", "vision", "embedding"] },
  { label: "Ollama", url: "http://localhost:11434", provider: "ollama", capabilities: ["chat", "embedding"] },
  { label: "OpenAI-compatible cloud", url: "https://", provider: "openai", capabilities: ["chat"] },
];
