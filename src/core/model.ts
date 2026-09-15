import { mergeSettings } from "../vendor/kit/settings";
import type { EndpointConfig } from "../vendor/kit/endpoint_config";
import { secretIdFor } from "../vendor/kit/secrets";
import type { Provider, Capability } from "../vendor/kit/endpoint-source";

export type { Provider, Capability } from "../vendor/kit/endpoint-source";
export const PROVIDERS: readonly Provider[] = ["openai", "ollama", "a1111", "comfy"];
export const CAPABILITIES: readonly Capability[] = ["chat", "embedding", "vision", "image"];

/** Ein Endpunkt des Managers. `extends EndpointConfig`, damit der Kit-Listen-Editor
 *  (buildEndpointList<T>) URL, Reihenfolge und Modell unverändert bedient — `model` ist hier das
 *  Default-Modell des Endpunkts (Spec nennt es nach außen `defaultModel`). `apiKey` ist im
 *  gespeicherten Zustand IMMER abwesend: das Token lebt im Schlüsselbund unter `secretId`. */
export interface ManagedEndpoint extends EndpointConfig {
  id: string;
  label: string;
  provider: Provider;
  capabilities: Capability[];
  enabled: boolean;
  secretId?: string;
}

export interface ManagerSettings {
  version: 1;
  endpoints: ManagedEndpoint[];
}

export const DEFAULT_SETTINGS: ManagerSettings = { version: 1, endpoints: [] };
export const SECRET_PREFIX = "llm-endpoint-manager";

export function secretIdOf(id: string): string {
  return secretIdFor(SECRET_PREFIX, id);
}

export function newId(): string {
  return crypto.randomUUID();
}

export function labelFromUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.host || url;
  } catch {
    return url;
  }
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function capabilitiesOf(raw: unknown): Capability[] {
  if (!Array.isArray(raw)) return [];
  const out: Capability[] = [];
  for (const c of raw) {
    if (typeof c === "string" && (CAPABILITIES as readonly string[]).includes(c) && !out.includes(c as Capability)) out.push(c as Capability);
  }
  return out;
}

/** Ein roher Listeneintrag → ManagedEndpoint oder null (kein Eintrag ohne URL). Unbekannte
 *  Provider fallen auf openai, unbekannte Fähigkeiten fliegen, ein leeres Fähigkeiten-Array wird
 *  zu ["chat"] (ein Eintrag ohne Fähigkeit fände sonst nie ein Plugin). `apiKey` wird NIE
 *  übernommen — auch nicht aus einer alten data.json. */
export function normalizeEndpointEntry(raw: unknown, mint: () => string): ManagedEndpoint | null {
  if (raw === null || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const url = str(r.url);
  if (!url) return null;
  const provider = (PROVIDERS as readonly string[]).includes(str(r.provider)) ? (str(r.provider) as Provider) : "openai";
  const caps = capabilitiesOf(r.capabilities);
  const model = str(r.model);
  const secretId = str(r.secretId);
  const out: ManagedEndpoint = {
    id: str(r.id) || mint(),
    label: str(r.label) || labelFromUrl(url),
    url,
    provider,
    capabilities: caps.length ? caps : ["chat"],
    enabled: r.enabled !== false,
  };
  if (model) out.model = model;
  if (secretId) out.secretId = secretId;
  return out;
}

export function loadSettings(raw: unknown, mint: () => string = newId): ManagerSettings {
  const merged = mergeSettings(DEFAULT_SETTINGS, raw) as { endpoints?: unknown };
  const list = Array.isArray(merged.endpoints) ? merged.endpoints : [];
  const endpoints = list.map((e) => normalizeEndpointEntry(e, mint)).filter((e): e is ManagedEndpoint => e !== null);
  return { version: 1, endpoints };
}

/** Der EINZIGE Weg nach data.json: baut jeden Eintrag neu auf, ohne `apiKey`. */
export function toPersisted(s: ManagerSettings): ManagerSettings {
  return {
    version: 1,
    endpoints: s.endpoints.map((e) => {
      const { apiKey: _drop, ...rest } = e;
      void _drop;
      return { ...rest, capabilities: [...new Set(e.capabilities)] };
    }),
  };
}
