// vendored from code-kit@0.28.0, src/ts/pure/think-splitter.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
const OPEN = "<think>";
const CLOSE = "</think>";

// Gemma 4's thought channel: `<|channel>thought\n…<channel|>`, then the answer. These two are the only channel tokens of its chat
// template (`soc_token`/`eoc_token`); `<|channel|>` and `<channel>` are not gemma tokens and are not read.
const CH_OPEN = "<|channel>";
const CH_CLOSE = "<channel|>";
/** The channel name gemma writes behind the opener. It is a label, not part of the thought. */
const CH_LABEL = "thought\n";

export interface ThinkSplitterOptions {
  /** Read gemma 4's thought channel next to `<think>`. Default `false`: `<|channel>` and `<channel|>` are plain text.
   *
   *  Switch it on for the gemma family only (`familyFromName(model) === "gemma4"` in `sampling-profiles`). Measured
   *  2026-10-14 on google/gemma-4-e4b in LM Studio: `reasoning_effort: "none"` does NOT stop the thinking there, and the
   *  thought comes back in `content` WITHOUT an opening tag, ended by `<channel|>`; the answer follows. With `"low"` the
   *  thought is in `reasoning_content` and `content` holds the answer only. A model that is not gemma can write
   *  `<channel|>` in an ordinary answer, and nothing in the text tells the two apart, so the format is not guessed.
   *
   *  With the option on: `<|channel>thought\n…<channel|>` is reasoning (opener and the label `thought\n` are dropped), and a
   *  `<channel|>` that is the FIRST channel tag of the stream, with no opener before it, ends a thought that has already
   *  been handed out as `content` — see `resetContent`. A later `<channel|>` is text. */
  channel?: boolean;
}

export interface ThinkSplitResult {
  content: string;
  reasoning: string;
  /** Set only with `channel: true`, on the push that meets a `<channel|>` without an opener. Everything this splitter has
   *  returned as `content` so far was the thought: the caller DISCARDS the content it has accumulated (and shown) and goes
   *  on with `content` of this result. The discarded text is in `reasoning` of this very result, so appending `reasoning`
   *  as usual is right. A stream cannot know in advance whether text before a `<channel|>` is a thought, and a stream UI
   *  shows the thought as the answer until this arrives. */
  resetContent?: true;
}

type TagKind = "think-open" | "think-close" | "channel-open" | "channel-close";
interface Tag { text: string; kind: TagKind }
const T_OPEN: Tag = { text: OPEN, kind: "think-open" };
const T_CLOSE: Tag = { text: CLOSE, kind: "think-close" };
const C_OPEN: Tag = { text: CH_OPEN, kind: "channel-open" };
const C_CLOSE: Tag = { text: CH_CLOSE, kind: "channel-close" };
const TAGS_PLAIN: readonly Tag[] = [T_OPEN];
const TAGS_CHANNEL: readonly Tag[] = [T_OPEN, C_OPEN];
const TAGS_CHANNEL_FRESH: readonly Tag[] = [T_OPEN, C_OPEN, C_CLOSE];
const TAGS_THINK: readonly Tag[] = [T_CLOSE];
const TAGS_IN_CHANNEL: readonly Tag[] = [C_CLOSE];

type Mode = "content" | "think" | "channel";

/** Zustandsbehafteter Splitter: zieht <think>…</think> aus einem Token-Strom (Content-Kanal).
 *  Tags dürfen über push-Grenzen gesplittet sein — ein angefangenes Tag wird gepuffert.
 *  With `{ channel: true }` it also reads gemma 4's thought channel (see {@link ThinkSplitterOptions}).
 *
 *  Linear in the text: the next position of each tag is looked up once and kept, not searched again per tag found. */
export class ThinkSplitter {
  private mode: Mode = "content";
  private buf = "";
  private readonly channel: boolean;
  /** `channel` only: no channel tag has been seen yet, so a `<channel|>` may still be the end of an opener-less thought. */
  private strayPossible: boolean;
  /** What was returned as `content` while `strayPossible` — the text `resetContent` takes back. */
  private seen = "";
  /** Behind a channel opener: the label `thought\n` is still to be skipped. */
  private labelPending = false;

  constructor(opts: ThinkSplitterOptions = {}) {
    this.channel = opts.channel === true;
    this.strayPossible = this.channel;
  }

