// vendored from code-kit@0.64.0, src/ts/pure/capabilities.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
import { ThinkingSupport } from "./reasoning";
import { familyFromName, type BackendId } from "./sampling-profiles";

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
// Claude: the name starts the id or follows a provider (`anthropic/…`, `us.anthropic.…`). A local model that only carries the word
// (`qwen3.6-claude-opus-distill`, `Claude-4.6-Opus-…-Distilled`, `claude-forge`) is not one: the family of its weights counts, as in
// `FAMILY_PATTERNS`. Every Claude 3 and newer model takes images; `claude-2` and `claude-instant` do not.
const CLAUDE_NAME = /(^|[/.])claude-(?:3|opus|sonnet|haiku|fable|mythos)/;

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
  if (CLAUDE_NAME.test(m)) return "likely";
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
  // Thinking that cannot be switched off, as in the `claude` profile of `sampling-profiles` (`canTurnOff` false: `off` is the lowest
  // effort). `always` here is the guess behind the hint "turning it off will likely do nothing", not the lock of `isAlwaysOnThinker`.
  // Only the models that profile places (since 0.39.0 that includes Opus 4.6, Sonnet 4.6 and Opus 4.5, which have effort levels); the others have a switch and think only when asked.
  if (CLAUDE_NAME.test(m) && familyFromName(m) === "claude") return { support: "always", confidence: "likely" };
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

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

/** The entry of `model` in a model list. `list` names the array (`data` for LM Studio's `/api/v0/models` and the OpenAI-style
 *  `/v1/models`, `models` for the native `/api/v1/models`), `name` the field that holds the model's name (`id`, or `key`). */
function findModel(json: unknown, model: string, list: "data" | "models", name: "id" | "key"): Record<string, unknown> | null {
  const entries = isRecord(json) ? json[list] : undefined;
  if (!Array.isArray(entries)) return null;
  const hit = (entries as unknown[]).find((x) => isRecord(x) && x[name] === model);
  return (hit as Record<string, unknown> | undefined) ?? null;
}

/** LM Studio's `GET /api/v1/models`. Reads the native schema (`{ models: [{ key, capabilities, loaded_instances }] }`, measured
 *  against LM Studio 0.4.26 on 2026-10-18) and, as before, the OpenAI-style `{ data: [{ id, capabilities }] }`. Until 0.31.0
 *  only the second was read, and no LM Studio answers `/api/v1/models` that way — so the probe always fell through to v0, which
 *  knows no thinking. A model is found by its `key` or by the id of one of its loaded instances (`key:2`). */
export function parseLmStudioV1(json: unknown, model: string): Capabilities | null {
  const m = findNativeModel(json, model) ?? findModel(json, model, "data", "id");
  if (!m) return null;
  const caps = (m.capabilities ?? {}) as { vision?: unknown; reasoning?: unknown };
  const vision: Confidence = caps.vision === true ? "confirmed" : "no";
  const canThink = caps.reasoning != null;
  return {
    vision,
    thinking: canThink ? { support: "hybrid", confidence: "confirmed" } : { support: "none", confidence: "no" },
  };
}

function findNativeModel(json: unknown, model: string): Record<string, unknown> | null {
  const byKey = findModel(json, model, "models", "key");
  if (byKey) return byKey;
  const entries = isRecord(json) ? json.models : undefined;
  if (!Array.isArray(entries)) return null;
  const hit = (entries as unknown[]).find((x) => isRecord(x) && Array.isArray(x.loaded_instances)
    && (x.loaded_instances as unknown[]).some((i) => isRecord(i) && i.id === model));
  return (hit as Record<string, unknown> | undefined) ?? null;
}

export function parseLmStudioV0(json: unknown, model: string): Capabilities | null {
  const m = findModel(json, model, "data", "id");
  if (!m) return null;
  const vision: Confidence = m.type === "vlm" ? "confirmed" : "no";
  return { vision, thinking: { support: "none", confidence: "no" } }; // thinking in v0 nicht erkennbar
}

// ── Model kind: embedding or chat ─────────────────────────────────────
/** What a model is for, as far as a server says. `unknown` is the honest third value: the server did not answer, does not know the
 *  model, or does not tell. A caller must not read it as "chat". */
