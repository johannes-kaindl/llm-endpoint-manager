import { normalizeEndpoint } from "../vendor/kit/endpoint";
import type { EndpointConfig } from "../vendor/kit/endpoint_config";
import type { Capability, EndpointTransport, ManagedEndpoint } from "./model";

export const REACHABILITY_TTL_MS = 30_000;

export interface ReachabilityCache {
  get(url: string): boolean | null;
  set(url: string, reachable: boolean): void;
  invalidate(url: string): void;
  clear(): void;
}

/** Je normalisierter URL ein Ergebnis mit Zeitstempel. Die Regel aus Kit 0.34.1 als Vertrag:
 *  jede Mutation, die die Antwort ändern kann (URL, Token, enabled, Entfernen), ruft
 *  `invalidate(url)` — der Cache kann das nicht selbst wissen. */
export function createReachabilityCache(now: () => number, ttlMs: number = REACHABILITY_TTL_MS): ReachabilityCache {
  const entries = new Map<string, { reachable: boolean; at: number }>();
  return {
    get(url) {
      const key = normalizeEndpoint(url);
      const e = entries.get(key);
      if (!e) return null;
      if (now() - e.at > ttlMs) { entries.delete(key); return null; }
      return e.reachable;
    },
    set(url, reachable) { entries.set(normalizeEndpoint(url), { reachable, at: now() }); },
    invalidate(url) { entries.delete(normalizeEndpoint(url)); },
    clear() { entries.clear(); },
  };
}

export interface Materialized { ep: ManagedEndpoint; config: EndpointConfig }

/** ManagedEndpoint → code-kit EndpointConfig mit Token aus dem Schlüsselbund. Das Token kommt
 *  NUR hier ins `apiKey`-Feld — zur Laufzeit, für den Aufrufer, nie in den Zustand. */
export function materialize(ep: ManagedEndpoint, token: (secretId: string) => string | null): Materialized | { error: "disabled" | "secret-missing" } {
  if (!ep.enabled) return { error: "disabled" };
  const config: EndpointConfig = { url: ep.url };
  if (ep.model) config.model = ep.model;
  if (ep.secretId) {
    const t = token(ep.secretId);
    if (!t) return { error: "secret-missing" };
    config.apiKey = t;
  }
  return { ep, config };
}

/** Welche Einträge `resolve()` von selbst wählen darf. Ein Eintrag ohne `transport` ist `http`; ohne Opt-in des Aufrufers
 *  (`transports`) nur diese. `"anthropic"` kommt nur auf ausdrücklichen Wunsch dazu (Welle 23: ein älteres Plugin sieht den
 *  Endpunkt nie, weder in `list()` noch hier). Ein Kurzbefehl-Endpunkt wird NIE automatisch gewählt, auch nicht mit Opt-in:
 *  ein Plugin holt ihn über `list({ transports: ["shortcuts"] })` und `materialize(id)`. */
export function autoResolvable(ep: ManagedEndpoint, transports?: EndpointTransport[]): boolean {
  const own = ep.transport ?? "http";
  if (own === "shortcuts") return false;
  return (transports ?? ["http"]).includes(own);
}

/** Erster erreichbarer, aktivierter Eintrag mit der Fähigkeit, in Listenreihenfolge. Einträge mit
 *  fehlendem Token werden still übersprungen (kein Fehler — der Manager zeigt sie im Tab an). */
/** `resolve()` des öffentlichen Vertrags kennt kein `transports`-Opt-in (anders als `list()`) —
 *  ein unbedarfter Konsument, der einfach „das erste erreichbare" will, darf NIE einen
 *  Apple-Endpunkt bekommen (dessen `config.url` ist kein HTTP-Ziel). Default ist deshalb hier
 *  fest `"http"`, nicht konfigurierbar: ein Konsument, der einen Shortcuts-Endpunkt bewusst will,
 *  holt ihn über `list({transports:["shortcuts"]})` + `materialize(id)` mit expliziter ID. */
export async function resolveFirst(
  eps: ManagedEndpoint[],
  cap: Capability,
  cache: ReachabilityCache,
  probe: (m: Materialized) => Promise<boolean>,
  token: (secretId: string) => string | null,
  transports?: EndpointTransport[],
): Promise<Materialized | { error: "no-endpoint" }> {
  for (const ep of eps) {
    if (!ep.enabled || !ep.capabilities.includes(cap) || !autoResolvable(ep, transports)) continue;
    const m = materialize(ep, token);
    if ("error" in m) continue;
    let reachable = cache.get(ep.url);
    if (reachable === null) {
      reachable = await probe(m);
      cache.set(ep.url, reachable);
    }
    if (reachable) return m;
  }
  return { error: "no-endpoint" };
}

/** Welcher Eintrag bekäme `resolve(cap)` gerade? Dieselbe Auswahl wie `resolveFirst`, aber ohne Probe:
 *  Erreichbarkeit kommt aus `known` (unbekannt zählt wie nicht erreichbar). Gibt die normalisierte URL
 *  zurück, damit die Endpunkt-Liste ihre Zeilen damit vergleichen kann. */
export function firstActiveUrl(
  eps: ManagedEndpoint[],
  cap: Capability,
  known: (url: string) => boolean | undefined,
  token: (secretId: string) => string | null,
  transports?: EndpointTransport[],
): string | null {
  for (const ep of eps) {
    if (!ep.enabled || !ep.capabilities.includes(cap) || !autoResolvable(ep, transports)) continue;
    if ("error" in materialize(ep, token)) continue;
    const url = normalizeEndpoint(ep.url);
    if (known(url) === true) return url;
  }
  return null;
}
