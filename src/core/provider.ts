import { extractModelIds } from "../vendor/kit/endpoint_diagnostics";
import type { Capability, Provider, ShortcutTransportConfig } from "./model";
import { APPLE_SHORTCUTS_URL, DEFAULT_SHORTCUT_NAME, DEFAULT_SHORTCUT_TIMEOUT_MS } from "./model";

export interface ProviderProbe {
  /** Pfad relativ zur normalisierten Basis-URL (ohne /v1), der Erreichbarkeit UND Modell-Liste liefert. */
  path: string;
  models(body: unknown): string[];
}

/** Wire-Format → Probe-Pfad. Der Manager spricht keine Bild-API, er prüft nur, ob der Server
 *  antwortet, und liest, wo es eine gibt, die Modell-Liste. `apple-shortcuts` hat KEINEN
 *  HTTP-Pfad (Spec § Baustein 2): `null` heißt hier "gar nicht per HTTP fragen", nicht "unbekannt"
 *  — Erreichbarkeit läuft für diesen Provider über einen Plattform-Check (src/obsidian/http.ts). */
export function providerProbe(p: Provider): ProviderProbe | null {
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
    case "apple-shortcuts":
      return null;
  }
}

export interface ProviderPreset {
  label: string;
  url: string;
  provider: Provider;
  capabilities: Capability[];
  transport?: "shortcuts";
  shortcut?: ShortcutTransportConfig;
}

export const PRESETS: readonly ProviderPreset[] = [
  { label: "LM Studio", url: "http://localhost:1234", provider: "openai", capabilities: ["chat", "vision", "embedding"] },
  { label: "Ollama", url: "http://localhost:11434", provider: "ollama", capabilities: ["chat", "embedding"] },
  { label: "OpenAI-compatible cloud", url: "https://", provider: "openai", capabilities: ["chat"] },
  {
    label: "Apple Intelligence (on-device)", url: APPLE_SHORTCUTS_URL, provider: "apple-shortcuts", capabilities: ["chat"],
    transport: "shortcuts", shortcut: { name: DEFAULT_SHORTCUT_NAME, timeoutMs: DEFAULT_SHORTCUT_TIMEOUT_MS },
  },
];
