// vendored from code-kit@0.7.0, src/ts/pure/capabilities.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
import { ThinkingSupport } from "./reasoning";
import type { BackendId } from "./sampling-profiles";

export type Confidence = "no" | "likely" | "confirmed";
export interface ThinkingState { support: ThinkingSupport; confidence: Confidence }
export interface Capabilities { vision: Confidence; thinking: ThinkingState }

const RANK: Record<Confidence, number> = { no: 0, likely: 1, confirmed: 2 };
const stronger = (a: Confidence, b: Confidence): Confidence => (RANK[a] >= RANK[b] ? a : b);

const norm = (m: string): string => m.toLowerCase();

// ── L2: Name-Heuristik ───────────────────────────────────────────────
// Vision (high-reliability Substrings/Token); version-gated Ausnahmen separat.
const VISION = [
  "llava", "bakllava", "vision", "pixtral", "moondream", "minicpm-v", "internvl",
  "smolvlm", "cogvlm", "molmo", "nvlm", "aya-vision", "kimi-vl", "ovis", "multimodal",
];
const VISION_TOKEN = /(^|[-_:/. ])vl([-_:/. ]|$)/;        // qwen2-vl, qwen3-vl
const GLM_V = /glm-4(\.\d+)?v/;                            // glm-4v, glm-4.1v, glm-4.5v
// Gemma 3/4 sind multimodal; Schreibweise je Anbieter (Ollama `gemma3:4b`,
// LM Studio `google/gemma-3-4b-it`). Ausnahme: Gemma 3 1b/270m sind text-only.
const GEMMA_VISION = /gemma[-_]?[34]/;
const GEMMA_TEXT = /gemma[-_]?3[-_:]?(1b|270m)/;
const MISTRAL_VISION = /mistral-small.*(3\.1|3\.2)/;

// Thinking always-on
const ALWAYS = [
  "deepseek-r1", "qwq", "-thinking", "magistral", "gpt-oss", "phi-4-reasoning",
  "phi-4-mini-reasoning", "exaone-deep", "glm-z1", "minimax-m1", "seed-oss-thinking",
  "marco-o1", "openthinker",
];
// Thinking hybrid (toggelbar) — Ausnahme: qwen3-instruct-2507 ist non-thinking
const HYBRID = [
  "qwen3", "deepseek-v3.1", "deepseek-v3.2", "granite3.2", "granite3.3",
  "nemotron", "cogito", "glm-4.5", "glm-4.6", "kimi-k2",
];
const QWEN3_NONTHINK = /qwen3-instruct-2507/;

function guessVision(m: string): Confidence {
  if (GEMMA_TEXT.test(m)) return "no";
  if (GEMMA_VISION.test(m)) return "likely";
  if (MISTRAL_VISION.test(m)) return "likely";
  if (/mistral-small/.test(m)) return "no";
  if (GLM_V.test(m)) return "likely";
  if (VISION_TOKEN.test(m)) return "likely";
  if (VISION.some(v => m.includes(v))) return "likely";
  return "no";
}

function guessThinking(m: string): ThinkingState {
  if (QWEN3_NONTHINK.test(m)) return { support: "none", confidence: "no" };
  if (ALWAYS.some(a => m.includes(a))) return { support: "always", confidence: "likely" };
  if (HYBRID.some(h => m.includes(h))) return { support: "hybrid", confidence: "likely" };
  return { support: "none", confidence: "no" };
}

export function guessFromName(model: string): Capabilities {
  const m = norm(model);
  return { vision: guessVision(m), thinking: guessThinking(m) };
}

// ── L1: Metadaten-Parser ─────────────────────────────────────────────
export function parseOllamaShow(json: unknown): Capabilities | null {
  const caps = (json as { capabilities?: unknown })?.capabilities;
  if (!Array.isArray(caps)) return null;
  const arr = caps.filter((x): x is string => typeof x === "string");
  const vision: Confidence = arr.includes("vision") ? "confirmed" : "no";
  const canThink = arr.includes("thinking");
  return {
    vision,
    thinking: canThink ? { support: "hybrid", confidence: "confirmed" } : { support: "none", confidence: "no" },
  };
}

function findModel(json: unknown, model: string): Record<string, unknown> | null {
  const data = (json as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) return null;
  const hit = (data as unknown[]).find(x => (x as { id?: unknown }).id === model);
  return (hit as Record<string, unknown> | undefined) ?? null;
}

export function parseLmStudioV1(json: unknown, model: string): Capabilities | null {
  const m = findModel(json, model);
  if (!m) return null;
  const caps = (m.capabilities ?? {}) as { vision?: unknown; reasoning?: unknown };
  const vision: Confidence = caps.vision === true ? "confirmed" : "no";
  const canThink = caps.reasoning != null;
  return {
    vision,
    thinking: canThink ? { support: "hybrid", confidence: "confirmed" } : { support: "none", confidence: "no" },
  };
}

export function parseLmStudioV0(json: unknown, model: string): Capabilities | null {
  const m = findModel(json, model);
  if (!m) return null;
  const vision: Confidence = m.type === "vlm" ? "confirmed" : "no";
  return { vision, thinking: { support: "none", confidence: "no" } }; // thinking in v0 nicht erkennbar
}

