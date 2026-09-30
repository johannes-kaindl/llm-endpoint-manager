// vendored from obsidian-kit@0.46.0, src/obsidian/shortcuts-bridge.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
/** Die einzige Brücke von einem Obsidian-Plugin zu Apples on-device-Fähigkeiten (LLM, STT, OCR,
 *  TTS, Bildgenerierung) über Kurzbefehle — auf iOS gibt es keinen anderen Weg (JS-only,
 *  Codesigning, Nachbar-App-Server werden suspendiert). One-shot, kein Streaming, sichtbarer
 *  App-Wechsel zu Kurzbefehle und zurück über einen vom Besitzer registrierten
 *  `obsidian://`-Protokoll-Handler.
 *
 *  Extraktion aus dem Spike (`fm-spike/src/main.ts`, 2026-09-27, Messwerte in
 *  `FM-Spike Messungen.md`), verallgemeinert: EIN Besitzer je Fähigkeit verbaut die Brücke einmal
 *  (Spec § Leitentscheidung) — Konsumenten fragen den Besitzer über dessen Anbieter-API, nie
 *  direkt über diese Datei. Ausnahme LLM-Weg (Entscheidung 2026-09-30): der Manager-Vertrag
 *  exponiert keine Brücke, dort baut der Konsument eine eigene Instanz (`protocolAction` =
 *  `<manifest.id>-shortcut`).
 *
 *  **Sicherheitsgrenze (Spike-Befund):** `obsidian://<action>` ist von jeder App/Webseite
 *  aufrufbar, nicht nur von der eigenen Brücke — deshalb die Correlation-ID: ein Callback ohne
 *  passende ID wird verworfen, nie verarbeitet. Ergebnistext ist Nutzereingabe (der Kurzbefehl
 *  läuft, was ein Fremder ihm gibt) und darf ein Konsument nie ungefiltert als Markdown rendern.
 *
 *  **Timeout ist die einzige Verteidigung**, kein Bonus: Kurzbefehle kennen kein Try/Catch (Apple
 *  DTS, Forum-Thread 813757 — „there is currently no way to detect an error from an action"),
 *  ein hängender Callback ist community-belegt (Advanced-URI-Issue #30). Ohne Timeout bliebe ein
 *  gelöschter Kurzbefehl für immer `pending`. */
import type { Plugin } from "obsidian";
import { realClock, type ClockPort } from "./clock";

export interface ShortcutRun {
  /** Exakter Kurzbefehl-Name (Settings des Konsumenten). */
  shortcut: string;
  /** Text-Payload ODER Vault-relativer Pfad — die Semantik bestimmt der Kurzbefehl selbst. */
  input: string;
  /** Pflicht: ein gelöschter Kurzbefehl antwortet NIE. */
  timeoutMs: number;
  /** Datei-Rückgabe (TTS, Bildgenerierung). Die Endung wählt der Kurzbefehl — gemessen `.caf`
   *  statt des angeforderten `.m4a` —, die Bridge probiert deshalb bekannte Endungen durch. */
  expectFile?: {
    vaultPathPrefix: string;
    pollMs?: number;
    pollTries?: number;
  };
}

export type ShortcutResult =
  | { ok: true; result: string; file?: string; durationMs: number }
  | { ok: false; reason: "error" | "cancel" | "timeout" | "busy" | "file-missing"; message: string; durationMs: number };

export interface ShortcutsBridgeOptions {
  /** Konvention: `<plugin-id>-shortcut` — der `obsidian://`-Namensraum ist global, jeder
   *  Besitzer wählt seinen eigenen Namen. */
  protocolAction: string;
  /** Default `window.open`. Injizierbar für Tests. */
  openUrl?: (url: string) => void;
  /** Default `realClock` (window-Timer — der Store-Scanner verlangt `window.setTimeout`,
   *  `obsidianmd/prefer-window-timers`). Injizierbar für Node-Tests (`clock.ts`-Muster). */
  clock?: ClockPort;
}

export interface ShortcutsBridge {
  run(req: ShortcutRun): Promise<ShortcutResult>;
}

const DEFAULT_POLL_MS = 500;
const DEFAULT_POLL_TRIES = 20;
// Bekannte Rückgabe-Endungen (Spike-Messung: der Kurzbefehl wählt die Endung, nicht der Aufrufer
// — TTS lieferte `.caf` statt des angeforderten `.m4a`).
const KNOWN_RESULT_EXTENSIONS = ["caf", "m4a", "wav", "mp3", "aiff", "png", "jpg", "jpeg", "heic"] as const;

interface PendingRun {
  cid: string;
  startedAt: number;
  expectFile?: ShortcutRun["expectFile"];
  resolve: (r: ShortcutResult) => void;
  timer: number;
}

let correlationSeq = 0;
function nextCorrelationId(): string {
  correlationSeq += 1;
  return `sb-${Date.now().toString(36)}-${correlationSeq}`;
}

