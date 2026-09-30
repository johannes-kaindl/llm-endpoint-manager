// vendored from obsidian-kit@0.46.0, src/pure/endpoint-source.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
import { resolveActiveEndpointConfig, type EndpointConfig } from "./endpoint_config";
import { familyFromName, type BackendId, type FamilyId, type ModelFamilyId } from "./sampling-profiles";

/** Öffentlicher Vertrag des Plugins `llm-endpoint-manager` (dessen `src/core/api-types.ts` ist
 *  seit Plan 3 ein Re-Export dieser Datei — EINE Quelle). Fehler sind Werte, Methoden fangen
 *  selbst; Konsumenten lesen die API bei JEDEM Aufruf frisch (`findEndpointManager`). */
export const LLM_ENDPOINT_MANAGER_API_VERSION = 1;
export const LLM_ENDPOINT_MANAGER_PLUGIN_ID = "llm-endpoint-manager";

export type Provider = "openai" | "ollama" | "a1111" | "comfy" | "apple-shortcuts";
export type Capability = "chat" | "embedding" | "vision" | "image";
export type ApiErrorCode = "no-endpoint" | "not-found" | "disabled" | "secret-missing" | "unreachable";
export interface ApiError { error: ApiErrorCode }
/** `family` ist der Sampling-Schlüssel; `displayFamily` die Anzeige-Familie (kann `apple-fm` sein,
 *  das keinen Sampling-Schlüssel hat). Fehlt `displayFamily`, gilt `family` gespiegelt. */
export interface ApiModelInfo { id: string; family?: FamilyId; displayFamily?: ModelFamilyId; aliasOf?: string }
/** Transportwahl eines Endpunkts — additiv, Opt-in (Spec § Baustein 2, Vertragsentscheidung
 *  2026-09-27). Fehlt das Feld, ist der Endpunkt `"http"` wie bisher; `apiVersion` bleibt 1.
 *  `shortcut` ist nur bei `transport: "shortcuts"` gesetzt (Kurzbefehl-Name + Timeout, kommen aus
 *  `ResolvedEndpoint` in den Konsumenten-Transport, s. `obsidian/chat-transport.ts`
 *  `createShortcutsChatTransport`). */
export type EndpointTransport = "http" | "shortcuts";
export interface ShortcutTransportConfig { name: string; timeoutMs: number }
export interface ApiEndpoint {
  id: string; label: string; url: string; provider: Provider; capabilities: Capability[];
  defaultModel?: string; enabled: boolean; hasSecret: boolean;
  backend?: BackendId; models?: ApiModelInfo[];
  transport?: EndpointTransport; shortcut?: ShortcutTransportConfig;
}
export interface ResolvedEndpoint {
  id: string; label: string; config: EndpointConfig; defaultModel?: string; backend?: BackendId; models?: ApiModelInfo[];
  transport?: EndpointTransport; shortcut?: ShortcutTransportConfig;
}
export interface ImportResult { added: string[]; merged: string[]; skipped: string[] }
/** `transports` ist ein Opt-in-Filter, Default `["http"]` — ein Aufrufer, der nicht ausdrücklich
 *  `"shortcuts"` anfordert, bekommt nie ungefragt einen Apple-Endpunkt zurück (dessen `url` ist
 *  kein HTTP-Ziel; alte Vendor-Kopien würden sonst ins Leere feuern, Spec § Baustein 2). */
export interface ListFilter { capability?: Capability; transports?: EndpointTransport[] }
export interface LlmEndpointManagerApi {
  version: 1;
  list(filter?: ListFilter): ApiEndpoint[];
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
  backendOf?: (cfg: EndpointConfig) => Promise<BackendId | null>;
}
export interface EndpointSourceResult {
  kind: SourceKind;
  config: EndpointConfig | null;
  /** Modell für den Aufruf: choice.model → defaultModel → localModel → "". */
  model: string;
  reason?: ApiErrorCode;
  family: FamilyId | null;
  familySource: "manager" | "name" | "none";
  /** Anzeige-Familie: Manager `displayFamily` > Manager `family` (gespiegelt) > Namensrater > fehlt. */
  displayFamily?: ModelFamilyId;
  backend: BackendId;
  backendSource: "manager" | "probe" | "none";
  sentModel: string;
  defaultModel?: string;
  /** Nur vom Manager-Pfad gesetzt (lokale Endpunkte kennen nur `"http"`); additiv, Opt-in. */
  transport?: EndpointTransport;
  shortcut?: ShortcutTransportConfig;
}

