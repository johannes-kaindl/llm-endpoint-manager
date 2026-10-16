// vendored from obsidian-kit@0.62.0, src/pure/anthropic-wire.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
/** Die Leitungsform der Anthropic Messages-API (`POST /v1/messages`) als reine Funktionen — ohne `obsidian`-Import,
 *  in Node gegen Doubles testbar. Der Transport (`obsidian/anthropic-transport.ts`) steckt sie zwischen den
 *  `chat-client` und das Netz: der Client spricht weiter das OpenAI-Format (Nachrichten, `tool_calls`, SSE-`choices`),
 *  die Übersetzung steht an EINER Stelle. Vorbild für die Naht ist `createShortcutsChatTransport` (Apple, Welle 13):
 *  ein `SseTransport`, der eine andere Gegenstelle als OpenAI bedient, ohne dass `chat-client`, Schwärzung,
 *  Idle-Frist, Denkzerlegung und Fehlerklassen sich ändern.
 *
 *  ── Was übersetzt wird ───────────────────────────────────────────────────────────────────────
 *  Anfrage: `system`/`developer`-Nachrichten wandern in das Feld `system` (die API kennt keine System-Rolle im
 *  Verlauf), `tool`-Nachrichten werden `tool_result`-Blöcke EINER Nutzernachricht (parallele Werkzeuge gehören
 *  in eine), `image_url` wird ein `image`-Block, Werkzeuge `{type:"function"}` werden `{name, input_schema}`.
 *  Von den Parametern kommen nur `max_tokens`, `stop` (→ `stop_sequences`) und `effort` (→ `output_config.effort`)
 *  durch; `temperature`, `top_p` und der Rest fehlen absichtlich — das Profil `claude` aus code-kit (`unsupportedFields`)
 *  sendet sie nie, und ein fester Wert aus einem Aufruf würde auf Claude 4.7 und neuer einen 400 auslösen.
 *  Antwort: `text_delta` → `delta.content`, `thinking_delta` → `delta.reasoning_content`, `input_json_delta` →
 *  `delta.tool_calls[].function.arguments`, `stop_reason` → `finish_reason`.
 *
 *  ── Denkblöcke im Werkzeug-Verlauf ───────────────────────────────────────────────────────────
 *  Eine Assistenten-Runde mit `tool_use` geht UNVERÄNDERT samt ihrem Denkblock (mit `signature`) zurück, solange
 *  ihr `tool_result` aussteht. Der OpenAI-Verlauf trägt den Block nicht: der Aufrufer sieht nur Text und `tool_calls`.
 *  Deshalb merkt sich der Transport die Denkblöcke je `tool_use`-Id (`ThinkingStash`) samt ihrem Platz — Denkblöcke
 *  stehen VOR dem Text oder vor dem Werkzeug-Aufruf, den sie einleiten (Fortschrittsnotizen, Opus 5.5) — und setzt sie
 *  beim Zurückschicken an dieselbe Stelle. Fehlt der Eintrag (Neustart des Plugins mitten in der Runde), geht die Runde
 *  ohne Denkblock raus. */

export const ANTHROPIC_VERSION = "2023-06-01";
/** Obergrenzen, wenn weder Plugin noch Modell-Liste ein `max_tokens` nennen: Stream (Zeitüberschreitungen sind dort
 *  kein Thema) bzw. volle Antwort (bleibt unter den HTTP-Fristen). `min` mit der Modellgrenze aus `/v1/models`. */
export const ANTHROPIC_DEFAULT_MAX_TOKENS_STREAM = 64_000;
export const ANTHROPIC_DEFAULT_MAX_TOKENS = 16_000;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// ── Modell-Fähigkeiten ───────────────────────────────────────────────────────────────────────────

/** Was `GET /v1/models` je Modell ausweist und der Transport braucht. `undefined` = die Liste nennt es nicht
 *  (Stub, Proxy, Modell fehlt): dann wird das Feld NICHT gesendet — ein fehlendes Feld ist auf jedem Modell gültig,
 *  ein falsches `effort` auf Sonnet 4.5 oder Haiku 4.5 ein 400. */
export interface AnthropicModelCaps {
  effort?: boolean;
  adaptiveThinking?: boolean;
  /** `max_tokens` des Modells (Ausgabegrenze). */
  maxOutputTokens?: number;
}

