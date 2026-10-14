// vendored from code-kit@0.27.1, src/ts/pure/endpoint_config.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
/** Obsidian-freie Wahrheit für Endpunkt-Einträge: Struktur, Auth-Header, Modellwahl,
 *  Migration alter String-Listen und Listen-Bearbeitung.
 *
 *  Herkunft: vault-rag/src/endpoint_config.ts (0.20.0). Bewusst NICHT mitgewandert:
 *  `chatRequestModel` (hängt an vault-rags smartApplyModel) und `describeEndpointRole`
 *  (liefert deutschen Text — jeder Consumer rendert die Rolle in seiner Sprache). */

import { normalizeEndpoint } from "./endpoint";
import { secretIdFor } from "./secrets";

export interface EndpointConfig {
  url: string;
  /** Leer/fehlend = kein Authorization-Header (lokaler Server).
   *  Mit Schlüsselbund ist das ein reines In-Memory-Feld: `hydrateEndpointSecrets` füllt es zur
   *  Laufzeit, persistiert wird `secretId`. */
  apiKey?: string;
  /** Stabile Zeilen-Identität, einmal vergeben (`ensureEndpointIds`). Weder Index (wandert beim
   *  Umsortieren) noch URL (kommt doppelt vor, mit verschiedenen Schlüsseln). */
  id?: string;
  /** Name des Schlüssels im Schlüsselbund; wird statt `apiKey` persistiert. */
  secretId?: string;
  /** The model of this row (`rowModel`). Empty/missing = no model chosen; there is no global
   *  fallback (removed in 0.16.0, formerly `effectiveModel`). */
  model?: string;
}

/** The model of a row, trimmed; `""` = nothing chosen yet. The ONLY source for the model of an
 *  endpoint: a model name exists only on the endpoint that reports it in `/v1/models`, so a second,
 *  global field would be the same fact in two places plus a precedence rule. Successor of
 *  `effectiveModel` (removed in 0.16.0), without the global fallback. Consequence for a consumer:
 *  a new row inherits no model, and a selection that offered "empty = default" loses that option.
 *
 *  Origin: vault-rag/src/endpoint_config.ts (`rowModel`). */
export function rowModel(cfg: EndpointConfig): string {
  return cfg.model?.trim() ?? "";
}

/** Migration from the global model field to the row: every row WITHOUT a model
 *  (`rowModel(e) === ""`) gets `legacyModel` (trimmed), rows with a model stay as they are. Pure:
 *  ALWAYS returns copies (never the input rows) and mutates nothing. A legacy value that is not a
 *  string, or empty after trimming, changes nothing — it comes from `data.json` and is untrusted.
 *
 *  Without this step existing users would be left with endpoints without a model after the update,
 *  and that fails SILENTLY (an empty model name in the request).
 *
 *  ── The protocol around it belongs to the caller, and that is the part that goes wrong ────
 *  1. **Order on load:** merge the settings → migrate the rows (`migrateEndpointList`) → insert the
 *     default rows if the list is empty → ONLY THEN `fillMissingRowModels` (otherwise an empty
 *     `data.json` overwrites the default row, which already carries its model) → remove the legacy
 *     key → save once if it was there (vault-rag `main.ts`).
 *  2. **The legacy key must disappear from the merged object, or the migration runs again on EVERY
 *     start** and silently refills a row the user cleared on purpose (vault-rag, measured
 *     2026-09-07). The merge carries it along: `{ ...DEFAULTS, ...raw }` and `Object.assign` have no
 *     schema boundary (kuro `DataStore.ts` `...rest`, settings-assistant `core/settings.ts`
 *     `...merged`). A `delete` on load is enough; the keys are plugin-specific (`embeddingModel` /
 *     `chatModel`, `localModel`), a generic helper would only know a list of names and so does not
 *     belong here.
 *  3. **Test the second run:** fill a row, clear it, load again — it has to stay empty. A test of the
 *     first run alone is green with the bug in.
 *
 *  Origin: vault-rag/src/settings_core.ts (`migrateGlobalModels`, 0.31.0). */
export function fillMissingRowModels(eps: readonly EndpointConfig[], legacyModel: unknown): EndpointConfig[] {
  const legacy = typeof legacyModel === "string" ? legacyModel.trim() : "";
  return eps.map((e) => (legacy && !rowModel(e) ? { ...e, model: legacy } : { ...e }));
}

/** Auth-Header für einen Endpunkt — die EINZIGE Stelle, an der ein Bearer aus einem
 *  Endpunkt-/Anbieter-Schlüssel gebaut wird. */
export function authHeaders(apiKey?: string): Record<string, string> {
  const k = apiKey?.trim();
  return k ? { Authorization: `Bearer ${k}` } : {};
}