function buildShortcutUrl(opts: { shortcut: string; input: string; protocolAction: string; cid: string }): string {
  const cb = (status: "ok" | "error" | "cancel"): string =>
    `obsidian://${opts.protocolAction}?status=${status}&cid=${encodeURIComponent(opts.cid)}`;
  return (
    "shortcuts://x-callback-url/run-shortcut" +
    `?name=${encodeURIComponent(opts.shortcut)}` +
    "&input=text" +
    `&text=${encodeURIComponent(opts.input)}` +
    `&x-success=${encodeURIComponent(cb("ok"))}` +
    `&x-error=${encodeURIComponent(cb("error"))}` +
    `&x-cancel=${encodeURIComponent(cb("cancel"))}`
  );
}

function sleep(clock: ClockPort, ms: number): Promise<void> {
  return new Promise((resolve) => {
    clock.setTimeout(() => { resolve(); }, ms);
  });
}

async function pollForFile(
  plugin: Plugin,
  clock: ClockPort,
  expect: NonNullable<ShortcutRun["expectFile"]>,
): Promise<string | null> {
  const tries = expect.pollTries ?? DEFAULT_POLL_TRIES;
  const delayMs = expect.pollMs ?? DEFAULT_POLL_MS;
  for (let i = 0; i < tries; i += 1) {
    for (const ext of KNOWN_RESULT_EXTENSIONS) {
      const candidate = `${expect.vaultPathPrefix}.${ext}`;
      if (await plugin.app.vault.adapter.exists(candidate)) return candidate;
    }
    if (i < tries - 1) await sleep(clock, delayMs);
  }
  return null;
}

/** Registriert **einmal** `plugin.registerObsidianProtocolHandler(opts.protocolAction, …)` und
 *  liefert `run()`, das genau EINEN Kurzbefehl-Lauf zur Zeit erlaubt (`busy` sonst — die
 *  x-callback-Rückkehr trägt keinen Payload-Bezug, parallele Läufe sind nicht unterscheidbar). */
export function createShortcutsBridge(plugin: Plugin, opts: ShortcutsBridgeOptions): ShortcutsBridge {
  const openUrl = opts.openUrl ?? ((url: string): void => { window.open(url); });
  const clock = opts.clock ?? realClock;
  let pending: PendingRun | null = null;

  const settle = (r: ShortcutResult): void => {
    if (!pending) return;
    clock.clearTimeout(pending.timer);
    const resolve = pending.resolve;
    pending = null;
    resolve(r);
  };

  plugin.registerObsidianProtocolHandler(opts.protocolAction, (params: Record<string, string>) => {
    void handleCallback(params);
  });

  async function handleCallback(params: Record<string, string>): Promise<void> {
    const run = pending;
    if (!run || params.cid !== run.cid) return; // Fremd-Callback: verwerfen, nie verarbeiten
    const durationMs = Date.now() - run.startedAt;
    const status = params.status;

    if (status !== "ok" && status !== "error" && status !== "cancel") {
      settle({ ok: false, reason: "error", message: `unerwarteter Status „${status ?? ""}“`, durationMs });
      return;
    }
    if (status === "error") {
      settle({
        ok: false, reason: "error",
        message: params.errorMessage || params.result || "Kurzbefehl meldete einen Fehler ohne Text",
        durationMs,
      });
      return;
    }
    if (status === "cancel") {
      settle({ ok: false, reason: "cancel", message: "Kurzbefehl abgebrochen", durationMs });
      return;
    }

    // status === "ok"
    const result = params.result ?? "";
    if (run.expectFile) {
      const file = await pollForFile(plugin, clock, run.expectFile);
      const finalDurationMs = Date.now() - run.startedAt;
      if (file === null) {
        const tried = KNOWN_RESULT_EXTENSIONS.map((e) => `${run.expectFile?.vaultPathPrefix}.${e}`).join(", ");
        settle({ ok: false, reason: "file-missing", message: `keine Datei gefunden, geprüft: ${tried}`, durationMs: finalDurationMs });
        return;
      }
      settle({ ok: true, result, file, durationMs: finalDurationMs });
      return;
    }
    settle({ ok: true, result, durationMs });
  }

  function run(req: ShortcutRun): Promise<ShortcutResult> {
    if (pending) {
      return Promise.resolve({ ok: false, reason: "busy", message: "ein anderer Kurzbefehl-Lauf ist bereits aktiv", durationMs: 0 });
    }
    const cid = nextCorrelationId();
    const startedAt = Date.now();
    return new Promise<ShortcutResult>((resolve) => {
      const timer = clock.setTimeout(() => {
        settle({ ok: false, reason: "timeout", message: `keine Antwort innerhalb von ${req.timeoutMs} ms`, durationMs: Date.now() - startedAt });
      }, req.timeoutMs);
      pending = { cid, startedAt, expectFile: req.expectFile, resolve, timer };
      openUrl(buildShortcutUrl({ shortcut: req.shortcut, input: req.input, protocolAction: opts.protocolAction, cid }));
    });
  }

  return { run };
}