/** Liest die Fähigkeiten eines Modells aus der Antwort von `GET /v1/models` (`{data:[{id, max_tokens, capabilities}]}`);
 *  `null`, wenn die Liste das Modell nicht enthält oder keine Liste ist. */
export function modelCapsFromList(json: unknown, modelId: string): AnthropicModelCaps | null {
  if (!isRecord(json) || !Array.isArray(json.data)) return null;
  const row: unknown = (json.data as unknown[]).find((m: unknown) => isRecord(m) && m.id === modelId);
  if (!isRecord(row)) return null;
  const caps = isRecord(row.capabilities) ? row.capabilities : null;
  const out: AnthropicModelCaps = {};
  if (caps) {
    const effort = caps.effort;
    if (isRecord(effort) && typeof effort.supported === "boolean") out.effort = effort.supported;
    const thinking = caps.thinking;
    if (isRecord(thinking) && isRecord(thinking.types) && isRecord(thinking.types.adaptive) && typeof thinking.types.adaptive.supported === "boolean") {
      out.adaptiveThinking = thinking.types.adaptive.supported;
    }
  }
  if (typeof row.max_tokens === "number" && Number.isInteger(row.max_tokens) && row.max_tokens > 0) out.maxOutputTokens = row.max_tokens;
  return out;
}

// ── Anfrage ──────────────────────────────────────────────────────────────────────────────────────

export type AnthropicBlock = Record<string, unknown> & { type: string };

/** Ein gemerkter Denkblock und wovor er stand: `"text"` (vor dem Antworttext oder, ohne Text, am Anfang), die Id eines
 *  `tool_use` (unmittelbar davor) oder `"end"`. */
export interface ThinkingAnchor { block: AnthropicBlock; before: string }

/** Denkblöcke (`thinking`, `redacted_thinking`) je `tool_use`-Id; beschränkt, damit eine lange Sitzung nicht wächst. */
export interface ThinkingStash {
  get(toolUseId: string): ThinkingAnchor[] | undefined;
  set(toolUseIds: readonly string[], anchors: ThinkingAnchor[]): void;
  clear(): void;
}

export function createThinkingStash(limit = 256): ThinkingStash {
  const map = new Map<string, ThinkingAnchor[]>();
  return {
    get: (id) => map.get(id),
    set(ids, anchors) {
      for (const id of ids) {
        map.delete(id);
        map.set(id, anchors);
        if (map.size > limit) { const oldest = map.keys().next(); if (!oldest.done) map.delete(oldest.value); }
      }
    },
    clear: () => { map.clear(); },
  };
}

export interface ToAnthropicOptions {
  caps: AnthropicModelCaps | null;
  stash?: ThinkingStash;
  /** Default `true`; `false` lässt jeden Denkblock des Verlaufs weg (Wiederholung nach „Invalid signature“). */
  withThinkingBlocks?: boolean;
}

const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((p: unknown) => (typeof p === "string" ? p : isRecord(p) && p.type === "text" && typeof p.text === "string" ? p.text : ""))
    .filter((t) => t !== "")
    .join("\n");
}

/** `data:image/png;base64,…` ohne Regex über den Nutzdaten (Bilder sind Megabytes groß). */
function imageBlock(url: string): AnthropicBlock | null {
  if (url.startsWith("data:")) {
    const sep = url.indexOf(";base64,");
    if (sep < 0) return null;
    const mediaType = url.slice(5, sep).toLowerCase();
    if (!ALLOWED_IMAGE_TYPES.has(mediaType)) return null;
    return { type: "image", source: { type: "base64", media_type: mediaType, data: url.slice(sep + 8) } };
  }
  if (url.startsWith("https://") || url.startsWith("http://")) return { type: "image", source: { type: "url", url } };
  return null;
}

function userBlocks(content: unknown): AnthropicBlock[] {
  if (typeof content === "string") return content === "" ? [] : [{ type: "text", text: content }];
  if (!Array.isArray(content)) return [];
  const out: AnthropicBlock[] = [];
  for (const p of content) {
    if (typeof p === "string") { if (p !== "") out.push({ type: "text", text: p }); continue; }
    if (!isRecord(p)) continue;
    if (p.type === "text" && typeof p.text === "string") { if (p.text !== "") out.push({ type: "text", text: p.text }); continue; }
    if (p.type === "image_url") {
      const u = isRecord(p.image_url) ? p.image_url.url : p.image_url;
      const b = typeof u === "string" ? imageBlock(u) : null;
      if (b) out.push(b);
    }
  }
  return out;
}