/** Verlässlicher Indikator für "geht an einen Drittanbieter": der Schlüssel, NICHT die URL —
 *  eine URL-Heuristik wäre unzuverlässig (ein eigener Server im LAN/VPN braucht ebenfalls
 *  keinen Schlüssel, ist aber kein Drittanbieter, und umgekehrt). */
export function carriesApiKey(cfg: EndpointConfig): boolean {
  return !!cfg.apiKey?.trim();
}

const OPTIONAL_STRING_FIELDS = ["apiKey", "model", "id", "secretId"] as const;

/** Ein Listen-Eintrag (alt: blanke URL, neu: Config) → normalisierte Config.
 *  `null` = leere URL, fliegt still aus der Liste (kein Datenverlust). `"invalid"` = der Eintrag
 *  ist kein Text und kein Objekt oder trägt in `url`/`apiKey`/`model`/`id`/`secretId` einen
 *  Nicht-String; er fliegt ebenfalls raus, wird aber GEZÄHLT (siehe `migrateEndpointListChecked`).
 *  Wirft nie. */
function toConfig(entry: unknown): EndpointConfig | null | "invalid" {
  if (typeof entry === "string") {
    const url = entry.trim();
    return url ? { url } : null;
  }
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return "invalid";
  const e = entry as Record<string, unknown>;
  if (e.url !== undefined && e.url !== null && typeof e.url !== "string") return "invalid";
  for (const f of OPTIONAL_STRING_FIELDS) {
    const v = e[f];
    if (v !== undefined && v !== null && typeof v !== "string") return "invalid";
  }
  const url = e.url?.trim();
  if (!url) return null;
  const key = (e.apiKey as string | null | undefined)?.trim();
  const model = (e.model as string | null | undefined)?.trim();
  return {
    url,
    ...(key ? { apiKey: key } : {}),
    ...(model ? { model } : {}),
    ...(e.id ? { id: e.id as string } : {}),
    ...(e.secretId ? { secretId: e.secretId as string } : {}),
  };
}

/** Das Stück des Schlüsselbunds, das die Helfer brauchen. Strukturell kompatibel zu
 *  `SecretStore` aus obsidian-kit (`get`/`set`), damit code-kit kein Schlüsselbund-Modul braucht. */
export interface EndpointSecretStore {
  get(id: string): string | null;
  set(id: string, value: string): void;
}

/** Zufallskennung ohne Hostzugriff (die pure Schicht kennt weder `crypto` noch `window`). Die
 *  Standard-Id ist nur für Tests und Aufrufer ohne Browser gedacht: obsidian-kit übergibt
 *  `crypto.randomUUID` als `newId`. Die Id ist eine Zeilen-Identität, kein Geheimnis. */
function randomId(): string {
  return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);
}

/** Vergibt jedem Eintrag ohne (oder mit doppelter) `id` eine Zufallskennung. Neue Liste, die
 *  Eingabe bleibt unberührt. `newId` ist für Tests injizierbar. */
export function ensureEndpointIds(list: EndpointConfig[], newId: () => string = randomId): EndpointConfig[] {
  const seen = new Set<string>();
  return list.map((e) => {
    let id = e.id;
    if (!id || seen.has(id)) {
      id = newId();
      while (seen.has(id)) id = newId();
    }
    seen.add(id);
    return id === e.id ? { ...e } : { ...e, id };
  });
}

/** Namensraum eines Plugins im Schlüsselbund: der NORMALISIERTE Präfix plus `-`, abgeleitet aus
 *  `secretIdFor` (ein Rohvergleich mit dem Präfix verwürfe im zweiten Lauf die selbst erzeugten
 *  Ids, z. B. bei `My_Plugin`). Der Bindestrich gehört dazu: Präfix `p` deckt `pq-1` nicht.
 *  Grenze: Präfix `a` deckt `a-b-…` mit, also auch Ids eines Plugins `a-b` — Präfixe so wählen,
 *  dass keiner ein `-`-Anfang eines anderen ist. Ein leerer normalisierter Präfix wirft, weil
 *  ein leerer Namensraum alles durchließe. */
function secretNamespace(prefix: string): string {
  const ns = secretIdFor(prefix, "x").slice(0, -2);
  if (!ns) throw new Error("endpoint secrets: Präfix ist leer — ohne Namensraum gäbe es keinen Schutz");
  return ns;
}

