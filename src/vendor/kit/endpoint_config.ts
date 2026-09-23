// vendored from code-kit@0.7.0, src/ts/pure/endpoint_config.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
/** Obsidian-freie Wahrheit für Endpunkt-Einträge: Struktur, Auth-Header, Modellwahl,
 *  Migration alter String-Listen und Listen-Bearbeitung.
 *
 *  Herkunft: vault-rag/src/endpoint_config.ts (0.20.0). Bewusst NICHT mitgewandert:
 *  `chatRequestModel` (hängt an vault-rags smartApplyModel) und `describeEndpointRole`
 *  (liefert deutschen Text — jeder Consumer rendert die Rolle in seiner Sprache). */

import { normalizeEndpoint } from "./endpoint";

export interface EndpointConfig {
  url: string;
  /** Leer/fehlend = kein Authorization-Header (lokaler Server). */
  apiKey?: string;
  /** Leer/fehlend = das globale Modell gilt. */
  model?: string;
}

/** Auth-Header für einen Endpunkt — die EINZIGE Stelle, an der ein Bearer aus einem
 *  Endpunkt-/Anbieter-Schlüssel gebaut wird. */
export function authHeaders(apiKey?: string): Record<string, string> {
  const k = apiKey?.trim();
  return k ? { Authorization: `Bearer ${k}` } : {};
}

/** Modell-Override des Endpunkts, sonst das globale Modell.
 *
 *  @deprecated Migrationskrücke, terminiert. Ein Modellname existiert nur auf dem Endpunkt, der
 *  ihn in `/v1/models` meldet — auf der Nachbarzeile ist er bedeutungslos. „Globales Modell +
 *  Override je Zeile" ist damit dieselbe Information an zwei Orten plus Vorrangregel, und der
 *  Leerwert wird still bedeutungstragend („leer heißt: nimm das globale"). Das Kit hat die
 *  Struktur nicht erfunden, sondern von seinen ersten Konsumenten geerbt — und gab sie seither an
 *  jeden neuen weiter, auch an die, die nie ein globales Feld hatten.
 *
 *  **Statt dessen:** das Modell gehört in die Zeile (`cfg.model`), und die Modell-Liste kommt
 *  ohnehin je Endpunkt (`model-list-cache`). Ein Konsument ohne globales Feld lässt in
 *  `obsidian-kit`s `EndpointListOptions` seit 0.29.0 einfach den `globalModel`-Callback weg.
 *
 *  Entfernt wird die Funktion erst, wenn die fünf Konsumenten mit globalem Feld migriert sind
 *  (obsidian-transmute, markdown-presentation, image-to-markdown, kuro-gamification, vim-dojo) —
 *  die Reihenfolge ist bindend, denn solange sie im Vertrag steht, erbt sie jeder Neue. */
export function effectiveModel(cfg: EndpointConfig, globalModel: string): string {
  const m = cfg.model?.trim();
  return m ? m : globalModel;
}

/** Verlässlicher Indikator für "geht an einen Drittanbieter": der Schlüssel, NICHT die URL —
 *  eine URL-Heuristik wäre unzuverlässig (ein eigener Server im LAN/VPN braucht ebenfalls
 *  keinen Schlüssel, ist aber kein Drittanbieter, und umgekehrt). */
export function carriesApiKey(cfg: EndpointConfig): boolean {
  return !!cfg.apiKey?.trim();
}

/** Ein Listen-Eintrag (alt: blanke URL, neu: Config) → normalisierte Config.
 *  null = unbrauchbar (leere URL) und fliegt aus der Liste. */
function toConfig(entry: string | EndpointConfig): EndpointConfig | null {
  if (typeof entry === "string") {
    const url = entry.trim();
    return url ? { url } : null;
  }
  const url = entry?.url?.trim();
  if (!url) return null;
  const key = entry.apiKey?.trim();
  const model = entry.model?.trim();
  return { url, ...(key ? { apiKey: key } : {}), ...(model ? { model } : {}) };
}

/** Migriert alte Einzel-/String-Listen-Settings auf EndpointConfig[]. Reiner Helfer. */
export function migrateEndpointList(
  single: string | undefined,
  list: (string | EndpointConfig)[] | undefined,
): EndpointConfig[] {
  if (list && list.length) {
    const out = list.map(toConfig).filter((c): c is EndpointConfig => c !== null);
    if (out.length) return out;
  }
  const s = single?.trim();
  return s ? [{ url: s }] : [];
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
