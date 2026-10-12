// vendored from code-kit@0.24.0, src/ts/pure/model-context.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
import type { CapabilityFetch } from "./capabilities";
import { withTimeout, type TimeoutTimers } from "./timeout";

export interface ModelContext {
  maxContextLength?: number;
  loadedContextLength?: number;
}

function findById(json: unknown, model: string): Record<string, unknown> | null {
  const data = (json as { data?: unknown }).data;
  if (!Array.isArray(data)) return null;
  const hit = (data as unknown[]).find((x) => (x as { id?: unknown }).id === model);
  return (hit as Record<string, unknown> | undefined) ?? null;
}

/** LM Studio GET /api/v0/models → per-Modell-Kontextlängen. null wenn Modell fehlt. */
export function parseLmStudioContext(json: unknown, model: string): ModelContext | null {
  const m = findById(json, model);
  if (!m) return null;
  const out: ModelContext = {};
  if (typeof m.max_context_length === "number") out.maxContextLength = m.max_context_length;
  if (typeof m.loaded_context_length === "number") out.loadedContextLength = m.loaded_context_length;
  return out;
}

/** Ollama POST /api/show → model_info hält "<arch>.context_length". null wenn nicht vorhanden. */
export function parseOllamaContext(json: unknown): ModelContext | null {
  const info = (json as { model_info?: unknown }).model_info;
  if (!info || typeof info !== "object") return null;
  for (const [k, v] of Object.entries(info as Record<string, unknown>)) {
    if (k.endsWith(".context_length") && typeof v === "number") return { maxContextLength: v };
  }
  return null;
}

/** The context length to rely on: what the server has LOADED, else what the model can do at most, else
 *  `null` ("this endpoint does not say"). The rule every copy wrote on its own. */
export function effectiveContext(ctx: ModelContext | null): number | null {
  return ctx?.loadedContextLength ?? ctx?.maxContextLength ?? null;
}

export interface FetchModelContextOptions {
  /** Timer port for the per-attempt timeout (`window` in Obsidian, a fake in tests). **Required**, not
   *  defaulted: the pure layer may not reach for a global timer, and an optional port would make the
   *  timeout a promise that silently does nothing (`embeddings-client` throws on `requestTimeoutMs`
   *  without `timers` for the same reason). */
  timers: TimeoutTimers;
  /** Per attempt, in ms. Default 5000 (koda-agent, neurovim-obsidian). */
  timeoutMs?: number;
}

/** Asks the endpoint for the context window of `model`: LM Studio `GET {baseUrl}/api/v0/models` first
 *  (it reports the LOADED length, `loaded_context_length`, which Ollama does not know), then Ollama
 *  `POST {baseUrl}/api/show` with `{ model }`. Best effort and informational: **never throws**; `null`
 *  means "this endpoint does not report it" (Open WebUI, vLLM, hosted providers). Use
 *  {@link effectiveContext} for the one number.
 *
 *  Origin: four copies (Welle 18, analysis K11) — koda-agent `core/llm/context-probe.ts`, neurovim-obsidian
 *  `llm/modelContext.ts`, vault-crews `core/local-llm-client.ts` (`modelInfo`), slide-deck `llm-client.ts`.
 *  All four ask LM Studio first, which is the opposite of {@link fetchCapabilities} (Ollama first) on purpose:
 *  there the Ollama answer carries more, here the LM Studio answer does. The transport is the injected
 *  {@link CapabilityFetch}; its adapter decides what a good status is (koda and neurovim took 2xx, slide-deck
 *  only 200, crews none) and returns `{ json }` or `null`.
 *
 *  Each attempt has its own timeout: crews and slide-deck had none, so a server that accepted the connection
 *  and never answered held their UI or orchestrator. A timed-out attempt moves on to the next, like a failed
 *  one; the request itself is not cancelled (Obsidian's `requestUrl` cannot), it just stops being waited for.
 *
 *  `baseUrl` is used as given — the caller passes the origin (`probeBaseUrl`) or `normalizeEndpoint(url)`.
 *  An empty `model` gives `null` without a request: LM Studio answers per model. A model LM Studio knows but
 *  reports no length for ends the search with that (empty) answer — Ollama is not asked (koda's behaviour). */
export async function fetchModelContext(
  fetchJson: CapabilityFetch,
  baseUrl: string,
  model: string,
  opts: FetchModelContextOptions,
): Promise<ModelContext | null> {
  if (model === "") return null;
  const timeoutMs = opts.timeoutMs ?? 5000;
  try {
    const lm = await withTimeout(fetchJson({ url: `${baseUrl}/api/v0/models` }), timeoutMs, opts.timers);
    if (!lm.timedOut && lm.value) {
      const ctx = parseLmStudioContext(lm.value.json, model);
      if (ctx) return ctx;
    }
  } catch { /* on to Ollama */ }
  try {
    const oll = await withTimeout(
      fetchJson({ url: `${baseUrl}/api/show`, method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model }) }),
      timeoutMs,
      opts.timers,
    );
    if (!oll.timedOut && oll.value) {
      const ctx = parseOllamaContext(oll.value.json);
      if (ctx) return ctx;
    }
  } catch { /* nobody reports a window */ }
  return null;
}