  push(text: string): ThinkSplitResult {
    const s = this.buf + text;
    this.buf = "";
    let content = "";
    let reasoning = "";
    let reset = false;
    let pos = 0;
    // Next position of a tag at or after `pos`; -1 stays valid (nothing later either), a position ahead of `pos` stays too.
    const found = new Map<string, number>();
    const at = (tag: string): number => {
      let i = found.get(tag);
      if (i === undefined || (i >= 0 && i < pos)) {
        i = s.indexOf(tag, pos);
        found.set(tag, i);
      }
      return i;
    };
    const emit = (str: string): void => {
      if (str === "") return;
      if (this.mode === "content") {
        content += str;
        if (this.strayPossible) this.seen += str;
      } else {
        reasoning += str;
      }
    };

    while (pos < s.length) {
      if (this.labelPending) {
        const head = s.slice(pos, pos + CH_LABEL.length);
        if (head === CH_LABEL) {
          pos += CH_LABEL.length;
          this.labelPending = false;
          continue;
        }
        if (head.length < CH_LABEL.length && CH_LABEL.startsWith(head)) {
          this.buf = head; // may still become the label
          break;
        }
        this.labelPending = false; // another channel name, or none: it is the thought
      }
      const tags = this.mode === "think" ? TAGS_THINK
        : this.mode === "channel" ? TAGS_IN_CHANNEL
        : !this.channel ? TAGS_PLAIN
        : this.strayPossible ? TAGS_CHANNEL_FRESH : TAGS_CHANNEL;
      let hit: Tag | null = null;
      let hitAt = -1;
      for (const t of tags) {
        const i = at(t.text);
        if (i >= 0 && (hit === null || i < hitAt)) {
          hit = t;
          hitAt = i;
        }
      }
      if (hit === null) {
        // Kein vollständiges Tag: ein evtl. angefangenes Tag am Ende puffern.
        let partial = 0;
        for (const t of tags) partial = Math.max(partial, partialSuffixLen(s, pos, t.text));
        const safe = s.length - partial;
        emit(s.slice(pos, safe));
        this.buf = s.slice(safe);
        break;
      }
      const before = s.slice(pos, hitAt);
      pos = hitAt + hit.text.length;
      switch (hit.kind) {
        case "think-open":
          emit(before);
          this.mode = "think";
          break;
        case "think-close":
          emit(before);
          this.mode = "content";
          break;
        case "channel-open":
          emit(before);
          this.mode = "channel";
          this.labelPending = true;
          this.strayPossible = false;
          this.seen = "";
          break;
        case "channel-close":
          if (this.mode === "channel") {
            emit(before);
            this.mode = "content";
          } else {
            // No opener: the text before it was the thought, and part of it has already gone out as content.
            reasoning += this.seen + before;
            content = "";
            this.seen = "";
            this.strayPossible = false;
            reset = true;
          }
          break;
      }
    }
    return reset ? { content, reasoning, resetContent: true } : { content, reasoning };
  }

  /** Stream-Ende: gibt den noch gepufferten (Tag-)Rest zurück — er hat sich nie zu einem
   *  vollständigen Tag ergänzt und gehört in den aktuell aktiven Kanal. */
  flush(): ThinkSplitResult {
    const inContent = this.mode === "content";
    const out = { content: inContent ? this.buf : "", reasoning: inContent ? "" : this.buf };
    this.buf = "";
    this.labelPending = false;
    this.seen = "";
    return out;
  }
}

/** Länge des längsten Suffixes von `s` (nicht vor `from`), das ein echter Präfix von `tag` ist. */
function partialSuffixLen(s: string, from: number, tag: string): number {
  const max = Math.min(s.length - from, tag.length - 1);
  for (let n = max; n > 0; n--) {
    if (s.slice(s.length - n) === tag.slice(0, n)) return n;
  }
  return 0;
}

export interface StripThinkOptions {
  /** A `</think>` without an open before it: the model's chat template put `<think>` into the PROMPT, so the
   *  answer starts with the thought and only the close comes back. Drops everything up to and including the
   *  LAST such close. Default `false`: the text stays. */
  dropStrayClose?: boolean;
  /** A `<think>` never closed (the answer was cut off inside the thought): drops it and everything after it.
   *  Default `false`: the text stays. Set it where the rest is parsed for brackets or code, because the
   *  brackets then come from the thought (3d-codeblocks: `<think>maybe [1,2]` read as a list). */
  dropUnclosed?: boolean;
  /** Gemma 4's thought channel, the whole-text counterpart of {@link ThinkSplitterOptions.channel}: drops every
   *  `<|channel>…<channel|>` block, and a `<channel|>` that is the FIRST channel tag of the text, with no opener before it
   *  (the thought of `reasoning_effort: "none"`, which comes back in `content`), together with everything before it. A later
   *  `<channel|>` is text. `dropUnclosed` also drops a `<|channel>` that was never closed. Default `false`: the text stays,
   *  because only the caller knows the model is gemma. Gives the same `content` as {@link ThinkSplitter} with
   *  `{ channel: true }` (differential test over every string of up to six tokens). */
  channel?: boolean;
}

