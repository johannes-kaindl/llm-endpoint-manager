// vendored from code-kit@0.28.0, src/ts/pure/sampling-profiles.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
/** Request profiles for local and hosted LLM backends: which sampling values, which
 *  reasoning_effort and which minimum token budget a plugin sends, per model family × mode,
 *  and which of those fields a backend actually honours.
 *
 *  Every value carries its source and whether it was measured. The tables are data, not
 *  policy: a plugin picks the mode, the user may override per mode × family, and the
 *  explanation returned by `resolveRequestParams` is what the settings UI shows.
 *
 *  Sources (full references in the design spec, obsidian-kit cockpit, 2026-09-23):
 *  - llm-setup `docs/reference/setup.md` (LM Studio 0.4.24+1, MLX 1.11.0, measured 2026-09-18..23)
 *  - verdigado/llm-configs `docs/reference/basismodelle.md`, `openwebui-api.md`
 *    (Open WebUI 0.11.3, measured 2026-09-15..22)
 *  - model cards as named per value. */

import { reasoningHappened } from "./reasoning";
import { stripThinkBlocks } from "./think-splitter";

export const FAMILY_IDS = ["qwen3.8", "qwen3.6", "gemma4", "gpt-oss", "claude"] as const;
export type FamilyId = (typeof FAMILY_IDS)[number];
/** Override key: a known family, or "unknown" for models the kit cannot place. */
export type FamilyKey = FamilyId | "unknown";

export const MODE_IDS = ["agent", "structured", "transform", "grounded", "companion", "creative", "complete"] as const;
export type ModeId = (typeof MODE_IDS)[number];

export const BACKEND_IDS = ["lmstudio", "openwebui", "ollama", "openai", "anthropic", "unknown"] as const;
export type BackendId = (typeof BACKEND_IDS)[number];

export const THINKING_LEVELS = ["off", "low", "medium", "high"] as const;
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

/** Sampling fields a family supplies (temperature comes from the mode). */
export type FamilyField = "top_p" | "top_k" | "min_p" | "presence_penalty";
export type FieldId = "temperature" | FamilyField | "reasoning_effort" | "max_tokens";
/** Display and explanation order. */
export const FIELD_ORDER: readonly FieldId[] = [
  "temperature", "top_p", "top_k", "min_p", "presence_penalty", "reasoning_effort", "max_tokens",
];

export type Evidence = "measured" | "unmeasured";
/** effective = measured to work · accepted = accepted, effect unproven ·
 *  ignored = measured to have no effect · unsupported = backend does not know it / unmeasured. */
export type FieldSupport = "effective" | "accepted" | "ignored" | "unsupported";

export interface Sourced<V> { value: V; source: string; evidence: Evidence }

export interface FamilyProfile {
  label: string;
  /** Values while the model thinks (level !== "off"). */
  thinking: Partial<Record<FamilyField, Sourced<number>>>;
  /** Values with thinking off. */
  noThinking: Partial<Record<FamilyField, Sourced<number>>>;
  effort: Record<ThinkingLevel, Sourced<string>>;
  /** False when no reasoning_effort value switches thinking off (gpt-oss). */
  canTurnOff: boolean;
  /** Lower bound for temperature while thinking (vendor warns against greedy decoding). */
  thinkingTemperatureFloor?: Sourced<number>;
  /** Minimum max_tokens per level so thinking cannot eat the whole budget. */
  reserve: Record<ThinkingLevel, Sourced<number>>;
  /** Where one backend changes what the family does with the thinking level — measured per cell (family × backend),
   *  never guessed for the others. Read through {@link familyThinking}, not directly. */
  byBackend?: Partial<Record<BackendId, BackendThinking>>;
  /** Fields the family's API refuses on EVERY backend (a 400, not a no-op), so no mode, override or backend table can
   *  make them go out. The value is the reason; the source says where it was read. */
  unsupportedFields?: Partial<Record<FieldId, Sourced<string>>>;
}

/** What a backend changes for one family. A level or the whole `canTurnOff` that is not named stays the family's. */
export interface BackendThinking {
  canTurnOff?: boolean;
  effort?: Partial<Record<ThinkingLevel, Sourced<string>>>;
  reserve?: Partial<Record<ThinkingLevel, Sourced<number>>>;
}

export interface ModeProfile { temperature: Sourced<number>; thinking: ThinkingLevel }
export interface BackendProfile {
  label: string;
  fields: Record<FieldId, FieldSupport>;
  source: string;
  /** Name of the request key `reasoning_effort` is sent under when the backend calls it something else
   *  (`effort` on Anthropic). The explain row keeps the field name `reasoning_effort`. A FLAT key: the native Messages API
   *  wants it nested as `output_config.effort`, which the transport builds. */
  effortParam?: string;
  /** The effort values the backend takes. A value outside the list (`none` from a qwen mapping or an override) is not sent. */
  effortValues?: readonly string[];
}

