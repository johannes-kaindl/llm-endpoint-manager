/** EINE Quelle für den Vertrag: das Kit-Modul (vendored). Die Typen hier waren bis Plan 3 die
 *  Vorlage; jetzt re-exportiert, damit Manager und Konsumenten nie auseinanderlaufen. */
export {
  LLM_ENDPOINT_MANAGER_API_VERSION, LLM_ENDPOINT_MANAGER_PLUGIN_ID,
  type ApiErrorCode, type ApiError, type ApiEndpoint, type ResolvedEndpoint, type ImportResult, type LlmEndpointManagerApi,
} from "../vendor/kit/endpoint-source";
