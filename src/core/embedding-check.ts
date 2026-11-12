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
 *  Preset setzte `embedding` neben ein Chat-Modell, und `resolve("embedding")` gab es ohne Frage aus). Nur ein ausdrückliches `chat`
 *  zählt; alles Ungewisse bleibt, wie es ist. Fragt nur, wo eine Antwort möglich ist. Ändert die Eingabe nicht. */
export async function dropEmbeddingOnChatModels(
  endpoints: readonly ManagedEndpoint[],
  kindOf: (ep: ManagedEndpoint) => Promise<ModelKind>,
): Promise<{ endpoints: ManagedEndpoint[]; dropped: string[] }> {
  // Parallel: ein schlafender Server mit drei Zeitüberschreitungen soll die anderen Zeilen nicht aufhalten.
  const kinds = await Promise.all(endpoints.map((ep) => (ep.capabilities.includes("embedding") && modelKindAskable(ep)
    ? kindOf(ep).catch((): ModelKind => "unknown")
    : Promise.resolve<ModelKind>("unknown"))));
  const dropped: string[] = [];
  const out = endpoints.map((ep, i) => {
    if (embeddingVerdict(ep, kinds[i]) !== "mismatch") return ep;
    dropped.push(ep.label);
    return { ...ep, capabilities: ep.capabilities.filter((c) => c !== "embedding") };
  });
  return { endpoints: out, dropped };
}