const m = (value: number, source: string): Sourced<number> => ({ value, source, evidence: "measured" });
const u = (value: number, source: string): Sourced<number> => ({ value, source, evidence: "unmeasured" });
const ms = (value: string, source: string): Sourced<string> => ({ value, source, evidence: "measured" });
const us = (value: string, source: string): Sourced<string> => ({ value, source, evidence: "unmeasured" });

const CLAUDE_SAMPLING = "Anthropic docs (claude-api skill 2026-10-06; OpenAI compatibility page 2026-10-16): temperature, top_p, top_k removed on Claude Fable 5/5.1, Opus 5.5/5/4.8/4.7, non-default values refused on Sonnet 5.5 and Haiku 5.5; compatibility layer: temperature below 1 and top_p other than 0.99 return 400 on Claude 4.7 and newer";
const CLAUDE_EFFORT = "Anthropic docs (claude-api skill 2026-10-06): output_config.effort low/medium/high/xhigh/max; not called by us";
const CLAUDE_OFF = "Anthropic docs (claude-api skill 2026-10-06): thinking {type: disabled} returns 400 on Opus 5.5 and Sonnet 5.5, thinking is always on on Fable 5/5.1, so off is the lowest effort";
const CLAUDE_RESERVE = "Anthropic docs (claude-api skill 2026-10-06): max_tokens includes the adaptive thinking, default ~16000; conservative, unmeasured";
const cn = (value: string, source: string): Sourced<string> => ({ value, source, evidence: "unmeasured" });
const QWEN38_CARD = "model card Qwen/Qwen3.8-27B (retrieved 2026-09-20)";
const QWEN_GREEDY = "Qwen docs quickstart (Qwen3): no greedy decoding while thinking; transferred, supported by harness night run 2026-09-19";
const HARNESS = "llm-benchmark-harness night run 2026-09-19, max reasoning tokens per level, rounded up";
const GEMMA_LMS = "kitcc-w22 2026-10-14, google/gemma-4-e4b on LM Studio (one model size): none ignored, thought in content; low/minimal/medium/high/no field think into reasoning_content";
const LMS_EFFORT = "llm-setup 2026-09-18, reasoning tokens none 0 / low 226 / medium 251 / xhigh 930";

export const FAMILIES: Record<FamilyId, FamilyProfile> = {
  "qwen3.8": {
    label: "Qwen 3.8",
    thinking: { top_p: u(0.95, QWEN38_CARD), top_k: u(20, QWEN38_CARD), min_p: u(0, QWEN38_CARD) },
    noThinking: {
      top_p: u(0.8, QWEN38_CARD), top_k: u(20, QWEN38_CARD), min_p: u(0, QWEN38_CARD),
      presence_penalty: u(1.5, QWEN38_CARD),
    },
    effort: {
      off: ms("none", LMS_EFFORT), low: ms("low", LMS_EFFORT),
      medium: ms("medium", LMS_EFFORT), high: ms("xhigh", LMS_EFFORT),
    },
    canTurnOff: true,
    thinkingTemperatureFloor: u(0.6, QWEN_GREEDY),
    reserve: { off: u(0, "no thinking"), low: u(1024, HARNESS), medium: u(2048, HARNESS), high: u(32768, HARNESS) },
  },
  "qwen3.6": {
    label: "Qwen 3.6",
    thinking: { top_p: u(0.95, "LM Studio hub model.yaml (llm-setup)"), top_k: u(20, "LM Studio hub model.yaml (llm-setup)") },
    noThinking: { top_p: u(0.95, "LM Studio hub model.yaml (llm-setup)"), top_k: u(20, "LM Studio hub model.yaml (llm-setup)") },
    effort: {
      off: us("none", "transferred from qwen3.8"), low: us("low", "transferred from qwen3.8"),
      medium: us("medium", "transferred from qwen3.8"), high: us("high", "transferred from qwen3.8"),
    },
    canTurnOff: true,
    thinkingTemperatureFloor: u(0.6, QWEN_GREEDY),
    reserve: { off: u(0, "no thinking"), low: u(1024, "transferred from qwen3.8"), medium: u(2048, "transferred from qwen3.8"), high: u(32768, "transferred from qwen3.8") },
  },
  gemma4: {
    label: "Gemma 4",
    thinking: { top_p: u(0.95, "Gemma 4 model card (llm-configs 2026-09-17)"), top_k: u(64, "Gemma 4 model card (llm-configs 2026-09-17)") },
    noThinking: { top_p: u(0.95, "Gemma 4 model card (llm-configs 2026-09-17)"), top_k: u(64, "Gemma 4 model card (llm-configs 2026-09-17)") },
    effort: {
      off: ms("none", "llm-configs 2026-09-17, verdigado-think: 583 -> 0 reasoning chars"),
      low: us("low", "unmeasured"), medium: us("medium", "unmeasured"), high: us("high", "unmeasured"),
    },
    canTurnOff: true,
    reserve: { off: u(0, "no thinking"), low: u(1024, "unmeasured, conservative"), medium: u(2048, "unmeasured, conservative"), high: u(8192, "unmeasured, conservative") },
    byBackend: {
      lmstudio: {
        canTurnOff: false,
        effort: { off: ms("low", GEMMA_LMS) },
        reserve: { off: u(1024, "thinks at the level of low when off (" + GEMMA_LMS + "); reserve of low") },
      },
    },
  },
  "gpt-oss": {
    label: "gpt-oss",
    thinking: { top_p: u(1.0, "openai/gpt-oss repo (llm-configs 2026-09-17)") },
    noThinking: { top_p: u(1.0, "openai/gpt-oss repo (llm-configs 2026-09-17)") },
    effort: {
      off: ms("minimal", "llm-configs, verdigado-pro: none 187 / low 55 / minimal 41 reasoning chars"),
      low: ms("low", "llm-configs, verdigado-pro: 55 reasoning chars"),
      medium: us("medium", "unmeasured"), high: us("high", "unmeasured"),
    },
    canTurnOff: false,
    reserve: {
      off: m(256, "llm-configs: max_tokens 40 left content empty, 60 answered; 256 as margin"),
      low: u(1024, "unmeasured"), medium: u(2048, "unmeasured"), high: u(8192, "unmeasured"),
    },
  },
  claude: {
    label: "Claude",
    thinking: {},
    noThinking: {},
    effort: {
      off: us("low", CLAUDE_OFF), low: us("low", CLAUDE_EFFORT),
      medium: us("medium", CLAUDE_EFFORT), high: us("high", CLAUDE_EFFORT),
    },
    canTurnOff: false,
    reserve: {
      off: u(2048, CLAUDE_RESERVE), low: u(2048, CLAUDE_RESERVE), medium: u(4096, CLAUDE_RESERVE), high: u(16000, CLAUDE_RESERVE),
    },
    unsupportedFields: {
      temperature: cn("HTTP 400 on Claude 4.7 and newer", CLAUDE_SAMPLING),
      top_p: cn("HTTP 400 on Claude 4.7 and newer", CLAUDE_SAMPLING),
      top_k: cn("HTTP 400 on Claude 4.7 and newer", CLAUDE_SAMPLING),
      min_p: cn("not a Claude parameter", CLAUDE_SAMPLING),
      presence_penalty: cn("not a Claude parameter (ignored by the compatibility layer)", CLAUDE_SAMPLING),
    },
  },
};

