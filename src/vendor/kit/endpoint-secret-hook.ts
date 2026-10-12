// vendored from obsidian-kit@0.59.0, src/pure/endpoint-secret-hook.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
import type { EndpointConfig } from "./endpoint_config";

/** Schlüssel-Hook: der Consumer hält das Token woanders (Obsidian-Schlüsselbund, Kit-Modul
 *  `secrets`) — die Liste schreibt dann NIE in `cfg.apiKey`, sondern ruft diese vier. Fehlt der
 *  Hook, gilt das bisherige Verhalten (Passwortfeld → `apiKey` in der Liste).
 *
 *  Eigene Datei (rein, ohne `obsidian`), damit `endpoint-secrets` ihn nutzen kann, ohne `endpoint-list`
 *  und dessen CSS mitzuziehen; `endpoint-list` re-exportiert ihn. */
export interface EndpointSecretHook<T extends EndpointConfig = EndpointConfig> {
  available: boolean;
  has(cfg: T, index: number): boolean;
  set(cfg: T, index: number, value: string): Promise<void>;
  clear(cfg: T, index: number): Promise<void>;
  /** Optional: die Zeile wird entfernt (Mülleimer oder leere URL) — ihr Schlüssel geht mit, damit
   *  kein verwaister Schlüssel im Schlüsselbund bleibt. Wirkt nur auf den Schlüsselbund, nicht
   *  auf die Liste (die mutiert der Aufrufer). */
  release?(cfg: T): void;
}
