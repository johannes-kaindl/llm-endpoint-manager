// vendored from obsidian-kit@0.89.0, src/pure/endpoint-source.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
import { hydrateEndpointSecrets, resolveActiveEndpointConfig, type EndpointConfig } from "./endpoint_config";
import type { SecretStore } from "./secrets";
import { familyFromName, type BackendId, type FamilyId, type ModelFamilyId } from "./sampling-profiles";

/** Öffentlicher Vertrag des Plugins `llm-endpoint-manager` (dessen `src/core/api-types.ts` ist
 *  seit Plan 3 ein Re-Export dieser Datei — EINE Quelle). Fehler sind Werte, Methoden fangen
 *  selbst; Konsumenten lesen die API bei JEDEM Aufruf frisch (`findEndpointManager`). */
export const LLM_ENDPOINT_MANAGER_API_VERSION = 1;
export const LLM_ENDPOINT_MANAGER_PLUGIN_ID = "llm-endpoint-manager";

export type Provider = "openai" | "ollama" | "a1111" | "comfy" | "apple-shortcuts" | "anthropic";
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
export type EndpointTransport = "http" | "shortcuts" | "anthropic";
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
  resolve(capability: Capability, opts?: { caller?: string; transports?: EndpointTransport[] }): Promise<ResolvedEndpoint | ApiError>;
  materialize(id: string, opts?: { caller?: string; transports?: EndpointTransport[] }): Promise<ResolvedEndpoint | ApiError>;
  models(id: string, opts?: { force?: boolean }): Promise<string[] | ApiError>;
  /** Additiv in API v1 (llm-endpoint-manager seit b9849b2, `version` bleibt 1) und **optional**: wie `models()`, aber mit Erreichbarkeit. `models: []` mit `reachable: true` heißt „antwortet, gibt aber keine Liste
   *  heraus“, mit `reachable: false` „nicht erreichbar“ (`models()` kann beides nicht trennen). Ein Manager ohne diese Methode besteht `isLlmEndpointManagerApi` weiter (`METHODS` kennt sie nicht); ein Konsument
   *  prüft `typeof api.modelList === "function"` und fällt sonst auf `models()` zurück (`managerModelList` in `obsidian/endpoint-plumbing`). */
  modelList?(id: string, opts?: { force?: boolean }): Promise<{ models: string[]; reachable: boolean } | ApiError>;
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

/** Liest eine gespeicherte Endpunkt-Wahl aus `data.json`: nur nicht-leere Strings in `endpointId` und `model` bleiben, alles andere
 *  fällt weg. `raw` ist untrusted — die Datei ist von Hand editierbar, und ein unbekanntes Feld (ein Schlüssel, eine URL) soll nie
 *  zurück in die Datei wandern. Kein Objekt (`null`, `undefined`, String, Zahl) ergibt `{}`; ein Array hat keine dieser Felder, also
 *  ebenfalls `{}`. Das Ergebnis ist ein neues Objekt, `raw` bleibt unverändert, ein fehlendes Feld steht nicht als `undefined` darin.
 *
 *  Getrimmt wird nicht: `" "` ist nicht leer und bleibt (so taten es alle Träger). Gelesen werden nur die zwei benannten Felder, nie
 *  geerbte (`__proto__` aus einem geparsten JSON zählt nicht).
 *
 *  Fünf Plugins schrieben dasselbe (Welle 19, Erhebung a4): vault-crews `src/obsidian/settings.ts:51`, slide-deck `src/settings.ts:53`,
 *  json-editor `src/core/repair/settings.ts:24`, neurovim-obsidian `src/settings.ts:64`, image-to-markdown `src/resolve_endpoint.ts:8`;
 *  die Unterschiede (`!== ""` gegen Wahrheitswert, `c.endpointId`) waren Schreibweise ohne Folge für einen String. ghostline
 *  (`src/core/settings.ts:47`) schreibt dieselbe Regel inline in ein bestehendes Objekt und ist kein Tausch ohne Umbau. */
