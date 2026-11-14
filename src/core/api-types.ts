/** EINE Quelle für den Vertrag: das Kit-Modul (vendored). Die Typen hier waren bis Plan 3 die
 *  Vorlage; jetzt re-exportiert, damit Manager und Konsumenten nie auseinanderlaufen.
 *  `ApiErrorCode` kennt auch `"unreachable"`: den Wert setzt der Konsument (Kit `endpoint-source`), wenn der
 *  Aufruf des Managers selbst scheitert; der Manager gibt ihn nie zurück. */
import type { ApiError, LlmEndpointManagerApi } from "../vendor/kit/endpoint-source";
export {
  LLM_ENDPOINT_MANAGER_API_VERSION, LLM_ENDPOINT_MANAGER_PLUGIN_ID,
  type ApiErrorCode, type ApiError, type ApiEndpoint, type ResolvedEndpoint, type ImportResult, type LlmEndpointManagerApi,
  type ListFilter, type EndpointTransport, type ShortcutTransportConfig,
} from "../vendor/kit/endpoint-source";

/** Antwort von `modelList`: die Modelle, die der Endpunkt meldet, und ob er erreichbar ist. `models: []` mit `reachable: true`
 *  heißt „antwortet, gibt aber keine Liste heraus“, mit `reachable: false` „nicht erreichbar“; `models()` kann beides nicht trennen. */
export interface ModelListStatus { models: string[]; reachable: boolean }
/** Der Vertrag v1 des Kits plus additive Methoden des Managers. `version` bleibt 1, ein Konsument prüft die Methode per Form
 *  (`hasModelList`) und fällt sonst auf `models()` zurück. Das Kit-Interface ist vendort und wird hier nicht angefasst. */
export interface ManagerApi extends LlmEndpointManagerApi {
  /** Wie `models()`, aber mit Erreichbarkeit. Derselbe Cache, derselbe `force`; Fehler sind Werte (`not-found`, `disabled`, `secret-missing`). */
  modelList(id: string, opts?: { force?: boolean }): Promise<ModelListStatus | ApiError>;
}
export function hasModelList(x: unknown): x is Pick<ManagerApi, "modelList"> {
  return x !== null && typeof x === "object" && typeof (x as Record<string, unknown>).modelList === "function";
}
