import { normalizeEndpoint } from "../vendor/kit/endpoint";
import type { EndpointConfig } from "../vendor/kit/endpoint_config";
import { labelFromUrl, secretIdOf, type Capability, type EndpointTransport, type ManagedEndpoint } from "./model";

export function byCapability(eps: ManagedEndpoint[], cap?: Capability): ManagedEndpoint[] {
  return cap ? eps.filter((e) => e.capabilities.includes(cap)) : [...eps];
}

/** Opt-in-Filter (Spec § Baustein 2): Default `["http"]` — ein Aufrufer, der `transports` nicht
 *  ausdrücklich nennt, sieht nie einen Apple-Endpunkt (dessen `url` ist kein HTTP-Ziel; alte
 *  Vendor-Kopien der Konsumenten würden sonst ins Leere feuern). Ein Endpunkt ohne `transport`
 *  gilt als `"http"`. */
export function byTransport(eps: ManagedEndpoint[], transports?: EndpointTransport[]): ManagedEndpoint[] {
  const wanted = transports ?? ["http"];
  return eps.filter((e) => wanted.includes(e.transport ?? "http"));
}

export interface ImportResult { added: string[]; merged: string[]; skipped: string[] }
export interface ImportOutcome {
  endpoints: ManagedEndpoint[];
  result: ImportResult;
  /** Vom Aufrufer in den Schlüsselbund zu schreiben — pure Funktionen schreiben nichts. */
  secrets: Array<{ secretId: string; value: string }>;
}

/** Konsumenten-Liste → Manager-Liste. Gleiche normalisierte URL wird zusammengeführt
 *  (Fähigkeiten vereinigt, vorhandenes Token bleibt), sonst neu angelegt. Rückgabe trägt Labels
 *  für die Anzeige und die zu schreibenden Secrets getrennt vom Zustand. */
export function importEndpoints(
  existing: ManagedEndpoint[],
  incoming: EndpointConfig[],
  cap: Capability,
  mint: () => string,
  hasSecret: (secretId: string) => boolean,
): ImportOutcome {
  const endpoints = existing.map((e) => ({ ...e, capabilities: [...e.capabilities] }));
  const result: ImportResult = { added: [], merged: [], skipped: [] };
  const secrets: ImportOutcome["secrets"] = [];
  const seen = new Set<string>();
  for (const raw of incoming) {
    const url = raw?.url?.trim() ?? "";
    if (!url) { result.skipped.push("(leer)"); continue; }
    const key = normalizeEndpoint(url);
    if (seen.has(key)) { result.skipped.push(labelFromUrl(url)); continue; }
    seen.add(key);
    const token = raw.apiKey?.trim() ?? "";
    const found = endpoints.find((e) => normalizeEndpoint(e.url) === key);
    if (found) {
      if (!found.capabilities.includes(cap)) found.capabilities.push(cap);
      const sid = found.secretId ?? secretIdOf(found.id);
      if (token && !hasSecret(sid)) { secrets.push({ secretId: sid, value: token }); found.secretId = sid; }
      result.merged.push(found.label);
      continue;
    }
    const id = mint();
    const entry: ManagedEndpoint = { id, label: labelFromUrl(url), url: key, provider: "openai", capabilities: [cap], enabled: true };
    const model = raw.model?.trim();
    if (model) entry.model = model;
    if (token) { const sid = secretIdOf(id); secrets.push({ secretId: sid, value: token }); entry.secretId = sid; }
    endpoints.push(entry);
    result.added.push(entry.label);
  }
  return { endpoints, result, secrets };
}