function parseArguments(args: unknown): Record<string, unknown> {
  if (isRecord(args)) return args;
  if (typeof args !== "string" || args.trim() === "") return {};
  try { const j: unknown = JSON.parse(args); return isRecord(j) ? j : {}; } catch { return {}; }
}

interface Turn { role: "user" | "assistant"; blocks: AnthropicBlock[] }

/** Ein Turn je Rolle: aufeinanderfolgende gleiche Rollen verschmelzen (die API erlaubt es, aber `tool_result`-Blöcke
 *  müssen in einer Nutzernachricht VOR deren Text stehen). */
function pushTurn(turns: Turn[], role: Turn["role"], blocks: AnthropicBlock[]): void {
  if (blocks.length === 0) return;
  const last = turns.at(-1);
  if (last && last.role === role) last.blocks.push(...blocks);
  else turns.push({ role, blocks: [...blocks] });
}

function toolResultsFirst(blocks: AnthropicBlock[]): AnthropicBlock[] {
  return [...blocks.filter((b) => b.type === "tool_result"), ...blocks.filter((b) => b.type !== "tool_result")];
}

/** Die Ids der `tool_use`-Blöcke einer fertigen Anfrage — Hilfe für die Wiederholung und die Tests. */
export function toolUseIdsOf(messages: unknown): string[] {
  const ids: string[] = [];
  if (!Array.isArray(messages)) return ids;
  for (const m of messages) {
    if (!isRecord(m) || !Array.isArray(m.content)) continue;
    for (const b of m.content) if (isRecord(b) && b.type === "tool_use" && typeof b.id === "string") ids.push(b.id);
  }
  return ids;
}

/** Ob die Anfrage Denkblöcke aus dem Merkzettel trägt (Wiederholung nur dann sinnvoll). */
export function hasThinkingBlocks(messages: unknown): boolean {
  if (!Array.isArray(messages)) return false;
  return messages.some((m: unknown) => isRecord(m) && Array.isArray(m.content)
    && m.content.some((b: unknown) => isRecord(b) && (b.type === "thinking" || b.type === "redacted_thinking")));
}

function wireTools(tools: unknown): Record<string, unknown>[] {
  if (!Array.isArray(tools)) return [];
  const out: Record<string, unknown>[] = [];
  for (const t of tools) {
    if (!isRecord(t)) continue;
    const fn = isRecord(t.function) ? t.function : null;
    const name = fn?.name ?? t.name;
    if (typeof name !== "string" || name === "") continue;
    const description = fn?.description ?? t.description;
    const schema = fn?.parameters ?? t.input_schema ?? t.parameters;
    out.push({
      name,
      ...(typeof description === "string" && description !== "" ? { description } : {}),
      input_schema: isRecord(schema) ? schema : { type: "object", properties: {} },
    });
  }
  return out;
}

/** Der OpenAI-Körper, den `chat-client` baut (`model`, `messages`, `stream`, `tools`, dazu die flachen Parameter),
 *  als Körper für `POST /v1/messages`. */
