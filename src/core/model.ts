import { mergeSettings } from "../vendor/kit/settings";
import type { EndpointConfig } from "../vendor/kit/endpoint_config";
import { secretIdFor } from "../vendor/kit/secrets";
import type { Provider, Capability, ApiModelInfo } from "../vendor/kit/endpoint-source";
import { BACKEND_IDS, FAMILY_IDS, type BackendId, type FamilyId } from "../vendor/kit/sampling-profiles";

export type { Provider, Capability } from "../vendor/kit/endpoint-source";

/** `as const satisfies` statt eines Laufzeit-Arrays über dem Typ: erweitert ein Re-Vendoring die
 *  `Provider`/`Capability`-Union der Kit-Quelle, bricht der Compiler HIER statt still einen
 *  unbekannten Wert in `normalizeEndpointEntry` auf "openai" herunterzustufen bzw. im
 *  Settings-Dropdown wegzulassen (Finding 3, Whole-Branch-Review). */
export const PROVIDERS = ["openai", "ollama", "a1111", "comfy"] as const satisfies readonly Provider[];
export type _AlleProviderAbgedeckt = Exclude<Provider, (typeof PROVIDERS)[number]> extends never ? true : never;

export const CAPABILITIES = ["chat", "embedding", "vision", "image"] as const satisfies readonly Capability[];
export type _AlleCapabilityAbgedeckt = Exclude<Capability, (typeof CAPABILITIES)[number]> extends never ? true : never;
/** Die Typen oben prüfen nichts, solange niemand sie belegt: erst die Zuweisung erzwingt `never`-Freiheit. */
export const _pruefeProvider: _AlleProviderAbgedeckt = true;
export const _pruefeCapability: _AlleCapabilityAbgedeckt = true;

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
  backend?: BackendId;
  models?: ApiModelInfo[];
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

/** Host (mit Port) als Anzeigename; leer, wenn die Adresse nur ein Schema ohne Host ist — der
 *  Preset „OpenAI-compatible cloud“ startet mit `https://`, und das ist kein Name. Der Aufrufer
 *  entscheidet den Ersatz (Preset-Name, i18n-Platzhalter). */
export function labelFromUrl(url: string): string {
  if (/^[a-z][a-z0-9+.-]*:\/*$/i.test(url.trim())) return "";
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

function backendOf(raw: unknown): BackendId | undefined {
  return typeof raw === "string" && (BACKEND_IDS as readonly string[]).includes(raw) ? (raw as BackendId) : undefined;
}

function modelsOf(raw: unknown): ApiModelInfo[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: ApiModelInfo[] = [];
  for (const r of raw) {
    if (typeof r !== "object" || r === null) continue;
    const o = r as Record<string, unknown>;
    const id = str(o.id);
    if (!id) continue;
    const row: ApiModelInfo = { id };
    if (typeof o.family === "string" && (FAMILY_IDS as readonly string[]).includes(o.family)) row.family = o.family as FamilyId;
    const alias = str(o.aliasOf);
    if (alias && alias !== id) row.aliasOf = alias;
    out.push(row);
  }
  return out;
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
  const rawProvider = str(r.provider);
  const provider = (PROVIDERS as readonly string[]).includes(rawProvider) ? (rawProvider as Provider) : "openai";
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
  const backend = backendOf(r.backend);
  if (backend) out.backend = backend;
  const models = modelsOf(r.models);
  if (models && models.length) out.models = models;
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
