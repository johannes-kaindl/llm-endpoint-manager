import type { ModelKind } from "../vendor/kit/capabilities";
import type { ManagedEndpoint } from "./model";

/** Urteil über `embedding` an einer Zeile. `mismatch`: der Server sagt, das Standardmodell ist ein Chat-Modell (eine Anfrage nach
 *  Embeddings landet dort und scheitert). `unverified`: nichts gesagt (kein Modell, kein Server, Server kennt das Modell nicht) —
 *  gelb, nie rot: „unbekannt" ist keine Aussage über das Modell. `none`: kein Urteil möglich oder nötig. */
export type EmbeddingVerdict = "none" | "ok" | "mismatch" | "unverified";

/** Nur `openai` (LM Studio, OpenAI-kompatibel) und `ollama` kennen einen Modelltyp, und gefragt wird nach dem Standardmodell der Zeile. */
export function modelKindAskable(ep: Pick<ManagedEndpoint, "provider" | "model">): boolean {
  return (ep.provider === "openai" || ep.provider === "ollama") && (ep.model ?? "").trim() !== "";
}

/** Urteil für eine Zeile aus dem Modelltyp, den der Server nennt (`kind`; `undefined`/`unknown` = nicht gesagt). */
export function embeddingVerdict(ep: Pick<ManagedEndpoint, "capabilities" | "provider" | "model">, kind: ModelKind | undefined): EmbeddingVerdict {
  if (!ep.capabilities.includes("embedding")) return "none";
  if (ep.provider !== "openai" && ep.provider !== "ollama") return "none";
  if (!modelKindAskable(ep)) return "unverified";
  if (kind === "chat") return "mismatch";
  if (kind === "embedding") return "ok";
  return "unverified";
}

/** Bestand beim Laden: nimmt `embedding` von jeder Zeile, deren Modell der Server als Chat-Modell nennt (Welle 33: das LM-Studio-
 *  Preset setzte `embedding` neben ein Chat-Modell, und `resolve("embedding")` gab es ohne Frage aus). Gilt nur für `openai`-Zeilen:
 *  LM Studio nennt den Typ ausdrücklich, bei Ollama ist „Chat" nur aus der fehlenden Fähigkeit `embedding` in `/api/show` geschlossen,
 *  und Ollama bettet mit den meisten Chat-Modellen ein — dort nimmt nichts etwas weg (der Editor-Hinweis genügt). Nur ein ausdrückliches
 *  `chat` zählt; alles Ungewisse bleibt. `complete`: jede gefragte Zeile hat eine Antwort bekommen (dann darf die Bereinigung als
 *  erledigt markiert werden; ein stummer Server heißt „noch nicht gelaufen"). Ändert die Eingabe nicht. */
export async function dropEmbeddingOnChatModels(
  endpoints: readonly ManagedEndpoint[],
  kindOf: (ep: ManagedEndpoint) => Promise<ModelKind>,
): Promise<{ endpoints: ManagedEndpoint[]; dropped: string[]; complete: boolean }> {
  const considered = (ep: ManagedEndpoint): boolean => ep.provider === "openai" && ep.capabilities.includes("embedding") && modelKindAskable(ep);
  // Parallel: ein schlafender Server mit Zeitüberschreitungen soll die anderen Zeilen nicht aufhalten.
  const kinds = await Promise.all(endpoints.map((ep) => (considered(ep) ? kindOf(ep).catch((): ModelKind => "unknown") : Promise.resolve<ModelKind>("unknown"))));
  const dropped: string[] = [];
  const out = endpoints.map((ep, i) => {
    if (!considered(ep) || kinds[i] !== "chat") return ep;
    dropped.push(ep.label);
    return { ...ep, capabilities: ep.capabilities.filter((c) => c !== "embedding") };
  });
  const complete = endpoints.every((ep, i) => !considered(ep) || kinds[i] !== "unknown");
  return { endpoints: out, dropped, complete };
}