export function toAnthropicBody(body: unknown, opts: ToAnthropicOptions): Record<string, unknown> {
  const b = isRecord(body) ? body : {};
  const messages = Array.isArray(b.messages) ? b.messages : [];
  const system: string[] = [];
  const turns: Turn[] = [];
  const withThinking = opts.withThinkingBlocks !== false;

  for (const m of messages) {
    if (!isRecord(m)) continue;
    const role = m.role;
    if (role === "system" || role === "developer") {
      const t = textOf(m.content);
      if (t !== "") system.push(t);
    } else if (role === "user") {
      pushTurn(turns, "user", userBlocks(m.content));
    } else if (role === "tool") {
      const id = typeof m.tool_call_id === "string" ? m.tool_call_id : "";
      pushTurn(turns, "user", [{ type: "tool_result", tool_use_id: id, content: textOf(m.content) }]);
    } else if (role === "assistant") {
      const blocks: AnthropicBlock[] = [];
      const calls = Array.isArray(m.tool_calls) ? m.tool_calls : [];
      const toolBlocks: AnthropicBlock[] = [];
      for (const [i, tc] of calls.entries()) {
        if (!isRecord(tc)) continue;
        const fn = isRecord(tc.function) ? tc.function : {};
        if (typeof fn.name !== "string" || fn.name === "") continue;
        toolBlocks.push({ type: "tool_use", id: typeof tc.id === "string" && tc.id !== "" ? tc.id : `call_${i}`, name: fn.name, input: parseArguments(fn.arguments) });
      }
      const text = textOf(m.content);
      // Denkblöcke an ihren Platz zurück: vor den Text, vor das Werkzeug, das sie einleiteten, oder ans Ende. Ein Anker, dessen
      // Werkzeug der Aufrufer weggelassen hat, wandert an den Anfang (nie still verlieren: die Wiederholung fängt einen 400 ab).
      const saved = withThinking && opts.stash ? toolBlocks.map((tb) => opts.stash?.get(tb.id as string)).find((a) => a !== undefined) : undefined;
      const present = new Set(toolBlocks.map((tb) => tb.id as string));
      const placed = (before: string): AnthropicBlock[] => (saved ?? []).filter((a) => (before === "text" ? a.before === "text" || (a.before !== "end" && !present.has(a.before)) : a.before === before)).map((a) => a.block);
      blocks.push(...placed("text"));
      if (text !== "") blocks.push({ type: "text", text });
      for (const tb of toolBlocks) { blocks.push(...placed(tb.id as string), tb); }
      blocks.push(...placed("end"));
      pushTurn(turns, "assistant", blocks);
    }
  }

  const out: Record<string, unknown> = {};
  out.model = b.model;
  const streaming = b.stream === true;
  const requested = typeof b.max_tokens === "number" ? b.max_tokens : typeof b.max_completion_tokens === "number" ? b.max_completion_tokens : undefined;
  const fallback = Math.min(streaming ? ANTHROPIC_DEFAULT_MAX_TOKENS_STREAM : ANTHROPIC_DEFAULT_MAX_TOKENS, opts.caps?.maxOutputTokens ?? Number.POSITIVE_INFINITY);
  out.max_tokens = requested !== undefined && requested > 0 ? Math.trunc(requested) : fallback;
  out.messages = turns.map((t) => ({ role: t.role, content: t.role === "user" ? toolResultsFirst(t.blocks) : t.blocks }));
  if (system.length > 0) out.system = system.join("\n\n");
  if (streaming) out.stream = true;

  const tools = wireTools(b.tools);
  if (tools.length > 0) out.tools = tools;

  const stop = b.stop;
  const stops = typeof stop === "string" ? [stop] : Array.isArray(stop) ? stop.filter((s): s is string => typeof s === "string" && s !== "") : [];
  if (stops.length > 0) out.stop_sequences = stops;

  if (opts.caps?.adaptiveThinking === true) out.thinking = { type: "adaptive", display: "summarized" };
  const effort = b.effort;
  if (opts.caps?.effort === true && (effort === "low" || effort === "medium" || effort === "high" || effort === "xhigh" || effort === "max")) {
    out.output_config = { effort };
  }
  return out;
}

// ── Antwort ──────────────────────────────────────────────────────────────────────────────────────

const FINISH: Record<string, string> = {
  end_turn: "stop", stop_sequence: "stop", pause_turn: "stop",
  max_tokens: "length", model_context_window_exceeded: "length",
  tool_use: "tool_calls", refusal: "content_filter",
};
export function finishReasonOf(stopReason: unknown): string {
  return typeof stopReason === "string" ? (FINISH[stopReason] ?? "stop") : "stop";
}

/** HTTP-Status zu einem Fehlertyp der API — für den Fehler MITTEN im Strom (dort war der Status schon 200). */
const ERROR_STATUS: Record<string, number> = {
  invalid_request_error: 400, authentication_error: 401, billing_error: 402, permission_error: 403, not_found_error: 404,
  request_too_large: 413, rate_limit_error: 429, api_error: 500, overloaded_error: 529, timeout_error: 504,
};
export function anthropicErrorStatus(type: unknown): number {
  return typeof type === "string" ? (ERROR_STATUS[type] ?? 500) : 500;
}