// ── Merge (Monotonie: Live nur hoch) ─────────────────────────────────
export function mergeCapability(
  base: Capabilities | null,
  nameGuess: Capabilities,
  live: { thinking?: boolean; vision?: boolean },
): Capabilities {
  let vision = stronger(base?.vision ?? "no", nameGuess.vision);
  if (live.vision) vision = "confirmed";

  let support: ThinkingSupport;
  if (nameGuess.thinking.support === "always") support = "always";
  else if ((base && base.thinking.support !== "none") || nameGuess.thinking.support === "hybrid") support = "hybrid";
  else support = "none";
  if (live.thinking && support === "none") support = "hybrid";

  let tconf = stronger(base?.thinking.confidence ?? "no", nameGuess.thinking.confidence);
  if (live.thinking) tconf = "confirmed";
  if (support === "none") tconf = "no";

  return { vision, thinking: { support, confidence: tconf } };
}

export function resolveCapabilities(
  meta: Capabilities | null,
  model: string,
  live: { thinking?: boolean; vision?: boolean } = {},
): Capabilities {
  return mergeCapability(meta, guessFromName(model), live);
}

/** Transport-Abstraktion für die Capability-Probe. Der Aufrufer prüft Status/Parsebarkeit und
 *  liefert `null`, wenn dabei nichts Brauchbares herauskommt. Der Wrapper `{ json }` ist
 *  Absicht: `unknown | null` kollabiert in TypeScript zu `unknown` und könnte den Vertrag
 *  „null = fehlgeschlagen" gar nicht ausdrücken. */
export type CapabilityFetch = (req: {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}) => Promise<{ json: unknown } | null>;

/** Probiert native Capability-Endpoints gegen eine Basis-URL (ohne /v1).
 *  `try`/`catch` steht bewusst **pro Versuch**: ein werfender Adapter darf die Sequenz
 *  Ollama → LM Studio v1 → v0 nicht abbrechen. */
export async function fetchCapabilities(
  fetchJson: CapabilityFetch,
  baseUrl: string,
  model: string,
): Promise<Capabilities | null> {
  // 1) Ollama
  try {
    const r = await fetchJson({
      url: `${baseUrl}/api/show`,
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model }),
    });
    if (r) { const c = parseOllamaShow(r.json); if (c) return c; }
  } catch { /* weiter */ }
  // 2) LM Studio v1
  try {
    const r = await fetchJson({ url: `${baseUrl}/api/v1/models` });
    if (r) { const c = parseLmStudioV1(r.json, model); if (c) return c; }
  } catch { /* weiter */ }
  // 3) LM Studio v0
  try {
    const r = await fetchJson({ url: `${baseUrl}/api/v0/models` });
    if (r) { const c = parseLmStudioV0(r.json, model); if (c) return c; }
  } catch { /* weiter */ }
  return null;
}

/** Probes are sent to the origin of the configured endpoint URL (LM Studio `/v1`,
 *  Open WebUI `/api` and Ollama `/v1` all live below it). */
export function probeBaseUrl(endpointUrl: string): string {
  try { return new URL(endpointUrl).origin; } catch { return endpointUrl.replace(/\/+$/, ""); }
}

/** Open WebUI's `GET /api/config` carries a version string and a features object. */
export function parseOpenWebUiConfig(json: unknown): boolean {
  const o = json as { version?: unknown; features?: unknown } | null;
  return !!o && typeof o.version === "string" && typeof o.features === "object" && o.features !== null;
}

/** Which backend answers, plus its capabilities. Open WebUI is asked FIRST: it answers
 *  below `/api/v1/models…` itself and would otherwise be taken for LM Studio.
 *  One try/catch per probe, like `fetchCapabilities`. */
export async function probeEndpoint(
  fetchJson: CapabilityFetch,
  baseUrl: string,
  model: string,
): Promise<{ backend: BackendId; capabilities: Capabilities | null }> {
  try {
    const r = await fetchJson({ url: `${baseUrl}/api/config` });
    if (r && parseOpenWebUiConfig(r.json)) return { backend: "openwebui", capabilities: null };
  } catch { /* next */ }
  try {
    const r = await fetchJson({
      url: `${baseUrl}/api/show`,
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model }),
    });
    if (r) { const c = parseOllamaShow(r.json); if (c) return { backend: "ollama", capabilities: c }; }
  } catch { /* next */ }
  try {
    const r = await fetchJson({ url: `${baseUrl}/api/v1/models` });
    if (r) { const c = parseLmStudioV1(r.json, model); if (c) return { backend: "lmstudio", capabilities: c }; }
  } catch { /* next */ }
  try {
    const r = await fetchJson({ url: `${baseUrl}/api/v0/models` });
    if (r) { const c = parseLmStudioV0(r.json, model); if (c) return { backend: "lmstudio", capabilities: c }; }
  } catch { /* next */ }
  return { backend: "unknown", capabilities: null };
}