/** Verschiebt Klartext-`apiKey`s in den Schlüsselbund: je Eintrag mit Schlüssel eine `id` (falls
 *  nötig), `secretId` (falls nötig), `store.set`, dann `apiKey` entfernen. Neue Liste, Eingabe
 *  unberührt; `changed` sagt, ob sich etwas bewegt hat (dann muss der Aufrufer speichern).
 *
 *  **Ein Schlüssel wird nie verworfen, den man nicht gespeichert hat:** ohne Store, bei einem
 *  werfenden `set` und wenn `get` den Wert danach nicht zurückgibt, bleibt der Klartext stehen.
 *  Idempotent — ein zweiter Lauf findet keinen Klartext mehr.
 *
 *  **Namensraum:** `prefix` ist Pflicht. Eine `secretId` außerhalb von `<prefix>-` wird weder
 *  gelesen noch geschrieben, sondern ignoriert; die eigene wird aus `prefix` und `id` erzeugt
 *  und der Klartext dorthin verschoben. Grund: eine präparierte `secretId` in einem gesyncten
 *  `data.json` ließe sonst das Geheimnis eines anderen Plugins als Bearer an eine fremde URL
 *  gehen. */
export function migrateEndpointSecrets(
  list: EndpointConfig[],
  store: EndpointSecretStore | null | undefined,
  prefix: string,
  newId: () => string = randomId,
): { list: EndpointConfig[]; changed: boolean } {
  const ns = `${secretNamespace(prefix)}-`;
  if (!store) return { list, changed: false };
  const used = new Set(list.map((e) => e.id).filter((i): i is string => !!i));
  let changed = false;
  const out = list.map((e) => {
    const key = e.apiKey?.trim();
    if (!key) return e;
    let id = e.id;
    if (!id) {
      id = newId();
      while (used.has(id)) id = newId();
      used.add(id);
    }
    const secretId = e.secretId?.startsWith(ns) ? e.secretId : secretIdFor(prefix, id);
    // An id that normalises to nothing (" ", "-", "ä") makes secretIdFor return the bare prefix,
    // which lies outside `<prefix>-` and which hydrate would never read back: keep the plaintext.
    if (!secretId.startsWith(ns)) return e;
    try {
      store.set(secretId, key);
      if (!store.get(secretId)) return e;
    } catch {
      return e;
    }
    changed = true;
    const { apiKey: _drop, ...rest } = e;
    return { ...rest, id, secretId };
  });
  return { list: changed ? out : list, changed };
}

/** Kopien der Liste mit `apiKey` aus dem Schlüsselbund (für `authHeaders` und alle, die den
 *  Schlüssel brauchen). Das Original bleibt ohne Schlüssel — es wird gespeichert. Fehlt der
 *  Store-Wert oder der Store, bleibt der Eintrag, wie er ist. Eine `secretId` außerhalb von
 *  `<prefix>-` wird nicht gelesen (Eintrag bleibt unverändert, kein Wurf) — Begründung bei
 *  `migrateEndpointSecrets`. */
export function hydrateEndpointSecrets(
  list: EndpointConfig[],
  store: Pick<EndpointSecretStore, "get"> | null | undefined,
  prefix: string,
): EndpointConfig[] {
  const ns = `${secretNamespace(prefix)}-`;
  return list.map((e) => {
    const v = store && e.secretId?.startsWith(ns) ? store.get(e.secretId) : null;
    return v ? { ...e, apiKey: v } : { ...e };
  });
}

/** Migriert alte Einzel-/String-Listen-Settings auf EndpointConfig[]. Reiner Helfer. Wirft nie;
 *  verworfene Einträge meldet {@link migrateEndpointListChecked}. */
export function migrateEndpointList(
  single: string | undefined,
  list: (string | EndpointConfig)[] | undefined,
): EndpointConfig[] {
  return migrateEndpointListChecked(single, list).list;
}

/** Wie {@link migrateEndpointList}, meldet aber `dropped`: die Zahl der Einträge, die verworfen
 *  wurden, weil sie kein Text/Objekt sind oder in `url`/`apiKey`/`model`/`id`/`secretId` einen
 *  Nicht-String tragen. Leere URLs zählen nicht (das ist Aufräumen, kein Datenverlust). Ist
 *  `list` kein Array, wird sie als Ganzes verworfen (`dropped` 1) und `single` gilt. */
export function migrateEndpointListChecked(
  single: string | undefined,
  list: (string | EndpointConfig)[] | undefined,
): { list: EndpointConfig[]; dropped: number } {
  let dropped = 0;
  if (Array.isArray(list)) {
    const out: EndpointConfig[] = [];
    for (const entry of list) {
      const c = toConfig(entry);
      if (c === "invalid") dropped++;
      else if (c) out.push(c);
    }
    if (out.length) return { list: out, dropped };
  } else if (list !== undefined && list !== null) {
    dropped = 1;
  }
  const s = typeof single === "string" ? single.trim() : "";
  return { list: s ? [{ url: s }] : [], dropped };
}