/** `<think>…</think>` out of a COMPLETE text — the whole-text counterpart of {@link ThinkSplitter}.
 *
 *  Origin: five inline copies in the plugins (Welle 17, alt-w17), all `/<think>[\s\S]*?<\/think>/g`: obsidian-transmute
 *  `core/llm/response.ts` and koda-agent `core/agent/text-fallback.ts` (plus `.replace(/^[\s\S]*?<\/think>/, "")`),
 *  3d-codeblocks `core/shapes/protocol.ts` (everything up to the last stray close, an unclosed open drops the
 *  rest), vault-crews `core/output-validator.ts` and json-editor `core/repair/prompt.ts` (pairs only).
 *  That regex is quadratic when many opens have no close: `"<think>".repeat(50000)` took 2.6 s (measured 2026-10-11).
 *  This is a scan with `indexOf`, linear in the text.
 *
 *  Order: first all pairs, then (optionally) the stray close, then (optionally) the unclosed open — the order
 *  3d-codeblocks used. A pair runs from the first `<think>` to the NEAREST `</think>` after it, so an open inside a
 *  block goes with the block (`x<think>a<think>b</think>y</think>z` → `xy</think>z`), as the regex did. Tags are
 *  matched exactly and in lower case, like {@link ThinkSplitter}.
 *
 *  **Defaults change nothing but pairs** (vault-crews, json-editor). `{ dropStrayClose: true }` is transmute and
 *  koda, `{ dropStrayClose: true, dropUnclosed: true }` is 3d-codeblocks. **One difference from the originals:**
 *  with TWO OR MORE stray closes transmute/koda dropped up to the FIRST one and left a literal `</think>` in the
 *  text (`a</think>b</think>c` → `b</think>c`); here it is the last (`c`), the way 3d-codeblocks always did it.
 *  Nobody gave a reason for the first, and a leftover tag is never wanted. Verified against all three originals
 *  over every string of up to six tokens (test).
 *
 *  Not the same as {@link ThinkSplitter} on a stray close or an unclosed open: the splitter leaves a stray close in
 *  the content and sends an unclosed block to the reasoning channel, because a stream cannot know yet. */
export function stripThinkBlocks(text: string, opts: StripThinkOptions = {}): string {
  let out = text;
  let open = out.indexOf(OPEN);
  if (open >= 0) {
    const parts: string[] = [];
    let from = 0;
    while (open >= 0) {
      const close = out.indexOf(CLOSE, open + OPEN.length);
      if (close < 0) break; // no close after this open: none after a later open either
      parts.push(out.slice(from, open));
      from = close + CLOSE.length;
      open = out.indexOf(OPEN, from);
    }
    parts.push(out.slice(from));
    out = parts.join("");
  }
  if (opts.channel) out = stripChannel(out, opts.dropUnclosed === true);
  if (opts.dropStrayClose) {
    const stray = out.lastIndexOf(CLOSE);
    if (stray >= 0) out = out.slice(stray + CLOSE.length);
  }
  if (opts.dropUnclosed) {
    const unclosed = out.indexOf(OPEN);
    if (unclosed >= 0) out = out.slice(0, unclosed);
  }
  return out;
}

/** The channel half of {@link stripThinkBlocks}: a stray close first (only if it comes before any opener), then the
 *  `<|channel>…<channel|>` pairs from the first opener to the NEAREST close, then — optionally — an opener that stayed open. */
function stripChannel(text: string, dropUnclosed: boolean): string {
  const firstOpen = text.indexOf(CH_OPEN);
  const firstClose = text.indexOf(CH_CLOSE);
  let from = firstClose >= 0 && (firstOpen < 0 || firstClose < firstOpen) ? firstClose + CH_CLOSE.length : 0;
  const parts: string[] = [];
  let open = text.indexOf(CH_OPEN, from);
  while (open >= 0) {
    const close = text.indexOf(CH_CLOSE, open + CH_OPEN.length);
    if (close < 0) break;
    parts.push(text.slice(from, open));
    from = close + CH_CLOSE.length;
    open = text.indexOf(CH_OPEN, from);
  }
  let rest = text.slice(from);
  if (dropUnclosed) {
    const unclosed = rest.indexOf(CH_OPEN);
    if (unclosed >= 0) rest = rest.slice(0, unclosed);
  }
  parts.push(rest);
  return parts.join("");
}
