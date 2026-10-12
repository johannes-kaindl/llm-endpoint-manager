// vendored from code-kit@0.24.0, src/ts/pure/think-splitter.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
const OPEN = "<think>";
const CLOSE = "</think>";

/** Zustandsbehafteter Splitter: zieht <think>…</think> aus einem Token-Strom (Content-Kanal).
 *  Tags dürfen über push-Grenzen gesplittet sein — ein angefangenes Tag wird gepuffert. */
export class ThinkSplitter {
  private inside = false;
  private buf = "";

  push(text: string): { content: string; reasoning: string } {
    let s = this.buf + text;
    this.buf = "";
    let content = "";
    let reasoning = "";
    while (s.length > 0) {
      const tag = this.inside ? CLOSE : OPEN;
      const idx = s.indexOf(tag);
      if (idx >= 0) {
        const before = s.slice(0, idx);
        if (this.inside) reasoning += before; else content += before;
        this.inside = !this.inside;
        s = s.slice(idx + tag.length);
        continue;
      }
      // Kein vollständiges Tag: ein evtl. angefangenes Tag am Ende puffern.
      const partial = partialSuffixLen(s, tag);
      const safe = s.length - partial;
      const emit = s.slice(0, safe);
      if (this.inside) reasoning += emit; else content += emit;
      this.buf = s.slice(safe);
      s = "";
    }
    return { content, reasoning };
  }

  /** Stream-Ende: gibt den noch gepufferten (Tag-)Rest zurück — er hat sich nie zu einem
   *  vollständigen Tag ergänzt und gehört in den aktuell aktiven Kanal. */
  flush(): { content: string; reasoning: string } {
    const out = { content: this.inside ? "" : this.buf, reasoning: this.inside ? this.buf : "" };
    this.buf = "";
    return out;
  }
}

/** Länge des längsten Suffixes von `s`, das ein echter Präfix von `tag` ist. */
function partialSuffixLen(s: string, tag: string): number {
  const max = Math.min(s.length, tag.length - 1);
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