export type ModelKind = "embedding" | "chat" | "unknown";

/** Which answer {@link parseModelKind} reads: Ollama's `POST /api/show`, LM Studio's native `GET /api/v1/models` (also its
 *  OpenAI-style `{ data }` form, like {@link parseLmStudioV1}), or LM Studio's `GET /api/v0/models`. */
export type ModelKindFlavor = "ollama" | "lmstudio-v1" | "lmstudio-v0";

/** LM Studio's `type`: v0 says `embeddings | llm | vlm`, the native v1 says `embedding | llm` (both measured against a local LM Studio
 *  on 2026-11-12); both spellings are accepted on both routes, since a later version may unify them. */
function kindOfType(type: unknown): ModelKind {
  if (type === "embedding" || type === "embeddings") return "embedding";
  if (type === "llm" || type === "vlm") return "chat";
  return "unknown";
}

/** The kind of `model` in one server answer. Ollama: `capabilities` of `/api/show` holds `embedding` for an embedding model and
 *  `completion` for one that generates (an Ollama without `capabilities`, from before 0.6.4, is `unknown`); the answer is for the
 *  one model that was asked, so `model` is not looked up. LM Studio: the entry of `model` in the list, by its `type`. Pure, never
 *  throws; anything it cannot read is `unknown`. */
export function parseModelKind(json: unknown, model: string, flavor: ModelKindFlavor): ModelKind {
  if (flavor === "ollama") {
    const caps = isRecord(json) ? json.capabilities : undefined;
    if (!Array.isArray(caps)) return "unknown";
    if (caps.includes("embedding")) return "embedding";
    return caps.includes("completion") ? "chat" : "unknown";
  }
  const m = flavor === "lmstudio-v1" ? (findNativeModel(json, model) ?? findModel(json, model, "data", "id")) : findModel(json, model, "data", "id");
  return m ? kindOfType(m.type) : "unknown";
}

// ── Geladene Modelle (LM Studio) ─────────────────────────────────────
/** One loaded instance of a model, as LM Studio's native `GET /api/v1/models` reports it in `loaded_instances`. A request for
 *  a model that is NOT in this list makes LM Studio load it just in time and, with a limit on resident models, unload another
 *  one — the thing a caller wants to warn about. */
export interface LoadedModel {
  /** Instance id: the model's key for the first instance, `key:2` for the next. What a request names in `model`. */
  id: string;
  /** The model's key. */
  model: string;
  /** `llm`, `embedding`, … as LM Studio reports it; null if it did not. */
  type: string | null;
  /** Context length this instance was loaded with; null if not reported. */
  contextLength: number | null;
  /** Parallel slots; null if not reported. */
  parallel: number | null;
  /** Seconds until the idle timer unloads it; null if it has none or does not say. */
  remainingTtlSeconds: number | null;
}

const positiveInt = (x: unknown): number | null => (typeof x === "number" && Number.isInteger(x) && x > 0 ? x : null);
const secondsOrNull = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) && x >= 0 ? x : null);

/** The loaded instances in LM Studio's native `/api/v1/models` answer, in the order it reports them (an empty array: the schema
 *  is the native one and nothing is loaded). **null if the answer is not that schema** — an OpenAI-style `{ data }` list, another
 *  server, junk: "unknown" must not read as "nothing loaded", or a caller would warn about a load that is not happening, or not
 *  warn about one that is. Entries without a usable `key` or instance `id` are skipped; a value that is not a plain number
 *  becomes null. */
export function parseLmStudioLoaded(json: unknown): LoadedModel[] | null {
  const entries = isRecord(json) ? json.models : undefined;
  if (!Array.isArray(entries)) return null;
  // `models` alone proves nothing (Ollama's `/api/tags`, llama.cpp and others send a list under that name): the native schema
  // is recognised by an entry with a `key` and a `loaded_instances` list. A list without one is unknown, also an empty one.
  if (!entries.some((m) => isRecord(m) && typeof m.key === "string" && Array.isArray(m.loaded_instances))) return null;
  const out: LoadedModel[] = [];
  for (const m of entries as unknown[]) {
    if (!isRecord(m) || typeof m.key !== "string" || m.key === "" || !Array.isArray(m.loaded_instances)) continue;
    for (const inst of m.loaded_instances as unknown[]) {
      if (!isRecord(inst) || typeof inst.id !== "string" || inst.id === "") continue;
      const config = isRecord(inst.config) ? inst.config : {};
      out.push({
        id: inst.id,
        model: m.key,
        type: typeof m.type === "string" ? m.type : null,
        contextLength: positiveInt(config.context_length),
        parallel: positiveInt(config.parallel),
        remainingTtlSeconds: secondsOrNull(inst.remaining_ttl_seconds),
      });
    }
  }
  return out;
}