/** Die 400er-Antwort, die ein Denkblock mit fremder Signatur auslöst (preserved thinking, Wortlaut der Doku):
 *  Auslöser der einen Wiederholung ohne Denkblöcke. */
export const THINKING_SIGNATURE_RE = /invalid\s+`?signature`?\s+in\s+`?(?:redacted_)?thinking`?\s+block|bound to a different conversation/i;
export function isThinkingSignatureError(raw: string): boolean {
  return THINKING_SIGNATURE_RE.test(raw);
}

const chunk = (obj: unknown): string => `data: ${JSON.stringify(obj)}\n\n`;

export interface StreamTranslator {
  /** Rohtext des Anthropic-Stroms → OpenAI-SSE-Zeilen (`""`, wenn nichts Vollständiges da ist). */
  push(text: string): string;
  /** Rest und Abschluss (`data: [DONE]`), einmal nach dem letzten `push`. */
  finish(): string;
  /** Fehler-Ereignis (`event: error`) mitten im Strom. */
  readonly error: { type: string; message: string } | null;
  /** Das Denken (samt Platz) und die Werkzeug-Ids der Runde, sobald `finish()` lief (für den Merkzettel). */
  readonly turn: { anchors: ThinkingAnchor[]; toolUseIds: string[] };
}

export function createStreamTranslator(): StreamTranslator {
  let buffer = "";
  let error: { type: string; message: string } | null = null;
  const anchors: ThinkingAnchor[] = [];
  /** Abgeschlossene Denkblöcke, deren Platz noch offen ist: er steht fest, sobald der nächste Block beginnt. */
  let pending: AnthropicBlock[] = [];
  const place = (before: string): void => { for (const block of pending) anchors.push({ block, before }); pending = []; };
  const toolUseIds: string[] = [];
  /** Block-Index der API → was wir dort sammeln. */
  const open = new Map<number, { kind: "thinking" | "redacted" | "tool" | "other"; block?: AnthropicBlock; toolIndex?: number }>();
  let toolCount = 0;
  let done = false;

  function event(data: Record<string, unknown>): string {
    switch (data.type) {
      case "message_start": {
        const m = isRecord(data.message) ? data.message : {};
        return chunk({ ...(typeof m.model === "string" ? { model: m.model } : {}), choices: [{ delta: { role: "assistant" } }] });
      }
      case "content_block_start": {
        const index = typeof data.index === "number" ? data.index : -1;
        const cb = isRecord(data.content_block) ? data.content_block : {};
        if (cb.type === "tool_use") {
          const toolIndex = toolCount++;
          const id = typeof cb.id === "string" ? cb.id : `call_${toolIndex}`;
          toolUseIds.push(id);
          place(id);
          open.set(index, { kind: "tool", toolIndex });
          return chunk({ choices: [{ delta: { tool_calls: [{ index: toolIndex, id, type: "function", function: { name: typeof cb.name === "string" ? cb.name : "", arguments: "" } }] } }] });
        }
        if (cb.type === "thinking") { open.set(index, { kind: "thinking", block: { type: "thinking", thinking: typeof cb.thinking === "string" ? cb.thinking : "", signature: typeof cb.signature === "string" ? cb.signature : "" } }); return ""; }
        if (cb.type === "redacted_thinking") { open.set(index, { kind: "redacted", block: { ...cb, type: "redacted_thinking" } }); return ""; }
        if (cb.type === "text") place("text");
        open.set(index, { kind: "other" });
        return "";
      }
      case "content_block_delta": {
        const index = typeof data.index === "number" ? data.index : -1;
        const d = isRecord(data.delta) ? data.delta : {};
        const slot = open.get(index);
        if (d.type === "text_delta" && typeof d.text === "string") return d.text === "" ? "" : chunk({ choices: [{ delta: { content: d.text } }] });
        if (d.type === "thinking_delta" && typeof d.thinking === "string") {
          if (slot?.block) slot.block.thinking = `${slot.block.thinking as string}${d.thinking}`;
          return d.thinking === "" ? "" : chunk({ choices: [{ delta: { reasoning_content: d.thinking } }] });
        }
        if (d.type === "signature_delta" && typeof d.signature === "string") {
          if (slot?.block) slot.block.signature = `${(slot.block.signature as string | undefined) ?? ""}${d.signature}`;
          return "";
        }
        if (d.type === "input_json_delta" && typeof d.partial_json === "string" && slot?.kind === "tool") {
          return d.partial_json === "" ? "" : chunk({ choices: [{ delta: { tool_calls: [{ index: slot.toolIndex, function: { arguments: d.partial_json } }] } }] });
        }
        return "";
      }
      case "content_block_stop": {
        const index = typeof data.index === "number" ? data.index : -1;
        const slot = open.get(index);
        if (slot?.block && (slot.kind === "thinking" || slot.kind === "redacted")) pending.push(slot.block);
        open.delete(index);
        return "";
      }
      case "message_delta": {
        const d = isRecord(data.delta) ? data.delta : {};
        return d.stop_reason === undefined || d.stop_reason === null ? "" : chunk({ choices: [{ delta: {}, finish_reason: finishReasonOf(d.stop_reason) }] });
      }
      case "error": {
        const e = isRecord(data.error) ? data.error : {};
        error = { type: typeof e.type === "string" ? e.type : "api_error", message: typeof e.message === "string" && e.message !== "" ? e.message : "stream error" };
        return "";
      }
      default:
        return "";   // ping, message_stop, unbekannte Ereignisse
    }
  }

  function lines(text: string): string {
    let out = "";
    for (const line of text.split(/\r\n|\n|\r/)) {
      const t = line.trim();
      if (!t.startsWith("data:")) continue;   // `event:`-Zeilen tragen nichts, was `data.type` nicht auch trägt
      let data: unknown;
      try { data = JSON.parse(t.slice(5).trim()); } catch { continue; }
      if (isRecord(data)) out += event(data);
    }
    return out;
  }

  return {
    push(text) {
      buffer += text;
      const cut = Math.max(buffer.lastIndexOf("\n"), buffer.lastIndexOf("\r"));
      if (cut < 0) return "";
      const complete = buffer.slice(0, cut + 1);
      buffer = buffer.slice(cut + 1);
      return lines(complete);
    },
    finish() {
      if (done) return "";
      done = true;
      place("end");
      const rest = buffer;
      buffer = "";
      return `${rest.trim() === "" ? "" : lines(`${rest}\n`)}data: [DONE]\n\n`;
    },
    get error() { return error; },
    get turn() { return { anchors, toolUseIds }; },
  };
}