const RECO = "llm-configs plugin-parameter-empfehlungen (derived, not measured)";
export const MODES: Record<ModeId, ModeProfile> = {
  agent: { temperature: u(0.2, RECO), thinking: "low" },
  structured: { temperature: u(0.1, RECO), thinking: "off" },
  transform: { temperature: u(0.2, RECO), thinking: "off" },
  grounded: { temperature: u(0.4, RECO), thinking: "off" },
  companion: { temperature: u(0.7, RECO), thinking: "off" },
  creative: { temperature: u(0.7, RECO), thinking: "medium" },
  complete: { temperature: u(0.2, RECO), thinking: "off" },
};

const STANDARD_ONLY: Record<FieldId, FieldSupport> = {
  temperature: "accepted", top_p: "accepted", top_k: "unsupported", min_p: "unsupported",
  presence_penalty: "unsupported", reasoning_effort: "accepted", max_tokens: "accepted",
};

export const BACKENDS: Record<BackendId, BackendProfile> = {
  lmstudio: {
    label: "LM Studio",
    fields: {
      temperature: "effective", top_p: "effective", top_k: "effective", min_p: "effective",
      presence_penalty: "ignored", reasoning_effort: "effective", max_tokens: "effective",
    },
    source: "llm-setup setup.md § Sampling, § Penalty-Felder, § top_k/top_p/min_p (6f75737, qwen3.8 only)",
  },
  openwebui: {
    label: "Open WebUI",
    fields: {
      temperature: "effective", top_p: "effective", top_k: "accepted", min_p: "accepted",
      presence_penalty: "accepted", reasoning_effort: "effective", max_tokens: "effective",
    },
    source: "llm-configs openwebui-api.md § Welche Parameter ankommen (Open WebUI 0.11.3, 2026-09-17)",
  },
  anthropic: {
    label: "Anthropic",
    fields: {
      temperature: "unsupported", top_p: "unsupported", top_k: "unsupported", min_p: "unsupported",
      presence_penalty: "unsupported", reasoning_effort: "accepted", max_tokens: "accepted",
    },
    source: "Anthropic docs (claude-api skill 2026-10-06): no sampling fields (400 on Claude 4.7 and newer), depth through output_config.effort, max_tokens required and includes the thinking; not called by us",
    effortParam: "effort",
    effortValues: ["low", "medium", "high", "xhigh", "max"],
  },
  ollama: { label: "Ollama", fields: STANDARD_ONLY, source: "unmeasured: standard fields only" },
  openai: { label: "OpenAI", fields: STANDARD_ONLY, source: "unmeasured: standard fields only" },
  unknown: { label: "unknown", fields: STANDARD_ONLY, source: "unknown backend: standard fields only" },
};

