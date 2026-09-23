// vendored from code-kit@0.7.0, src/ts/pure/reasoning.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
export type ThinkingSupport = "none" | "hybrid" | "always";

/** Legacy union params for switching reasoning off; empty object when not suppressing.
 *  Measured on LM Studio 0.4.24+1 / MLX 1.11.0 (llm-setup 6f75737, 2026-09-23): ONLY
 *  `reasoning_effort: "none"` switches thinking off. `chat_template_kwargs.enable_thinking`
 *  and `reasoning_budget` are accepted and silently ignored there; sending them does no harm.
 *  On gpt-oss "none" is not an off switch either: behind Open WebUI it thinks MORE than with
 *  "low" (verdigado/llm-configs). New code uses `resolveRequestParams` from
 *  `sampling-profiles`, which sends neither legacy field and maps "off" per family.
 *  Kept unchanged for callers that have not migrated. */
export function suppressParams(suppress: boolean): Record<string, unknown> {
  if (!suppress) return {};
  return {
    reasoning_effort: "none",
    chat_template_kwargs: { enable_thinking: false },
    reasoning_budget: 0,
  };
}

const THINK_TAG = /<think>([\s\S]*?)<\/think>/;

/** Hat das Modell real gedacht? (separates reasoning-Feld ODER inline <think> mit Inhalt).
 *  Dient dazu, „Suppress hat nicht gegriffen" ehrlich zu erkennen. */
export function reasoningHappened(content: string, reasoning: string | undefined): boolean {
  if (reasoning && reasoning.trim() !== "") return true;
  const m = THINK_TAG.exec(content);
  // `?? ""` statt `?.`: fehlte die Gruppe, heißt das „kein Inhalt" — also false, nicht true.
  return !!m && (m[1] ?? "").trim() !== "";
}

const ALWAYS_ON = /\b(gpt-oss|harmony)\b/i;

/** Modelle, die sich prinzipiell nicht vollständig abschalten lassen (nur low/medium/high). */
export function isAlwaysOnThinker(model: string): boolean {
  return ALWAYS_ON.test(model);
}