export interface TranslatedMessage {
  /** Eine OpenAI-Completion (`choices[0].message`), wie `chat-client` sie ohne Stream liest. */
  completion: Record<string, unknown>;
  anchors: ThinkingAnchor[];
  toolUseIds: string[];
}

/** Antwort ohne Stream (`{type:"message", content:[…], stop_reason}`) als OpenAI-Completion; `null`, wenn der Körper
 *  keine Nachricht ist. */
export function translateMessage(json: unknown): TranslatedMessage | null {
  if (!isRecord(json) || json.type !== "message" || !Array.isArray(json.content)) return null;
  let text = "";
  let reasoning = "";
  const anchors: ThinkingAnchor[] = [];
  let pending: AnthropicBlock[] = [];
  const place = (before: string): void => { for (const block of pending) anchors.push({ block, before }); pending = []; };
  const toolCalls: unknown[] = [];
  const toolUseIds: string[] = [];
  for (const b of json.content) {
    if (!isRecord(b)) continue;
    if (b.type === "text" && typeof b.text === "string") { place("text"); text += b.text; }
    else if (b.type === "thinking") { if (typeof b.thinking === "string") reasoning += b.thinking; pending.push({ ...b, type: "thinking" }); }
    else if (b.type === "redacted_thinking") pending.push({ ...b, type: "redacted_thinking" });
    else if (b.type === "tool_use" && typeof b.name === "string") {
      const id = typeof b.id === "string" ? b.id : `call_${toolCalls.length}`;
      toolUseIds.push(id);
      place(id);
      toolCalls.push({ id, type: "function", function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) } });
    }
  }
  place("end");
  const message: Record<string, unknown> = { role: "assistant", content: text };
  if (reasoning !== "") message.reasoning_content = reasoning;
  if (toolCalls.length > 0) message.tool_calls = toolCalls;
  return {
    completion: { ...(typeof json.model === "string" ? { model: json.model } : {}), choices: [{ message, finish_reason: finishReasonOf(json.stop_reason) }] },
    anchors, toolUseIds,
  };
}