export const FAMILY_PATTERNS: readonly [RegExp, FamilyId][] = [
  [/qwen3\.8/i, "qwen3.8"],
  [/qwen3\.6/i, "qwen3.6"],
  [/gemma[-_]?4/i, "gemma4"],
  [/gpt-oss/i, "gpt-oss"],
  // Claude 4.7 and newer, where the sampling fields are refused with HTTP 400 (the family's `unsupportedFields`): fable, mythos,
  // opus 4.7/4.8/5…, sonnet 5…, haiku 5…. Earlier models (Opus 4.6, Sonnet 4.6, Haiku 4.5, …) accept sampling and stay
  // unplaced, as do `claude-3-…`, the order distills write (`Claude-4.6-Opus`) and names that only start with the word
  // (`claude-forge`). Last on purpose: a local distill that carries both names (`qwen3.6-claude-opus-distill`) is the family of
  // its weights. A new generation needs a line here, and a test.
  [/claude-fable/i, "claude"],
  [/claude-mythos/i, "claude"],
  [/claude-opus-5/i, "claude"],
  [/claude-opus-4-[78]/i, "claude"],
  [/claude-sonnet-5/i, "claude"],
  [/claude-haiku-5/i, "claude"],
];

/** Model family as SHOWN (label, origin), decoupled from the tuning key. `FamilyId` keys
 *  `FAMILIES` and demands a full sampling profile per entry; a model without sampling
 *  parameters (Apple Intelligence via Shortcuts) has none. `sampling` names the tuning family
 *  the model maps to, or `null` when sampling does not apply. `apple-fm` never enters
 *  `FAMILY_IDS`. Context size, streaming, tool calls and vision stay with the endpoint manager
 *  (`Capability`), not here. */
export const MODEL_FAMILY_IDS = [...FAMILY_IDS, "apple-fm"] as const;
export type ModelFamilyId = (typeof MODEL_FAMILY_IDS)[number];
export interface ModelFamilyInfo { label: string; sampling: FamilyId | null }

export const MODEL_FAMILIES: Record<ModelFamilyId, ModelFamilyInfo> = {
  "qwen3.8": { label: FAMILIES["qwen3.8"].label, sampling: "qwen3.8" },
  "qwen3.6": { label: FAMILIES["qwen3.6"].label, sampling: "qwen3.6" },
  "gemma4": { label: FAMILIES["gemma4"].label, sampling: "gemma4" },
  "gpt-oss": { label: FAMILIES["gpt-oss"].label, sampling: "gpt-oss" },
  "claude": { label: FAMILIES["claude"].label, sampling: "claude" },
  "apple-fm": { label: "Apple Foundation Models", sampling: null },
};

/** The sampling-profile family for a display family, or `null` (no sampling parameters). */
export function samplingFamilyOf(id: ModelFamilyId): FamilyId | null {
  return MODEL_FAMILIES[id]?.sampling ?? null;
}

/** Best guess from a model id. Aliases such as `verdigado-pro` return null on purpose:
 *  the family of an alias is configured in llm-endpoint-manager, not guessed. */
export function familyFromName(model: string): FamilyId | null {
  for (const [re, id] of FAMILY_PATTERNS) if (re.test(model)) return id;
  return null;
}

/** An id only counts if the table holds it itself: `constructor` and `__proto__` are keys of every object. A table is
 *  always older than the newest manager, so an id it does not know is a case, not an error (found by claude-w23: the
 *  backend `anthropic` against a copy that had not heard of it threw a TypeError out of `resolveRequestParams`). */
const isKnownFamily = (f: unknown): f is FamilyId => typeof f === "string" && Object.hasOwn(FAMILIES, f);
const isKnownBackend = (b: unknown): b is BackendId => typeof b === "string" && Object.hasOwn(BACKENDS, b);
/** An id as text for `unrecognised`, whatever it is (`String()` throws for a null-prototype object or a throwing `toString`). */
const idText = (v: unknown): string => (typeof v === "string" ? v : Object.prototype.toString.call(v));
const UNKNOWN_SRC = "family not in this table: generic values";
const UNKNOWN_EFFORT: Record<ThinkingLevel, Sourced<string>> = {
  off: us("none", UNKNOWN_SRC), low: us("low", UNKNOWN_SRC), medium: us("medium", UNKNOWN_SRC), high: us("high", UNKNOWN_SRC),
};
const UNKNOWN_RESERVE: Record<ThinkingLevel, Sourced<number>> = {
  off: u(0, UNKNOWN_SRC), low: u(0, UNKNOWN_SRC), medium: u(0, UNKNOWN_SRC), high: u(0, UNKNOWN_SRC),
};

/** The thinking table of a family on one backend: the family's own, with what that backend changes laid over it
 *  (gemma 4 on LM Studio: `none` is ignored, so `off` is `low` and `canTurnOff` is false). `backend` absent = the
 *  family as such. A new top-level object, but the `Sourced` entries are the tables' own (and the generic table of an unknown
 *  family is shared): read, do not change them. */