/** Wendet die Bearbeitung EINES Feldes an (bei blur, nicht pro Tastendruck).
 *  Leere URL entfernt den Eintrag; ein geleerter Schlüssel/Modell entfernt nur das Feld. */
export function applyEndpointEdit(
  eps: EndpointConfig[],
  index: number,
  field: "url" | "apiKey" | "model",
  value: string,
  isAdder: boolean,
): EndpointConfig[] {
  const v = value.trim();
  const next = [...eps];
  if (isAdder) {
    if (field === "url" && v) next.push({ url: v });
    return next;
  }
  const cur = next[index];
  if (!cur) return next;
  if (field === "url") {
    if (!v) { next.splice(index, 1); return next; }
    next[index] = { ...cur, url: v };
    return next;
  }
  const updated = { ...cur };
  if (v) updated[field] = v;
  else delete updated[field];
  next[index] = updated;
  return next;
}

/** Neue Liste mit dem Eintrag an `index` an der Spitze — die Liste IST die Priorität
 *  (der erste erreichbare gewinnt), also ist Umsortieren die einzige Wahrheit darüber,
 *  welcher Endpunkt bevorzugt wird. Index 0 oder außerhalb: unveränderte Kopie, kein
 *  Fehler — der Aufrufer muss nicht vorher prüfen. */
export function moveEndpointToFront(eps: EndpointConfig[], index: number): EndpointConfig[] {
  if (index <= 0 || index >= eps.length) return [...eps];
  const next = [...eps];
  // Erst lesen, dann splicen: unter `noUncheckedIndexedAccess` ist das Ergebnis eines
  // `splice`-Destrukturierens `EndpointConfig | undefined` und bricht den Build der
  // Consumer, die mit diesem Flag compilieren.
  const moved = next[index];
  if (!moved) return next;
  next.splice(index, 1);
  next.unshift(moved);
  return next;
}

/** Welche Rolle ein Endpunkt in der Liste gerade spielt. Reine Ableitung — kein eigener
 *  Zustand: die Einstellungs-UI kennt alle vier Zutaten bereits. */
export type EndpointRole =
  | { kind: "active" }
  | { kind: "standby"; position: number }   // 1-basiert, wie angezeigt
  | { kind: "unreachable" }
  | { kind: "skipped-model" };

/** Reihenfolge der Prüfung ist bedeutungstragend: „aktiv" schlägt alles; danach gewinnt der
 *  offensichtlichere Grund (nicht erreichbar) vor dem subtileren (Modell passt nicht).
 *  `modelFits` ist für Chat-Listen immer true — dort hängt kein Index am Modell.
 *
 *  Den ANZEIGETEXT baut der Consumer: die Rolle ist sprachfrei, damit zweisprachige
 *  Plugins sie durch ihr eigenes `t()` führen können. */
export function endpointRole(input: {
  isActive: boolean;
  reachable: boolean;
  modelFits: boolean;
  position: number;
}): EndpointRole {
  if (input.isActive) return { kind: "active" };
  if (!input.reachable) return { kind: "unreachable" };
  if (!input.modelFits) return { kind: "skipped-model" };
  return { kind: "standby", position: input.position };
}

/** Erster erreichbarer Eintrag aus einer geordneten Fallback-Liste, sonst `null`.
 *
 *  Gibt bewusst den GANZEN Eintrag zurück statt nur der URL, und reicht ihn auch dem
 *  `ping` durch: der Schlüssel muss an die Probe. Fehlt er dort, gilt ein gehosteter
 *  Endpunkt nie als erreichbar und wird stillschweigend übersprungen — das Feature wirkt
 *  tot, ohne Fehlermeldung, weil ein reiner Ping-Fehlschlag nichts meldet.
 *
 *  Die URL wird je Eintrag normalisiert (trailing `/v1` und Slashes); der zurückgegebene
 *  Eintrag trägt die normalisierte Form, damit der Aufrufer sie nicht erneut anfassen muss.
 *
 *  Macht EINEN Durchlauf. Caching, Re-Resolve und Retry bleiben beim Aufrufer — wie beim
 *  String-Pendant `resolveActiveEndpoint` in `endpoint.ts`. */
export async function resolveActiveEndpointConfig(
  eps: EndpointConfig[],
  ping: (cfg: EndpointConfig) => Promise<boolean>,
): Promise<EndpointConfig | null> {
  for (const raw of eps) {
    const url = raw?.url?.trim();
    if (!url) continue;
    const cfg: EndpointConfig = { ...raw, url: normalizeEndpoint(url) };
    if (await ping(cfg)) return cfg;
  }
  return null;
}
