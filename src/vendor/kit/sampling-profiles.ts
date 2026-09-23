// vendored from code-kit@0.7.0, src/ts/pure/sampling-profiles.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
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

export const FAMILY_IDS = ["qwen3.8", "qwen3.6", "gemma4", "gpt-oss"] as const;
export type FamilyId = (typeof FAMILY_IDS)[number];
/** Override key: a known family, or "unknown" for models the kit cannot place. */
export type FamilyKey = FamilyId | "unknown";

export const MODE_IDS = ["agent", "structured", "transform", "grounded", "companion", "creative"] as const;
export type ModeId = (typeof MODE_IDS)[number];

export const BACKEND_IDS = ["lmstudio", "openwebui", "ollama", "openai", "unknown"] as const;
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
}

export interface ModeProfile { temperature: Sourced<number>; thinking: ThinkingLevel }
export interface BackendProfile { label: string; fields: Record<FieldId, FieldSupport>; source: string }

const m = (value: number, source: string): Sourced<number> => ({ value, source, evidence: "measured" });
const u = (value: number, source: string): Sourced<number> => ({ value, source, evidence: "unmeasured" });
const ms = (value: string, source: string): Sourced<string> => ({ value, source, evidence: "measured" });
const us = (value: string, source: string): Sourced<string> => ({ value, source, evidence: "unmeasured" });

const QWEN38_CARD = "model card Qwen/Qwen3.8-27B (retrieved 2026-09-20)";
const QWEN_GREEDY = "Qwen docs quickstart (Qwen3): no greedy decoding while thinking; transferred, supported by harness night run 2026-09-19";
const HARNESS = "llm-benchmark-harness night run 2026-09-19, max reasoning tokens per level, rounded up";
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
};

const RECO = "llm-configs plugin-parameter-empfehlungen (derived, not measured)";
export const MODES: Record<ModeId, ModeProfile> = {
  agent: { temperature: u(0.2, RECO), thinking: "low" },
  structured: { temperature: u(0.1, RECO), thinking: "off" },
  transform: { temperature: u(0.2, RECO), thinking: "off" },
  grounded: { temperature: u(0.4, RECO), thinking: "off" },
  companion: { temperature: u(0.7, RECO), thinking: "off" },
  creative: { temperature: u(0.7, RECO), thinking: "medium" },
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
  ollama: { label: "Ollama", fields: STANDARD_ONLY, source: "unmeasured: standard fields only" },
  openai: { label: "OpenAI", fields: STANDARD_ONLY, source: "unmeasured: standard fields only" },
  unknown: { label: "unknown", fields: STANDARD_ONLY, source: "unknown backend: standard fields only" },
};

const FAMILY_PATTERNS: readonly [RegExp, FamilyId][] = [
  [/qwen3\.8/i, "qwen3.8"],
  [/qwen3\.6/i, "qwen3.6"],
  [/gemma[-_]?4/i, "gemma4"],
  [/gpt-oss/i, "gpt-oss"],
];

/** Best guess from a model id. Aliases such as `verdigado-pro` return null on purpose:
 *  the family of an alias is configured in llm-endpoint-manager, not guessed. */
export function familyFromName(model: string): FamilyId | null {
  for (const [re, id] of FAMILY_PATTERNS) if (re.test(model)) return id;
  return null;
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
  value?: number | string;
  state: FieldState;
  origin?: FieldOrigin;
  source?: string;
  evidence?: Evidence;
  note?: FieldNote;
}
export interface ResolvedRequest { params: Record<string, number | string>; explain: FieldExplain[] }

const GENERIC_EFFORT: Record<ThinkingLevel, string> = { off: "none", low: "low", medium: "medium", high: "high" };
const FAMILY_FIELDS: readonly FamilyField[] = ["top_p", "top_k", "min_p", "presence_penalty"];

interface Candidate { value: number | string; origin: FieldOrigin; source?: string; evidence?: Evidence; note?: FieldNote }

function support(backend: BackendId, field: FieldId, familyKnown: boolean): FieldSupport {
  // reasoning_effort to a strict backend with an unknown model risks HTTP 400 (non-reasoning model).
  if (field === "reasoning_effort" && !familyKnown && backend !== "lmstudio" && backend !== "openwebui") return "unsupported";
  return BACKENDS[backend].fields[field];
}