export function familyThinking(family: FamilyId, backend: BackendId | undefined): {
  effort: Record<ThinkingLevel, Sourced<string>>;
  canTurnOff: boolean;
  reserve: Record<ThinkingLevel, Sourced<number>>;
} {
  // An id this table does not know (a newer manager than this copy): the generic table, can be turned off as far as we know.
  if (!isKnownFamily(family)) return { effort: UNKNOWN_EFFORT, canTurnOff: true, reserve: UNKNOWN_RESERVE };
  const fam = FAMILIES[family];
  const over = backend !== undefined && isKnownBackend(backend) ? fam.byBackend?.[backend] : undefined;
  return {
    effort: { ...fam.effort, ...over?.effort },
    canTurnOff: over?.canTurnOff ?? fam.canTurnOff,
    reserve: { ...fam.reserve, ...over?.reserve },
  };
}

export interface ResolveInput {
  family: FamilyId | null;
  mode: ModeId;
  backend: BackendId;
  thinking: ThinkingLevel;
  /** The plugin's budget. Absent = max_tokens is not sent. */
  maxTokens?: number;
  /** Already selected for this mode × family, already validated. */
  overrides?: Partial<Record<FieldId, number | string>>;
}
export type FieldState =
  | "sent-effective" | "sent-unproven" | "not-sent-ignored" | "not-sent-unsupported"
  | "not-sent-unknown-family" | "not-sent-no-value";
export type FieldOrigin = "mode" | "family" | "override" | "reserve" | "plugin";
export type FieldNote = "raised-to-reserve" | "raised-to-thinking-floor" | "below-thinking-floor" | "off-not-possible";
export interface FieldExplain {
  field: FieldId;
  /** Set on EVERY row when the request named a backend and/or a family this table does not know: the row was decided as
   *  `unknown` for these (see {@link ResolvedRequest.unrecognised} for the ids). */
  fallback?: ("backend" | "family")[];
  value?: number | string;
  state: FieldState;
  origin?: FieldOrigin;
  source?: string;
  evidence?: Evidence;
  note?: FieldNote;
}
export interface ResolvedRequest {
  params: Record<string, number | string>;
  explain: FieldExplain[];
  /** The ids the table does not know, as they were passed — present only then. They were treated as `unknown`
   *  (backend: standard fields only; family: no family values), no exception. */
  unrecognised?: { backend?: string; family?: string };
}

export const GENERIC_EFFORT: Record<ThinkingLevel, string> = { off: "none", low: "low", medium: "medium", high: "high" };
export const FAMILY_FIELDS: readonly FamilyField[] = ["top_p", "top_k", "min_p", "presence_penalty"];

interface Candidate { value: number | string; origin: FieldOrigin; source?: string; evidence?: Evidence; note?: FieldNote }

function support(backend: BackendId, field: FieldId, familyKnown: boolean): FieldSupport {
  // reasoning_effort to a strict backend with an unknown model risks HTTP 400 (non-reasoning model).
  if (field === "reasoning_effort" && !familyKnown && backend !== "lmstudio" && backend !== "openwebui") return "unsupported";
  return BACKENDS[backend].fields[field];
}

