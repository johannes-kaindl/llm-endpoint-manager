// vendored from code-kit@0.68.0, src/ts/pure/model-context.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
import { ANTHROPIC_VERSION } from "./anthropic-wire";
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

/** Anthropic `GET /v1/models` → the INPUT window of `model`: `max_input_tokens` of the row whose `id` equals `model`.
 *  `null` when `json` is no record, `data` is no array or no record row carries that id (the first such row wins; a `null` or
 *  non-record row in `data` is skipped, never a throw). `{}` when the model is listed but `max_input_tokens` is not a positive
 *  integer (the API sends `null` for a model it gives no window for): the model is known, the limit is not, so
 *  {@link effectiveContext} answers `null`, as it does for a LM Studio row without a length.
 *
 *  It reads `max_input_tokens` and **never `max_tokens`** (that one is the largest value of the request parameter `max_tokens`, the
 *  OUTPUT limit) and never sets `loadedContextLength` (Anthropic has no "loaded"). There is no field `context_window`.
 *
 *  Not a second `modelCapsFromList`: obsidian-kit's `anthropic-wire.ts` reads `max_tokens`, `effort` and adaptive thinking out of
 *  the same answer; this reads the other field, for the other question. Origin: Welle 27, task "model-context kennt keinen
 *  Anthropic-Zweig" in obsidian-kit. Source: platform.claude.com/docs/en/api/models/list.md (read 2026-10-25). */
export function parseAnthropicContext(json: unknown, model: string): ModelContext | null {
  if (typeof json !== "object" || json === null) return null;
  const data = (json as { data?: unknown }).data;
  if (!Array.isArray(data)) return null;
  for (const row of data as unknown[]) {
    if (typeof row !== "object" || row === null) continue;
    const r = row as Record<string, unknown>;
    if (r.id !== model) continue;
    const n = r.max_input_tokens;
    return typeof n === "number" && Number.isInteger(n) && n > 0 ? { maxContextLength: n } : {};
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
  /** Which API answers. Absent (or `undefined`): the local probe, LM Studio then Ollama, as before. `"anthropic"`: the Anthropic Models
   *  API, one request, see {@link fetchModelContext}. An explicit option and no guess from the URL: a proxy or a gateway hides the host,
   *  and the caller knows the transport from the endpoint manager (`transport === "anthropic"`). */
  provider?: "anthropic" | undefined;
}

/** Asks the endpoint for the context window of `model`: LM Studio `GET {baseUrl}/api/v0/models` first
 *  (it reports the LOADED length, `loaded_context_length`, which Ollama does not know), then Ollama
 *  `POST {baseUrl}/api/show` with `{ model }`. Best effort and informational: **never throws**; `null`
 *  means "this endpoint does not report it" (Open WebUI, vLLM, other hosted providers). Use
 *  {@link effectiveContext} for the one number.
 *
 *  **`opts.provider: "anthropic"`** asks the Anthropic Models API instead, and nothing else: exactly one `GET {baseUrl}/v1/models?limit=1000`
 *  (1000 is the documented maximum; the catalogue has some fifteen rows) with the header `anthropic-version: 2023-06-01`, the window from
 *  {@link parseAnthropicContext} (`max_input_tokens`). No LM Studio or Ollama request follows, and no second page: a model that is not in
 *  the first page (`has_more`) gives `null`, with no further request. Without the option nothing changes: before this branch existed the
 *  same call against an Anthropic host sent `GET /api/v0/models` and `POST /api/show` (paths Anthropic does not have) and answered `null`.
 *  **Why an option and not a URL check:** a proxy or an own gateway hides `api.anthropic.com`; the caller knows its transport.
 *
 *  **The key belongs to the adapter.** The pure branch sends no `x-api-key` and no `Authorization`. Anthropic wants an API key in
 *  `x-api-key` (`Authorization: Bearer` is for OAuth tokens and needs `anthropic-beta: oauth-2025-04-20`), so the adapter that builds
 *  the `CapabilityFetch` must put the key there and must **replace** a `Bearer` header it adds for every other endpoint, not add to it.
 *  An adapter that feeds this branch with the standard Bearer header gets a 401, hence `null`. (An interpretation backed by the
 *  claude-api skill and obsidian-kit's `anthropic-transport.ts`, not by the list page itself, whose curl example shows Bearer.)
 *
 *  **Not measured against the live API (no key, no call):** whether the real list carries alias ids (`claude-haiku-4-5`) or only dated
 *  ones — the id is compared as given, an alias the list does not carry gives `null`; and whether `max_input_tokens` of a model with
 *  tiered pricing (Haiku 5.5: dearer above 100K) is the full window. Source: platform.claude.com/docs/en/api/models/list.md (read 2026-10-25).
 *
 *  Origin: four copies (Welle 18, analysis K11) — koda-agent `core/llm/context-probe.ts`, neurovim-obsidian
 *  `llm/modelContext.ts`, vault-crews `core/local-llm-client.ts` (`modelInfo`), slide-deck `llm-client.ts`.
 *  All four ask LM Studio first, which is the opposite of {@link fetchCapabilities} (Ollama first) on purpose:
 *  there the Ollama answer carries more, here the LM Studio answer does. The Anthropic branch is Welle 27 (task "model-context kennt
 *  keinen Anthropic-Zweig" in obsidian-kit; slide-deck showed "vs ?" for Claude). The transport is the injected
 *  {@link CapabilityFetch}; its adapter decides what a good status is (koda and neurovim took 2xx, slide-deck
 *  only 200, crews none) and returns `{ json }` or `null`.
 *
 *  Each attempt has its own timeout: crews and slide-deck had none, so a server that accepted the connection
 *  and never answered held their UI or orchestrator. A timed-out attempt moves on to the next, like a failed
 *  one (the Anthropic branch has only one, so it answers `null`); the request itself is not cancelled (Obsidian's
 *  `requestUrl` cannot), it just stops being waited for.
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
  if (opts.provider === "anthropic") {
    try {
      const r = await withTimeout(
        fetchJson({ url: `${baseUrl}/v1/models?limit=1000`, headers: { "anthropic-version": ANTHROPIC_VERSION } }),
        timeoutMs,
        opts.timers,
      );
      if (!r.timedOut && r.value) return parseAnthropicContext(r.value.json, model);
    } catch { /* Anthropic does not say */ }
    return null;
  }
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

