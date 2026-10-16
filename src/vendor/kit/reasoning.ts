// vendored from code-kit@0.28.0, src/ts/pure/reasoning.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
export type ThinkingSupport = "none" | "hybrid" | "always";

/** Legacy union params for switching reasoning off; empty object when not suppressing.
 *  Measured on LM Studio 0.4.24+1 / MLX 1.11.0 (llm-setup 6f75737, 2026-09-23): ONLY
 *  `reasoning_effort: "none"` switches thinking off. `chat_template_kwargs.enable_thinking`
 *  and `reasoning_budget` are accepted and silently ignored there; sending them does no harm.
 *  On gpt-oss "none" is not an off switch either: behind Open WebUI it thinks MORE than with
 *  "low" (verdigado/llm-configs). **Nor on google/gemma-4-e4b in LM Studio (2026-10-14):** there "none" is ignored, every
 *  other value (and no field at all) gives the same thinking in `reasoning_content`, and with "none" the thought comes back
 *  in `content` without an opening tag, ended by `<channel|>` — read it with `ThinkSplitter({ channel: true })` /
 *  `stripThinkBlocks(text, { channel: true })`. New code uses `resolveRequestParams` from
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

const THINK_OPEN = "<think>";
const THINK_CLOSE = "</think>";

/** Hat das Modell real gedacht? (separates reasoning-Feld ODER inline <think> mit Inhalt).
 *  Dient dazu, „Suppress hat nicht gegriffen" ehrlich zu erkennen.
 *
 *  Gilt der ERSTE Block mit Schluss-Tag: ist der Text dazwischen nicht leer? Vorher `/<think>([\s\S]*?)<\/think>/.exec` —
 *  dieselben Antworten wie jetzt (Differentialtest über alle Strings bis 6 Token), aber quadratisch bei vielen offenen
 *  `<think>` ohne Schluss-Tag (50 000 Stück: 3,3 s, gemessen 2026-10-11, bei jeder Antwort von `checkResponse`). Das erste
 *  `<think>` entscheidet: hat es kein Schluss-Tag hinter sich, haben die späteren auch keines. */
export function reasoningHappened(content: string, reasoning: string | undefined, opts: { channel?: boolean } = {}): boolean {
  if (reasoning && reasoning.trim() !== "") return true;
  const open = content.indexOf(THINK_OPEN);
  if (open >= 0) {
    const from = open + THINK_OPEN.length;
    const close = content.indexOf(THINK_CLOSE, from);
    if (close >= 0 && content.slice(from, close).trim() !== "") return true;
  }
  return opts.channel === true && channelThought(content);
}

const CHANNEL_OPEN = "<|channel>";
const CHANNEL_CLOSE = "<channel|>";
const CHANNEL_LABEL = "thought\n";

/** Gemma 4's thought channel in `content` (`reasoning_effort: "none"` on LM Studio does not stop the thinking and returns it
 *  there): the first channel tag decides, as in `ThinkSplitter`. A close first is a thought without an opener — the text
 *  before it; an opener first is a thought only if it is closed and holds more than the label `thought\n`. */
function channelThought(content: string): boolean {
  const open = content.indexOf(CHANNEL_OPEN);
  const close = content.indexOf(CHANNEL_CLOSE);
  if (close >= 0 && (open < 0 || close < open)) return content.slice(0, close).trim() !== "";
  if (open < 0) return false;
  let from = open + CHANNEL_OPEN.length;
  if (content.startsWith(CHANNEL_LABEL, from)) from += CHANNEL_LABEL.length;
  const end = content.indexOf(CHANNEL_CLOSE, from);
  return end >= 0 && content.slice(from, end).trim() !== "";
}

const ALWAYS_ON = /\b(gpt-oss|harmony)\b/i;

/** Modelle, die sich prinzipiell nicht vollständig abschalten lassen (nur low/medium/high). */
export function isAlwaysOnThinker(model: string): boolean {
  return ALWAYS_ON.test(model);
}