export function sanitizeChoice(raw: unknown): EndpointChoice {
  if (raw === null || typeof raw !== "object") return {};
  const { endpointId, model } = raw as Record<string, unknown>;
  return {
    ...(typeof endpointId === "string" && endpointId !== "" ? { endpointId } : {}),
    ...(typeof model === "string" && model !== "" ? { model } : {}),
  };
}
export type SourceKind = "manager" | "local";
export interface EndpointSourceInput {
  manager?: LlmEndpointManagerApi | null;
  local: EndpointConfig[];
  /** Schlüsselbund der LOKALEN Liste: ist er gesetzt, trägt die aufgelöste Config den Schlüssel
   *  als `apiKey` (hydriert aus `secretId`), damit `authHeaders` ihn sieht. Nur der lokale Pfad;
   *  der Manager hat seinen eigenen Schlüsselbund. Obsidian-Konsumenten rufen dafür
   *  `prepareLocalEndpoints` (migriert und hydriert) und lassen dieses Feld leer. */
  secrets?: Pick<SecretStore, "get"> | null;
  /** Namensraum der Schlüssel in `secrets` (z. B. `<pluginId>-ep`), Pflicht zusammen mit `secrets`:
   *  gelesen wird nur eine `secretId` im Raum `<secretPrefix>-` (code-kit 0.15.0). Fehlt er, wird nicht
   *  hydriert — die Config trägt dann keinen Schlüssel, es wird aber auch nie ein fremder gelesen. */
  secretPrefix?: string;
  capability: Capability;
  choice?: EndpointChoice;
  caller?: string;
  /** Opt-in für `resolve()` wie `list()`: ohne Angabe nur `"http"` (ein älterer Manager ignoriert das Feld). Wer `"anthropic"`
   *  oder `"shortcuts"` anfordert, muss den passenden Transport bereitstellen (`llm-connection` `transports`). */
  transports?: EndpointTransport[];
  /** Seit 0.73.0: die Transporte nur für den AUTOMATISCHEN Weg (`manager.resolve`). Fehlt die Angabe, gilt `transports` auch dort. Eine
   *  ausdrückliche Wahl (`materialize`) und die wählbare Liste bleiben bei `transports`: so kennt „Automatisch“ einen Endpunkt nicht,
   *  den der Nutzer nur ausdrücklich wählen kann (`llm-connection` `transports.anthropic: "explicit"`). */
  autoTransports?: EndpointTransport[];
  backendOf?: (cfg: EndpointConfig) => Promise<BackendId | null>;
}
export interface EndpointSourceResult {
  kind: SourceKind;
  config: EndpointConfig | null;
  /** Modell für den Aufruf: choice.model → defaultModel → "" (lokal: choice.model → Modell der Zeile → ""). */
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
  /** Modell-Tabelle des Managers (nur Manager-Pfad), damit ein Aufruf mit anderem Modell dessen Familie und Alias kennt. */
  models?: ApiModelInfo[];
  /** Die `id` des `ResolvedEndpoint`, das der Manager geliefert hat (`resolve` wie `materialize`): der Endpunkt, der diese Quelle trägt. Gesetzt genau dann, wenn `kind === "manager"`, ein `config` aufgelöst wurde
   *  und die `id` ein nicht-leerer String ist (Formprüfung statt Vertrauen: ein Fremdplugin liefert vielleicht keine). Lokal, ohne `config` und ohne brauchbare `id` fehlt es: unbekannt bleibt unbekannt, nie geraten
   *  (Welle 34, Paket 9; vorher erriet jede Verbindung den Endpunkt aus `list()` und band bei einem unerreichbaren ersten Eintrag den falschen). */
  endpointId?: string;
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
 *  (das Modell der Zeile; es gibt keinen globalen Rückfall mehr, `localModel` entfiel in 0.55.0) → "". */
function localModelOf(choice: EndpointChoice | undefined, config: EndpointConfig | null): string {
  return choice?.model?.trim() || config?.model?.trim() || "";
}

async function finish(
  base: { kind: SourceKind; config: EndpointConfig | null; model: string; reason?: ApiErrorCode },
  input: EndpointSourceInput,
  manager: { id?: unknown; backend?: BackendId; models?: ApiModelInfo[]; defaultModel?: string; transport?: EndpointTransport; shortcut?: ShortcutTransportConfig } | null,
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
  if (manager?.models) out.models = manager.models;
  if (manager?.transport) out.transport = manager.transport;
  if (manager?.shortcut) out.shortcut = manager.shortcut;
  if (base.kind === "manager" && base.config && typeof manager?.id === "string" && manager.id !== "") out.endpointId = manager.id;
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
    const config = await resolveActiveEndpointConfig(input.secrets && input.secretPrefix ? hydrateEndpointSecrets(input.local, input.secrets, input.secretPrefix) : input.local, ping);
    return finish({ kind: "local", config, model: config ? localModelOf(input.choice, config) : "" }, input, null);
  }
  const optsFor = (transports: EndpointTransport[] | undefined) => input.caller || transports
    ? { ...(input.caller ? { caller: input.caller } : {}), ...(transports ? { transports } : {}) } : undefined;
  const opts = optsFor(input.transports);
  const autoOpts = optsFor(input.autoTransports ?? input.transports);
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
    const r = await manager.resolve(input.capability, autoOpts);
    if ("error" in r) {
      // Der Manager-`resolve` kennt nur `no-endpoint` (er überspringt abgeschaltete und schlüssellose Endpunkte still).
      // Hat der Nutzer einen Endpunkt ausdrücklich gewählt und DER scheiterte an etwas, das er abstellen kann, ist das
      // der Grund, den er braucht — „kein Endpunkt“ schickte ihn an die falsche Stelle (Welle 22). `not-found` bleibt
      // überschrieben: eine verwaiste Wahl ist nur weg, daran ist nichts zu beheben.
      const fixable = reason === "disabled" || reason === "secret-missing" ? reason : undefined;
      return finish({ kind: "manager", config: null, model: "", reason: fixable ?? r.error }, input, null);
    }
    // Verwaiste Wahl (`reason` gesetzt): `choice.model` gehörte zum gewählten, nicht erreichbaren Endpunkt. An den automatischen geschickt wäre es ein
    // fremder Modellname an einen fremden Endpunkt (0.87.0, Spec § 4.9); es gilt dessen Standard-Modell. Die gespeicherte Wahl bleibt unberührt:
    // wird der Endpunkt wieder eingeschaltet, gilt sie wieder. Eine Alt-Wahl `{ model }` ohne `endpointId` hat keinen `reason` und behält ihr Modell.
    const base = { kind: "manager" as const, config: r.config, model: reason ? modelOf(undefined, r.defaultModel) : modelOf(input.choice, r.defaultModel), ...(reason ? { reason } : {}) };
    return finish(base, input, r);
  } catch {
    return finish({ kind: "manager", config: null, model: "", reason: "unreachable" }, input, null);
  }
}