/** Familie und gesendete Schreibweise eines Modells. `aliasOf` wird genau EINMAL aufgelöst —
 *  eine Kette oder ein Kreis in der Manager-Tabelle darf keine Schleife erzeugen.
 *  `displayFamily` (Anzeige, nur gesetzt wenn bekannt): Manager `displayFamily` > `family`
 *  (Manager oder Namensrater, gespiegelt) > fehlt. */
export function describeModel(model: string, models: ApiModelInfo[] | undefined): {
  family: FamilyId | null; familySource: "manager" | "name" | "none"; sentModel: string; displayFamily?: ModelFamilyId;
} {
  const row = models?.find((m) => m.id === model);
  const sentModel = row?.aliasOf?.trim() || model;
  const target = sentModel === model ? row : models?.find((m) => m.id === sentModel);
  const managerDisplay = target?.displayFamily ?? row?.displayFamily;
  const managerFamily = target?.family ?? row?.family;
  let family: FamilyId | null;
  let familySource: "manager" | "name" | "none";
  if (managerFamily) { family = managerFamily; familySource = "manager"; }
  else {
    const guess = familyFromName(sentModel) ?? familyFromName(model);
    family = guess ?? null; familySource = guess ? "name" : "none";
  }
  const displayFamily = managerDisplay ?? family ?? undefined;
  return { family, familySource, sentModel, ...(displayFamily ? { displayFamily } : {}) };
}

function modelOf(choice: EndpointChoice | undefined, fallback: string | undefined): string {
  return choice?.model?.trim() || fallback?.trim() || "";
}

/** Modell-Priorität für den lokalen Pfad: choice.model (explizite Nutzerwahl) → config.model
 *  (Zeilen-Modell, dieselbe Vorrangregel wie `effectiveModel` in `endpoint_config.ts`) →
 *  localModel (globaler Fallback) → "". */
function localModelOf(choice: EndpointChoice | undefined, config: EndpointConfig | null, localModel: string | undefined): string {
  return choice?.model?.trim() || config?.model?.trim() || localModel?.trim() || "";
}

async function finish(
  base: { kind: SourceKind; config: EndpointConfig | null; model: string; reason?: ApiErrorCode },
  input: EndpointSourceInput,
  manager: { backend?: BackendId; models?: ApiModelInfo[]; defaultModel?: string; transport?: EndpointTransport; shortcut?: ShortcutTransportConfig } | null,
): Promise<EndpointSourceResult> {
  const d = describeModel(base.model, manager?.models);
  let backend: BackendId = "unknown";
  let backendSource: EndpointSourceResult["backendSource"] = "none";
  if (manager?.backend) { backend = manager.backend; backendSource = "manager"; }
  // Ein Shortcuts-Endpunkt trägt eine Sentinel-URL (`apple-shortcuts://on-device`), kein HTTP-Ziel —
  // eine Probe darauf ist sinnlos, `backend` bleibt `unknown`/`none`.
  else if (base.config && input.backendOf && manager?.transport !== "shortcuts") {
    try { const b = await input.backendOf(base.config); if (b) { backend = b; backendSource = "probe"; } } catch { /* bleibt unknown */ }
  }
  const out: EndpointSourceResult = { ...base, ...d, backend, backendSource };
  // Das Standardmodell in DERSELBEN Schreibweise wie sentModel — sonst meldet der Abschnitt
  // „Anfrage" eine JIT-Abweichung, wo nur der Alias greift.
  if (manager?.defaultModel) out.defaultModel = describeModel(manager.defaultModel, manager.models).sentModel;
  if (manager?.transport) out.transport = manager.transport;
  if (manager?.shortcut) out.shortcut = manager.shortcut;
  return out;
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
    return finish({ kind: "local", config, model: config ? localModelOf(input.choice, config, input.localModel) : "" }, input, null);
  }
  const opts = input.caller ? { caller: input.caller } : undefined;
  try {
    let reason: ApiErrorCode | undefined;
    const wanted = input.choice?.endpointId;
    if (wanted) {
      const m = await manager.materialize(wanted, opts);
      if (!("error" in m)) {
        return finish({ kind: "manager", config: m.config, model: modelOf(input.choice, m.defaultModel) }, input, m);
      }
      reason = m.error;   // verwaiste Wahl → automatisch weiter, Grund mitteilen
    }
    const r = await manager.resolve(input.capability, opts);
    if ("error" in r) return finish({ kind: "manager", config: null, model: "", reason: r.error }, input, null);
    const base = { kind: "manager" as const, config: r.config, model: modelOf(input.choice, r.defaultModel), ...(reason ? { reason } : {}) };
    return finish(base, input, r);
  } catch {
    return finish({ kind: "manager", config: null, model: "", reason: "unreachable" }, input, null);
  }
}