export function resolveRequestParams(rawInput: ResolveInput): ResolvedRequest {
  const unrecognised: { backend?: string; family?: string } = {};
  const backendKnown = isKnownBackend(rawInput.backend);
  if (!backendKnown) unrecognised.backend = idText(rawInput.backend);
  const familyKnown = !rawInput.family || isKnownFamily(rawInput.family);
  if (!familyKnown) unrecognised.family = idText(rawInput.family);
  const input: ResolveInput = { ...rawInput, backend: backendKnown ? rawInput.backend : "unknown", family: familyKnown ? (rawInput.family ?? null) : null };
  const fallback: ("backend" | "family")[] = [...(backendKnown ? [] : ["backend" as const]), ...(familyKnown ? [] : ["family" as const])];
  const fam = input.family ? FAMILIES[input.family] : null;
  const think = input.family ? familyThinking(input.family, input.backend) : null;
  const thinkingOn = input.thinking !== "off";
  const ov = input.overrides ?? {};
  const candidates = new Map<FieldId, Candidate | "unknown-family" | "no-value">();

  // 1. temperature: mode, floor while thinking, override wins
  const mode = MODES[input.mode];
  const floor = thinkingOn ? fam?.thinkingTemperatureFloor : undefined;
  if (typeof ov.temperature === "number") {
    const c: Candidate = { value: ov.temperature, origin: "override" };
    if (floor && ov.temperature < floor.value) c.note = "below-thinking-floor";
    candidates.set("temperature", c);
  } else if (floor && mode.temperature.value < floor.value) {
    candidates.set("temperature", { value: floor.value, origin: "family", source: floor.source, evidence: floor.evidence, note: "raised-to-thinking-floor" });
  } else {
    candidates.set("temperature", { value: mode.temperature.value, origin: "mode", source: mode.temperature.source, evidence: mode.temperature.evidence });
  }

  // 2. family sampling fields
  for (const f of FAMILY_FIELDS) {
    const o = ov[f];
    if (typeof o === "number") { candidates.set(f, { value: o, origin: "override" }); continue; }
    if (!fam) { candidates.set(f, "unknown-family"); continue; }
    const s = (thinkingOn ? fam.thinking : fam.noThinking)[f];
    candidates.set(f, s ? { value: s.value, origin: "family", source: s.source, evidence: s.evidence } : "no-value");
  }

  // 3. reasoning_effort
  if (typeof ov.reasoning_effort === "string") {
    candidates.set("reasoning_effort", { value: ov.reasoning_effort, origin: "override" });
  } else if (think) {
    const e = think.effort[input.thinking];
    const c: Candidate = { value: e.value, origin: "family", source: e.source, evidence: e.evidence };
    if (input.thinking === "off" && !think.canTurnOff) c.note = "off-not-possible";
    candidates.set("reasoning_effort", c);
  } else {
    candidates.set("reasoning_effort", { value: GENERIC_EFFORT[input.thinking], origin: "mode" });
  }

  // 4. max_tokens: plugin budget (or override), raised to the family's reserve
  const base = typeof ov.max_tokens === "number" ? ov.max_tokens : input.maxTokens;
  if (base === undefined) {
    candidates.set("max_tokens", "no-value");
  } else {
    const reserve = think?.reserve[input.thinking];
    if (reserve && base < reserve.value) {
      candidates.set("max_tokens", { value: reserve.value, origin: "reserve", source: reserve.source, evidence: reserve.evidence, note: "raised-to-reserve" });
    } else {
      candidates.set("max_tokens", { value: base, origin: typeof ov.max_tokens === "number" ? "override" : "plugin" });
    }
  }

  // 5. backend filter
  const params: Record<string, number | string> = {};
  const explain: FieldExplain[] = [];
  for (const field of FIELD_ORDER) {
    const c = candidates.get(field);
    const refused = fam?.unsupportedFields?.[field];
    if (c === undefined || c === "no-value") {
      // A field the family refuses is reported as refused even where the table holds no value for it.
      explain.push(refused ? { field, state: "not-sent-unsupported", source: refused.source, evidence: refused.evidence } : { field, state: "not-sent-no-value" });
      continue;
    }
    if (c === "unknown-family") { explain.push({ field, state: "not-sent-unknown-family" }); continue; }
    const effortValues = field === "reasoning_effort" ? BACKENDS[input.backend].effortValues : undefined;
    const outOfList = effortValues !== undefined && !effortValues.includes(String(c.value));
    const s = refused || outOfList ? "unsupported" : support(input.backend, field, fam !== null);
    const row: FieldExplain = { field, value: c.value, origin: c.origin, state: "sent-effective" };
    if (c.source !== undefined) row.source = c.source;
    if (c.evidence !== undefined) row.evidence = c.evidence;
    if (c.note !== undefined) row.note = c.note;
    if (s === "ignored" || s === "unsupported") {
      row.state = s === "ignored" ? "not-sent-ignored" : "not-sent-unsupported";
      delete row.value;
      // The reason the family refuses the field replaces the source of the value that was not sent.
      if (refused) { row.source = refused.source; row.evidence = refused.evidence; }
    } else {
      row.state = s === "effective" ? "sent-effective" : "sent-unproven";
      params[field === "reasoning_effort" ? (BACKENDS[input.backend].effortParam ?? field) : field] = c.value;
    }
    explain.push(row);
  }
  if (fallback.length > 0) {
    for (const row of explain) row.fallback = fallback;
    return { params, explain, unrecognised };
  }
  return { params, explain };
}

export interface RequestSettings {
  overrides: Partial<Record<ModeId, Partial<Record<FamilyKey, Partial<Record<FieldId, number | string>>>>>>;
  thinking: Partial<Record<ModeId, ThinkingLevel>>;
  /** Level the chat toggle switches to when turned on. */
  lastOnLevel: Partial<Record<ModeId, ThinkingLevel>>;
  levelPickerInChat: boolean;
}
export const DEFAULT_REQUEST_SETTINGS: RequestSettings = { overrides: {}, thinking: {}, lastOnLevel: {}, levelPickerInChat: false };

export const RANGES: Record<Exclude<FieldId, "reasoning_effort">, { min: number; max: number; int: boolean }> = {
  temperature: { min: 0, max: 2, int: false },
  top_p: { min: 0.1, max: 1, int: false },   // measured: top_p <= 0.05 yields garbage on LM Studio (llm-setup 6f75737)
  top_k: { min: 1, max: Number.MAX_SAFE_INTEGER, int: true },
  min_p: { min: 0, max: 1, int: false },
  presence_penalty: { min: 0, max: 2, int: false },
  max_tokens: { min: 1, max: Number.MAX_SAFE_INTEGER, int: true },
};
export const EFFORT_VALUES = new Set(["none", "minimal", "low", "medium", "high", "xhigh"]);