/** The context window a model NAME announces, or `null`. The convention comes from ONE operator (`gpt-oss:120b-ctx128k`,
 *  `gemma4:31b-ctx128k`): the suffix `-ctxNNNk` names the window the model is loaded with there. It is a heuristic over a
 *  name, not a protocol — it yields a hint, never a value to store silently.
 *
 *  `NNN` is one to four digits; `k` counts 1024 (`128k` → 131072, the Ollama `num_ctx`, not 128000), so that the hint raises no
 *  false alarm for the two common settings 128000 and 131072. The suffix must be followed by the end of the name or a
 *  character that is neither letter nor digit (`-ctx32k:latest`, `-ctx32k-q4`, `-ctx32k.gguf` count; `-ctx128kb`, `-ctx128k2`
 *  do not). Case-insensitive; the first suffix wins. `0k` is no hint.
 *
 *  Origin: koda-agent `src/core/llm/context-hint.ts:7` (n = 1; its header asked for a home "next to `guessFromName`", and
 *  that function is about thinking and vision, this file about the window). Welle 22, Teil 2.
 *
 *  @example contextHintFromModelName("gpt-oss:120b-ctx128k") // → 131072 */
export function contextHintFromModelName(name: string | undefined): number | null {
  if (name === undefined) return null;
  const m = /-ctx(\d{1,4})k(?![a-z0-9])/i.exec(name);
  if (m === null) return null;
  const k = parseInt(m[1] ?? "", 10);
  return k > 0 ? k * 1024 : null;
}

/** The smallest hint below `current`, else `null`. Warns only downwards: a window at the model that is larger than the
 *  setting costs at most some utilisation, a smaller one lets the plugin send more than the model takes. `null`, `undefined`,
 *  zero and negative candidates are ignored. Origin: koda-agent `src/core/llm/context-hint.ts:22`. */
export function lowerContextHint(current: number, candidates: ReadonlyArray<number | null | undefined>): number | null {
  let min: number | null = null;
  for (const c of candidates) {
    if (typeof c === "number" && c > 0 && c < current && (min === null || c < min)) min = c;
  }
  return min;
}