export function resolveRequestParams(input: ResolveInput): ResolvedRequest {
  const fam = input.family ? FAMILIES[input.family] : null;
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
  } else if (fam) {
    const e = fam.effort[input.thinking];
    const c: Candidate = { value: e.value, origin: "family", source: e.source, evidence: e.evidence };
    if (input.thinking === "off" && !fam.canTurnOff) c.note = "off-not-possible";
    candidates.set("reasoning_effort", c);
  } else {
    candidates.set("reasoning_effort", { value: GENERIC_EFFORT[input.thinking], origin: "mode" });
  }

  // 4. max_tokens: plugin budget (or override), raised to the family's reserve
  const base = typeof ov.max_tokens === "number" ? ov.max_tokens : input.maxTokens;
  if (base === undefined) {
    candidates.set("max_tokens", "no-value");
  } else {
    const reserve = fam?.reserve[input.thinking];
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
    if (c === undefined || c === "no-value") { explain.push({ field, state: "not-sent-no-value" }); continue; }
    if (c === "unknown-family") { explain.push({ field, state: "not-sent-unknown-family" }); continue; }
    const s = support(input.backend, field, fam !== null);
    const row: FieldExplain = { field, value: c.value, origin: c.origin, state: "sent-effective" };
    if (c.source !== undefined) row.source = c.source;
    if (c.evidence !== undefined) row.evidence = c.evidence;
    if (c.note !== undefined) row.note = c.note;
    if (s === "ignored" || s === "unsupported") {
      row.state = s === "ignored" ? "not-sent-ignored" : "not-sent-unsupported";
      delete row.value;
    } else {
      row.state = s === "effective" ? "sent-effective" : "sent-unproven";
      params[field] = c.value;
    }
    explain.push(row);
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

const RANGES: Record<Exclude<FieldId, "reasoning_effort">, { min: number; max: number; int: boolean }> = {
  temperature: { min: 0, max: 2, int: false },
  top_p: { min: 0.1, max: 1, int: false },   // measured: top_p <= 0.05 yields garbage on LM Studio (llm-setup 6f75737)
  top_k: { min: 1, max: Number.MAX_SAFE_INTEGER, int: true },
  min_p: { min: 0, max: 1, int: false },
  presence_penalty: { min: 0, max: 2, int: false },
  max_tokens: { min: 1, max: Number.MAX_SAFE_INTEGER, int: true },
};
const EFFORT_VALUES = new Set(["none", "minimal", "low", "medium", "high", "xhigh"]);

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
 *  profile and are reported in `dropped` — never silently discarded (CORE-DATA-01). */
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
  return { settings: { overrides, thinking, lastOnLevel, levelPickerInChat }, dropped };
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

const THINK_BLOCK = /<think>[\s\S]*?<\/think>/g;

/** Deviations between what the profile asked for and what came back. No retry logic here:
 *  a silent retry would hide exactly what the settings UI is meant to show. */
export function checkResponse(ctx: { family: FamilyId | null; thinking: ThinkingLevel }, r: ResponseFacts): Deviation[] {
  if (r.status === 400) return [{ kind: "rejected", affectsResult: true, detail: r.errorText ?? "" }];
  const out: Deviation[] = [];
  const thought = reasoningHappened(r.content, r.reasoning);
  const canTurnOff = ctx.family ? FAMILIES[ctx.family].canTurnOff : true;
  if (ctx.thinking === "off" && canTurnOff && thought) out.push({ kind: "thinking-despite-off", affectsResult: false });
  const visible = r.content.replace(THINK_BLOCK, "").trim();
  if (visible === "" && thought && r.finishReason === "length") out.push({ kind: "empty-by-budget", affectsResult: true });
  const seen = r.responseModel ? familyFromName(r.responseModel) : null;
  if (seen && ctx.family && seen !== ctx.family) out.push({ kind: "family-mismatch", affectsResult: true, detail: seen });
  if (seen && !ctx.family) out.push({ kind: "family-detected", affectsResult: true, detail: seen });
  return out;
}
