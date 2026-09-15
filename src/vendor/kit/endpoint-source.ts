// vendored from obsidian-kit@0.37.0, src/pure/endpoint-source.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
// ONE mechanical deviation from verbatim: kit-internal import (../vendor/code-kit/{pure,web}/) → ./ (flat vendor layout, sibling module in src/vendor/kit/); reproduce on every re-vendor, nothing else may differ.
import { resolveActiveEndpointConfig, type EndpointConfig } from "./endpoint_config";

/** Öffentlicher Vertrag des Plugins `llm-endpoint-manager` (dessen `src/core/api-types.ts` ist
 *  seit Plan 3 ein Re-Export dieser Datei — EINE Quelle). Fehler sind Werte, Methoden fangen
 *  selbst; Konsumenten lesen die API bei JEDEM Aufruf frisch (`findEndpointManager`). */
export const LLM_ENDPOINT_MANAGER_API_VERSION = 1;
export const LLM_ENDPOINT_MANAGER_PLUGIN_ID = "llm-endpoint-manager";

export type Provider = "openai" | "ollama" | "a1111" | "comfy";
export type Capability = "chat" | "embedding" | "vision" | "image";
export type ApiErrorCode = "no-endpoint" | "not-found" | "disabled" | "secret-missing" | "unreachable";
export interface ApiError { error: ApiErrorCode }
export interface ApiEndpoint {
  id: string; label: string; url: string; provider: Provider; capabilities: Capability[];
  defaultModel?: string; enabled: boolean; hasSecret: boolean;
}
export interface ResolvedEndpoint { id: string; label: string; config: EndpointConfig; defaultModel?: string }
export interface ImportResult { added: string[]; merged: string[]; skipped: string[] }
export interface LlmEndpointManagerApi {
  version: 1;
  list(filter?: { capability?: Capability }): ApiEndpoint[];
  get(id: string): ApiEndpoint | null;
  resolve(capability: Capability, opts?: { caller?: string }): Promise<ResolvedEndpoint | ApiError>;
  materialize(id: string, opts?: { caller?: string }): Promise<ResolvedEndpoint | ApiError>;
  models(id: string, opts?: { force?: boolean }): Promise<string[] | ApiError>;
  importEndpoints(eps: EndpointConfig[], capability: Capability): Promise<ImportResult | ApiError>;
  on(event: "changed", cb: () => void): () => void;
}

const METHODS = ["list", "get", "resolve", "materialize", "models", "importEndpoints", "on"] as const;

/** Form-Prüfung statt Vertrauen: ein Fremdplugin bekommt kein TS-Vertrauen geschenkt. */
export function isLlmEndpointManagerApi(x: unknown): x is LlmEndpointManagerApi {
  if (x === null || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  if (o.version !== LLM_ENDPOINT_MANAGER_API_VERSION) return false;
  return METHODS.every((m) => typeof o[m] === "function");
}

export interface EndpointChoice { endpointId?: string; model?: string }
export type SourceKind = "manager" | "local";
export interface EndpointSourceInput {
  manager?: LlmEndpointManagerApi | null;
  local: EndpointConfig[];
  localModel?: string;
  capability: Capability;
  choice?: EndpointChoice;
  caller?: string;
}
export interface EndpointSourceResult {
  kind: SourceKind;
  config: EndpointConfig | null;
  /** Modell für den Aufruf: choice.model → defaultModel → localModel → "". */
  model: string;
  reason?: ApiErrorCode;
}

function modelOf(choice: EndpointChoice | undefined, fallback: string | undefined): string {
  return choice?.model?.trim() || fallback?.trim() || "";
}

/** Quellenwahl des Konsumenten. Ist der Manager da, entscheidet er (kein lokaler Fallback bei
 *  „kein Endpunkt" — die eine Wahrheit soll auch die eine Meldung sein); fehlt er, läuft die
 *  lokale Liste wie bisher. Wirft nie. */
export async function resolveEndpointSource(
  input: EndpointSourceInput,
  ping: (cfg: EndpointConfig) => Promise<boolean>,
): Promise<EndpointSourceResult> {
  const { manager } = input;
  if (!manager) {
    const config = await resolveActiveEndpointConfig(input.local, ping);
    return { kind: "local", config, model: config ? modelOf(input.choice, input.localModel) : "" };
  }
  const opts = input.caller ? { caller: input.caller } : undefined;
  try {
    let reason: ApiErrorCode | undefined;
    const wanted = input.choice?.endpointId;
    if (wanted) {
      const m = await manager.materialize(wanted, opts);
      if (!("error" in m)) return { kind: "manager", config: m.config, model: modelOf(input.choice, m.defaultModel) };
      reason = m.error;   // verwaiste Wahl → automatisch weiter, Grund mitteilen
    }
    const r = await manager.resolve(input.capability, opts);
    if ("error" in r) return { kind: "manager", config: null, model: "", reason: r.error };
    const out: EndpointSourceResult = { kind: "manager", config: r.config, model: modelOf(input.choice, r.defaultModel) };
    if (reason) out.reason = reason;
    return out;
  } catch {
    return { kind: "manager", config: null, model: "", reason: "unreachable" };
  }
}
