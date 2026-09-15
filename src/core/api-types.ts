import type { EndpointConfig } from "../vendor/kit/endpoint_config";
import type { Capability, Provider } from "./model";

/** Öffentlicher Vertrag `app.plugins.plugins["llm-endpoint-manager"].api`. Muster:
 *  calendar-notes/src/core/api/types.ts — Version als Konstante, Fehler als WERTE, jede Methode
 *  fängt selbst. Konsumenten lesen die API bei JEDEM Aufruf frisch und cachen sie nie (das
 *  Plugin kann jederzeit deaktiviert werden). Diese Datei wandert in Plan 3 wörtlich ins
 *  Kit-Modul `endpoint-source` — hier keine Importe außer Typen. */
export const LLM_ENDPOINT_MANAGER_API_VERSION = 1;

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
