import { createModelListCache } from "../vendor/kit/model-list-cache";
import type { SecretStore } from "../vendor/kit/secrets";
import type { EndpointConfig } from "../vendor/kit/endpoint_config";
import { normalizeEndpoint } from "../vendor/kit/endpoint";
import { LLM_ENDPOINT_MANAGER_API_VERSION, type ApiEndpoint, type ApiError, type ImportResult, type LlmEndpointManagerApi, type ResolvedEndpoint } from "./api-types";
import { byCapability, importEndpoints } from "./list-ops";
import { toPersisted, type Capability, type ManagedEndpoint, type ManagerSettings, type Provider } from "./model";
import { createReachabilityCache, materialize, resolveFirst, type Materialized, type ReachabilityCache } from "./reachability";

export interface CallerRecord { caller: string; capability?: Capability; at: number }
const CALLER_RING = 50;

export interface ApiDeps {
  settings(): ManagerSettings;
  /** Schreibt den neuen Zustand (Import). Der Aufrufer persistiert; die API mutiert nichts still. */
  replaceSettings(next: ManagerSettings): Promise<void>;
  secrets: SecretStore;
  probe(m: Materialized, provider: Provider): Promise<boolean>;
  listModels(m: Materialized, provider: Provider): Promise<string[]>;
  now(): number;
  mint(): string;
}

export interface ManagerApiHandle {
  api: LlmEndpointManagerApi;
  callers(): CallerRecord[];
  notifyChanged(): void;
  reachability: ReachabilityCache;
  /** Bei jeder Mutation eines Eintrags rufen (URL, Token, enabled, Entfernen). */
  invalidateUrl(url: string): void;
}

function toApiEndpoint(e: ManagedEndpoint, secrets: SecretStore): ApiEndpoint {
  const out: ApiEndpoint = {
    id: e.id, label: e.label, url: e.url, provider: e.provider, capabilities: [...e.capabilities],
    enabled: e.enabled, hasSecret: e.secretId !== undefined && secrets.has(e.secretId),
  };
  if (e.model) out.defaultModel = e.model;
  if (e.backend) out.backend = e.backend;
  if (e.models) out.models = e.models;
  return out;
}

function toResolved(m: Materialized): ResolvedEndpoint {
  const out: ResolvedEndpoint = { id: m.ep.id, label: m.ep.label, config: m.config };
  if (m.ep.model) out.defaultModel = m.ep.model;
  if (m.ep.backend) out.backend = m.ep.backend;
  if (m.ep.models) out.models = m.ep.models;
  return out;
}

export function createManagerApi(deps: ApiDeps): ManagerApiHandle {
  const reachability = createReachabilityCache(() => deps.now());
  const models = createModelListCache();
  const listeners = new Set<() => void>();
  const callers: CallerRecord[] = [];
  const token = (sid: string): string | null => deps.secrets.get(sid);
  const record = (caller: string | undefined, capability?: Capability): void => {
    if (!caller) return;
    callers.push({ caller, capability, at: deps.now() });
    if (callers.length > CALLER_RING) callers.splice(0, callers.length - CALLER_RING);
  };
  const safeProbe = (m: Materialized): Promise<boolean> => deps.probe(m, m.ep.provider).catch(() => false);
  const find = (id: string): ManagedEndpoint | undefined => deps.settings().endpoints.find((e) => e.id === id);
  const notifyChanged = (): void => { for (const cb of listeners) { try { cb(); } catch { /* Fremd-Callback */ } } };

  const api: LlmEndpointManagerApi = {
    version: LLM_ENDPOINT_MANAGER_API_VERSION,
    list(filter) { return byCapability(deps.settings().endpoints, filter?.capability).map((e) => toApiEndpoint(e, deps.secrets)); },
    get(id) { const e = find(id); return e ? toApiEndpoint(e, deps.secrets) : null; },
    async resolve(capability, opts) {
      record(opts?.caller, capability);
      const r = await resolveFirst(deps.settings().endpoints, capability, reachability, safeProbe, token);
      return "error" in r ? r : toResolved(r);
    },
    async materialize(id, opts) {
      record(opts?.caller);
      const e = find(id);
      if (!e) return { error: "not-found" };
      const m = materialize(e, token);
      return "error" in m ? m : toResolved(m);
    },
    async models(id, opts) {
      const e = find(id);
      if (!e) return { error: "not-found" };
      const m = materialize(e, token);
      if ("error" in m) return m;
      const key = normalizeEndpoint(e.url);
      if (opts?.force) models.invalidate(key);
      const r = await models.load(key, {
        listModels: () => deps.listModels(m, e.provider).catch(() => []),
        probe: () => safeProbe(m).then((reachable) => ({ reachable })),
      });
      return [...r.models].sort();
    },
    async importEndpoints(eps: EndpointConfig[], capability) {
      const out = importEndpoints(deps.settings().endpoints, eps, capability, () => deps.mint(), (sid) => deps.secrets.has(sid));
      // Reihenfolge bewusst: erst die Settings persistieren (secretId-Zuordnung steht damit fest),
      // DANN die Secrets schreiben — scheitert das Secret-Schreiben, verweist trotzdem kein Eintrag
      // auf ein Token, das nie im Schlüsselbund landete (umgekehrt wäre ein Secret verwaist, wenn
      // replaceSettings scheitert). `obsidianSecretStore.set` wirft absichtlich bei einem Schlüsselbund,
      // der den Wert nicht persistiert; ein Konsument, der laut Vertrag "error" in result statt
      // try/catch prüft, darf das nie als unbehandelte Rejection sehen.
      await deps.replaceSettings(toPersisted({ version: 1, endpoints: out.endpoints }));
      for (const e of out.endpoints) reachability.invalidate(e.url);
      notifyChanged();
      try {
        for (const s of out.secrets) deps.secrets.set(s.secretId, s.value);
      } catch {
        return { error: "secret-missing" } satisfies ApiError;
      }
      return out.result satisfies ImportResult;
    },
    on(_event, cb) { listeners.add(cb); return () => { listeners.delete(cb); }; },
  };

  return {
    api,
    callers: () => [...callers],
    notifyChanged,
    reachability,
    invalidateUrl: (url) => { reachability.invalidate(url); models.invalidate(normalizeEndpoint(url)); },
  };
}

export type { ApiError };