/** Whether a request naming `model` finds it loaded: `model` is the key of a loaded model or the id of one of its instances.
 *  The whole name, case-sensitive, as LM Studio compares it. */
export function isModelLoaded(loaded: readonly LoadedModel[], model: string): boolean {
  return model !== "" && loaded.some((l) => l.id === model || l.model === model);
}

/** One plain GET of `/api/v1/models` for what is loaded now (no write, no model is loaded or unloaded by asking). null if the
 *  server did not answer, the adapter threw, or the answer is not the native schema (an older LM Studio, another backend). */
export async function fetchLoadedModels(fetchJson: CapabilityFetch, baseUrl: string): Promise<LoadedModel[] | null> {
  try {
    const r = await fetchJson({ url: `${baseUrl}/api/v1/models` });
    return r ? parseLmStudioLoaded(r.json) : null;
  } catch {
    return null;
  }
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

/** The kind of `model` on a server, asked in the order of {@link fetchCapabilities}: Ollama, LM Studio v1, LM Studio v0. The first
 *  answer that is not `unknown` wins; an answer that does not know the model does not end the sequence. No server, no answer, an
 *  adapter that throws or rejects: `unknown`, never an exception (one try/catch per attempt). Plain reads, except Ollama's POST, which
 *  only asks. */
export async function fetchModelKind(fetchJson: CapabilityFetch, baseUrl: string, model: string): Promise<ModelKind> {
  const attempts: { flavor: ModelKindFlavor; req: Parameters<CapabilityFetch>[0] }[] = [
    { flavor: "ollama", req: { url: `${baseUrl}/api/show`, method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model }) } },
    { flavor: "lmstudio-v1", req: { url: `${baseUrl}/api/v1/models` } },
    { flavor: "lmstudio-v0", req: { url: `${baseUrl}/api/v0/models` } },
  ];
  for (const { flavor, req } of attempts) {
    try {
      const r = await fetchJson(req);
      if (r) { const k = parseModelKind(r.json, model, flavor); if (k !== "unknown") return k; }
    } catch { /* next */ }
  }
  return "unknown";
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
 *  One try/catch per probe, like `fetchCapabilities`.
 *
 *  `loaded` is set only when LM Studio answered `/api/v1/models` in its native schema: the instances loaded at the time of the
 *  probe (possibly none). It is absent for every other backend and for the old `data` schema, because there it is unknown. */
export async function probeEndpoint(
  fetchJson: CapabilityFetch,
  baseUrl: string,
  model: string,
): Promise<{ backend: BackendId; capabilities: Capabilities | null; loaded?: LoadedModel[] }> {
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
  let loaded: LoadedModel[] | undefined;
  try {
    const r = await fetchJson({ url: `${baseUrl}/api/v1/models` });
    if (r) {
      loaded = parseLmStudioLoaded(r.json) ?? undefined;
      const c = parseLmStudioV1(r.json, model);
      if (c) return { backend: "lmstudio", capabilities: c, ...(loaded ? { loaded } : {}) };
    }
  } catch { /* next */ }
  try {
    const r = await fetchJson({ url: `${baseUrl}/api/v0/models` });
    if (r) { const c = parseLmStudioV0(r.json, model); if (c) return { backend: "lmstudio", capabilities: c, ...(loaded ? { loaded } : {}) }; }
  } catch { /* next */ }
  // The native answer alone says it is LM Studio, even when neither list knows the model asked for.
  if (loaded) return { backend: "lmstudio", capabilities: null, loaded };
  return { backend: "unknown", capabilities: null };
}