export function validateOverride(field: FieldId, raw: unknown): number | string | null {
  if (field === "reasoning_effort") return typeof raw === "string" && EFFORT_VALUES.has(raw) ? raw : null;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  const r = RANGES[field];
  if (raw < r.min || raw > r.max) return null;
  if (r.int && !Number.isInteger(raw)) return null;
  return raw;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isMode = (k: string): k is ModeId => (MODE_IDS as readonly string[]).includes(k);
const isFamilyKey = (k: string): k is FamilyKey => k === "unknown" || (FAMILY_IDS as readonly string[]).includes(k);
const isField = (k: string): k is FieldId => (FIELD_ORDER as readonly string[]).includes(k);
const isLevel = (v: unknown): v is ThinkingLevel => typeof v === "string" && (THINKING_LEVELS as readonly string[]).includes(v);

function levelMap(raw: unknown, path: string, dropped: string[]): Partial<Record<ModeId, ThinkingLevel>> {
  const out: Partial<Record<ModeId, ThinkingLevel>> = {};
  if (!isObj(raw)) return out;
  for (const [k, v] of Object.entries(raw)) {
    if (isMode(k) && isLevel(v)) out[k] = v; else dropped.push(`${path}.${k}`);
  }
  return out;
}

/** Validates the plugin's `request` block field by field. Invalid values fall back to the
 *  profile and are reported in `dropped` (sorted) — never silently discarded (CORE-DATA-01). */
export function sanitizeRequestSettings(raw: unknown): { settings: RequestSettings; dropped: string[] } {
  const dropped: string[] = [];
  // Frische Objekte, nie DEFAULT_REQUEST_SETTINGS selbst: der Aufrufer mutiert das Ergebnis.
  if (!isObj(raw)) return { settings: { overrides: {}, thinking: {}, lastOnLevel: {}, levelPickerInChat: false }, dropped };
  const overrides: RequestSettings["overrides"] = {};
  if (isObj(raw.overrides)) {
    for (const [mode, byFam] of Object.entries(raw.overrides)) {
      if (!isMode(mode) || !isObj(byFam)) { dropped.push(`overrides.${mode}`); continue; }
      for (const [fam, fields] of Object.entries(byFam)) {
        if (!isFamilyKey(fam) || !isObj(fields)) { dropped.push(`overrides.${mode}.${fam}`); continue; }
        const kept: Partial<Record<FieldId, number | string>> = {};
        for (const [field, value] of Object.entries(fields)) {
          const ok = isField(field) ? validateOverride(field, value) : null;
          if (ok === null || !isField(field)) dropped.push(`overrides.${mode}.${fam}.${field}`); else kept[field] = ok;
        }
        if (Object.keys(kept).length > 0) (overrides[mode] ??= {})[fam] = kept;
      }
    }
  }
  const thinking = levelMap(raw.thinking, "thinking", dropped);
  const lastOnLevel = levelMap(raw.lastOnLevel, "lastOnLevel", dropped);
  let levelPickerInChat = false;
  if (typeof raw.levelPickerInChat === "boolean") levelPickerInChat = raw.levelPickerInChat;
  else if (raw.levelPickerInChat !== undefined) dropped.push("levelPickerInChat");
  // Sorted, not in input key order: a port in another language (Lua) cannot see that order, and the list is only shown.
  dropped.sort();
  return { settings: { overrides, thinking, lastOnLevel, levelPickerInChat }, dropped };
}

/** What `loadRequestSettings` returns: the validated block, and the paths of stored values that failed
 *  validation. The caller REPORTS `dropped` (Notice, `console.warn`) — a silent reset would hide that
 *  the user's value is gone (CORE-DATA-01). */
export interface RequestLoadResult { request: RequestSettings; dropped: string[] }

/** One legacy migration of a plugin: reads its OLD field(s) out of the whole stored data (`raw`, the
 *  object `loadData()` returned) and writes the result into `request`. It must not touch `raw` — the
 *  caller deletes the legacy field itself, or the old value would come back with the next merge. */
export type LegacyRequestMigration = (raw: Record<string, unknown>, request: RequestSettings) => void;

/** The rule every plugin with a pre-profile "suppress thinking" switch wrote on its own (six copies, from
 *  lingotuner `0061e2a`): fold the old switch into `request.thinking[mode]` — **once, and only while
 *  nothing is stored there**. `true` (the old default, "no thinking") becomes `"off"`; `false` (thinking
 *  ran) becomes {@link onLevelFor} the mode, so nothing changes for an existing user. A level that is
 *  already stored WINS over the legacy value, so a second load of a saved block moves nothing. Anything
 *  that is not a boolean (absent field, a string from a hand-edited file) is no switch and changes
 *  nothing.
 *
 *  The switch's polarity is the caller's: a field that was an ON switch (yijing-oracle's
 *  `llm.requestThinking`) passes the negation. */
export function foldLegacyThinking(request: RequestSettings, mode: ModeId, suppressed: unknown): void {
  if (typeof suppressed !== "boolean" || request.thinking[mode] !== undefined) return;
  request.thinking[mode] = suppressed ? "off" : onLevelFor(request, mode);
}

/** Loads the `request` block out of the whole stored plugin data: {@link sanitizeRequestSettings} on
 *  `raw.request`, then each plugin's legacy `migrations` in order (each sees what the one before wrote).
 *  `raw` is the data as stored — anything that is not an object counts as empty, and a migration gets
 *  an object, never `null`. The result is a fresh block every time (the caller mutates it). */
export function loadRequestSettings(raw: unknown, migrations: readonly LegacyRequestMigration[] = []): RequestLoadResult {
  const data = isObj(raw) ? raw : {};
  const { settings: request, dropped } = sanitizeRequestSettings(data.request);
  for (const migrate of migrations) migrate(data, request);
  return { request, dropped };
}

export function thinkingFor(s: RequestSettings, mode: ModeId): ThinkingLevel {
  return s.thinking[mode] ?? MODES[mode].thinking;
}
export function onLevelFor(s: RequestSettings, mode: ModeId): ThinkingLevel {
  const stored = s.lastOnLevel[mode];
  if (stored && stored !== "off") return stored;
  return MODES[mode].thinking !== "off" ? MODES[mode].thinking : "low";
}

export type DeviationKind = "thinking-despite-off" | "empty-by-budget" | "family-mismatch" | "family-detected" | "rejected";
export interface Deviation { kind: DeviationKind; affectsResult: boolean; detail?: string }
export interface ResponseFacts {
  status: number;
  errorText?: string;
  finishReason?: string | null;
  content: string;
  reasoning?: string;
  responseModel?: string;
}

/** Structural view of what a chat client returns (obsidian-kit `ChatResult` fits it); code-kit
 *  knows no client, so only the fields the facts need are named. */
export type ChatOutcome =
  | { ok: true; content: string; reasoning: string; finishReason?: string; model?: string; truncated?: boolean }
  | { ok: false; kind: string; detail: string; partial: string; reasoning: string; status?: number; body?: string };

/** The facts `checkResponse` needs, from a chat outcome — one build rule instead of seven copies
 *  (vault-rag, slide-deck, image-to-markdown, neurovim, settings-assistant, kuro, yijing).
 *  `null` when no server answer exists (abort, network error, timeout, stall): the check has
 *  nothing to say there. `truncated` (a 200 that stopped at the limit without text) is a 200 with
 *  finish_reason `length`; `http` and `overflow` carry the status (0 if unknown) and
 *  `errorText = body ?? detail`. */
export function responseFactsOf(r: ChatOutcome): ResponseFacts | null {
  if (r.ok) {
    return {
      status: 200, finishReason: r.finishReason ?? null, content: r.content, reasoning: r.reasoning,
      ...(r.model !== undefined ? { responseModel: r.model } : {}),
    };
  }
  switch (r.kind) {
    case "truncated":
      return { status: 200, finishReason: "length", content: r.partial, reasoning: r.reasoning };
    case "http":
    case "overflow":
      return { status: r.status ?? 0, errorText: r.body ?? r.detail, content: "", reasoning: r.reasoning };
    default:
      return null;
  }
}

/** What a caller does with a response that hit the token limit without any text (reasoning models:
 *  the thinking ate the budget). `"error"`: the outcome stays an error, as the chat client returns
 *  it. `"result"`: it becomes an ok outcome with finish_reason `length`, which a format check can
 *  turn into its own retry or message (slide-deck, image-to-markdown, vault-rag, lingotuner). */
export type TruncatedPolicy = "error" | "result";

export function mapTruncated<R extends ChatOutcome>(r: R, policy: TruncatedPolicy): R | Extract<ChatOutcome, { ok: true }> {
  if (policy === "error" || r.ok || r.kind !== "truncated") return r;
  return { ok: true, content: r.partial, reasoning: r.reasoning, finishReason: "length", truncated: true };
}

/** Deviations between what the profile asked for and what came back. No retry logic here:
 *  a silent retry would hide exactly what the settings UI is meant to show. */
export function checkResponse(ctx: { family: FamilyId | null; thinking: ThinkingLevel; backend?: BackendId }, r: ResponseFacts): Deviation[] {
  if (r.status === 400) return [{ kind: "rejected", affectsResult: true, detail: r.errorText ?? "" }];
  const out: Deviation[] = [];
  const seen = r.responseModel ? familyFromName(r.responseModel) : null;
  // gemma 4 writes its thought into `content` as `…<channel|>` when `none` is ignored; that is read for the family only.
  const channel = (ctx.family ?? seen) === "gemma4";
  const thought = reasoningHappened(r.content, r.reasoning, { channel });
  // Per backend: gemma 4 on LM Studio cannot be turned off, its thought under `off` is the request, not a deviation.
  const canTurnOff = ctx.family ? familyThinking(ctx.family, ctx.backend).canTurnOff : true;
  if (ctx.thinking === "off" && canTurnOff && thought) out.push({ kind: "thinking-despite-off", affectsResult: false });
  const visible = stripThinkBlocks(r.content, { channel }).trim();
  if (visible === "" && thought && r.finishReason === "length") out.push({ kind: "empty-by-budget", affectsResult: true });
  if (seen && ctx.family && seen !== ctx.family) out.push({ kind: "family-mismatch", affectsResult: true, detail: seen });
  if (seen && !ctx.family) out.push({ kind: "family-detected", affectsResult: true, detail: seen });
  return out;
}
