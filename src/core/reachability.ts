import { normalizeEndpoint } from "../vendor/kit/endpoint";
import type { EndpointConfig } from "../vendor/kit/endpoint_config";
import type { Capability, ManagedEndpoint } from "./model";

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
      const e = entries.get(normalizeEndpoint(url));
      if (!e) return null;
      if (now() - e.at > ttlMs) { entries.delete(normalizeEndpoint(url)); return null; }
      return e.reachable;
    },
    set(url, reachable) { entries.set(normalizeEndpoint(url), { reachable, at: now() }); },
    invalidate(url) { entries.delete(normalizeEndpoint(url)); },
    clear() { entries.clear(); },
  };
}

export type ResolveError = "no-endpoint" | "not-found" | "disabled" | "secret-missing" | "unreachable";
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

/** Erster erreichbarer, aktivierter Eintrag mit der Fähigkeit, in Listenreihenfolge. Einträge mit
 *  fehlendem Token werden still übersprungen (kein Fehler — der Manager zeigt sie im Tab an). */
export async function resolveFirst(
  eps: ManagedEndpoint[],
  cap: Capability,
  cache: ReachabilityCache,
  probe: (m: Materialized) => Promise<boolean>,
  token: (secretId: string) => string | null,
): Promise<Materialized | { error: "no-endpoint" }> {
  for (const ep of eps) {
    if (!ep.enabled || !ep.capabilities.includes(cap)) continue;
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
