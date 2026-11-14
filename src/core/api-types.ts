/** EINE Quelle für den Vertrag: das Kit-Modul (vendored). Die Typen hier waren bis Plan 3 die
 *  Vorlage; jetzt re-exportiert, damit Manager und Konsumenten nie auseinanderlaufen.
 *  `ApiErrorCode` kennt auch `"unreachable"`: den Wert setzt der Konsument (Kit `endpoint-source`), wenn der
 *  Aufruf des Managers selbst scheitert; der Manager gibt ihn nie zurück. */
import type { LlmEndpointManagerApi } from "../vendor/kit/endpoint-source";
export {
  LLM_ENDPOINT_MANAGER_API_VERSION, LLM_ENDPOINT_MANAGER_PLUGIN_ID,
  type ApiErrorCode, type ApiError, type ApiEndpoint, type ResolvedEndpoint, type ImportResult, type LlmEndpointManagerApi,
  type ListFilter, type EndpointTransport, type ShortcutTransportConfig,
} from "../vendor/kit/endpoint-source";

/** Antwort von `modelList`: die Modelle, die der Endpunkt meldet, und ob er erreichbar ist. `models: []` mit `reachable: true`
 *  heißt „antwortet, gibt aber keine Liste heraus“, mit `reachable: false` „nicht erreichbar“; `models()` kann beides nicht trennen. */
export interface ModelListStatus { models: string[]; reachable: boolean }
/** Der Vertrag des Kits (`modelList` ist dort seit obsidian-kit 0.89.0 als optionale Methode Teil von v1). Der Manager liefert sie
 *  immer; der Typ macht sie hier zur Pflicht, damit `models()` darauf aufbauen kann. Keine eigene Schnittstelle mehr. */
export type ManagerApi = LlmEndpointManagerApi & Required<Pick<LlmEndpointManagerApi, "modelList">>;
