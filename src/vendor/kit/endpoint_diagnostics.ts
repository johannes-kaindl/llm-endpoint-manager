// vendored from code-kit@0.6.0, src/ts/pure/endpoint_diagnostics.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
export type EndpointStatusKind =
  | "ok" | "refused" | "unknown-host" | "timeout" | "not-an-llm-api" | "unauthorized" | "unknown";

export interface EndpointStatus {
  reachable: boolean;         // true nur bei kind === "ok"
  kind: EndpointStatusKind;
  klartext: string;           // deutsche, handlungsleitende Meldung (Tooltip-Text)
  raw?: string;               // rohe Fehlermeldung, nur bei kind === "unknown"
}

/** Rohsignal einer Erreichbarkeits-Probe: erfolgreiche Response, gefangener Fehler, oder Timeout. */
export type ProbeInput =
  | { kind: "response"; status: number; body: unknown }
  | { kind: "error"; message: string }
  | { kind: "timeout" };

const KLARTEXT: Record<Exclude<EndpointStatusKind, "unknown">, string> = {
  "ok": "Verbunden",
  "refused": "Verbindung abgelehnt — Server läuft nicht oder Port falsch.",
  "unknown-host": "Hostname unbekannt — Tippfehler in der Adresse?",
  "timeout": "Zeitüberschreitung — Netz nicht erreichbar (falsches Netz / VPN aus?).",
  "not-an-llm-api": "Antwortet, ist aber kein OpenAI-kompatibler Endpunkt — falscher Pfad/Dienst?",
  "unauthorized": "Zugriff verweigert — Schlüssel fehlt oder ist ungültig.",
};

function hasModelListForm(body: unknown): boolean {
  return Array.isArray((body as { data?: unknown } | null | undefined)?.data);
}

/** Übersetzt ein Probe-Rohsignal in einen benannten Status + Klartext.
 *  Lesson (vault-crews): bei einer Response ERST die valide API-Form prüfen → "ok";
 *  die Fehler-Klassifikation läuft nur auf dem Nicht-verwertbar-Pfad, nie über eine
 *  legitime Antwort. */
export function classifyEndpointStatus(input: ProbeInput): EndpointStatus {
  if (input.kind === "timeout") {
    return { reachable: false, kind: "timeout", klartext: KLARTEXT["timeout"] };
  }
  if (input.kind === "response") {
    if (input.status === 200 && hasModelListForm(input.body)) {
      return { reachable: true, kind: "ok", klartext: KLARTEXT["ok"] };
    }
    if (input.status === 401 || input.status === 403) {
      return { reachable: false, kind: "unauthorized", klartext: KLARTEXT["unauthorized"] };
    }
    return { reachable: false, kind: "not-an-llm-api", klartext: KLARTEXT["not-an-llm-api"] };
  }
  const m = input.message;
  if (/ECONNREFUSED|ERR_CONNECTION_REFUSED/i.test(m)) {
    return { reachable: false, kind: "refused", klartext: KLARTEXT["refused"] };
  }
  if (/ENOTFOUND|ERR_NAME_NOT_RESOLVED|getaddrinfo/i.test(m)) {
    return { reachable: false, kind: "unknown-host", klartext: KLARTEXT["unknown-host"] };
  }
  if (/ETIMEDOUT|ERR_CONNECTION_TIMED_OUT|timed out/i.test(m)) {
    return { reachable: false, kind: "timeout", klartext: KLARTEXT["timeout"] };
  }
  return { reachable: false, kind: "unknown", klartext: `Nicht erreichbar — ${m}`, raw: m };
}

export interface EndpointPreset { label: string; url: string; }

/** Benannte Ein-Klick-Presets für den Endpunkt-Editor. Base-URLs ohne /v1
 *  (normalizeEndpoint strippt es ohnehin). */
export const ENDPOINT_PRESETS: EndpointPreset[] = [
  { label: "LM Studio", url: "http://localhost:1234" },
  { label: "Ollama", url: "http://localhost:11434" },
];

export interface EndpointWarning { rule: string; message: string; }

const PLACEHOLDER_IP = [/^192\.0\.2\./, /^198\.51\.100\./, /^203\.0\.113\./];

/** Nicht-blockierende Eingabe-Prüfung: gibt Hinweise, blockiert nie.
 *  Bewusst OHNE Reachability-Raten und OHNE "falsches Subnetz" (das ist der legitime
 *  LAN-Fallback-Fall). */
export function validateEndpointInput(url: string): EndpointWarning[] {
  const warnings: EndpointWarning[] = [];
  const v = url.trim();
  if (!v) return warnings;
  if (!/^https?:\/\//i.test(v)) {
    warnings.push({ rule: "scheme", message: "Adresse braucht http:// oder https://" });
    return warnings;   // ohne Schema lässt sich Host/Port nicht sinnvoll parsen
  }
  let host = "";
  let port = "";
  try {
    const u = new URL(v);
    host = u.hostname;
    port = u.port;
  } catch {
    warnings.push({ rule: "malformed", message: "Adresse ist keine gültige URL" });
    return warnings;
  }
  const isHttp = /^http:\/\//i.test(v);
  const isLocalOrIp = host === "localhost" || /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
  if (isHttp && isLocalOrIp && !port) {
    warnings.push({ rule: "port", message: "Lokale LLM-Server brauchen fast immer einen Port (z. B. :1234)" });
  }
  if (host === "0.0.0.0" || PLACEHOLDER_IP.some(re => re.test(host))) {
    warnings.push({ rule: "placeholder-ip", message: "Sieht aus wie eine Beispiel-/Platzhalter-Adresse" });
  }
  return warnings;
}

/** Zieht die Modell-ids aus der Antwort von `GET /v1/models` (OpenAI-kompatible Form
 *  `{ data: [{ id }] }`). Tolerant gegen alles, was ein Endpunkt statt JSON liefern kann:
 *  HTML-Fehlerseiten, `null`, fehlendes `data`, Einträge ohne `id`. Wirft nie — ein
 *  unbrauchbarer Body ergibt eine leere Liste, die der Aufrufer wie „keine Modelle"
 *  behandelt. Gegenstück zu `classifyEndpointStatus`, das denselben Body auf
 *  *Erreichbarkeit* prüft; beide werden typisch am selben Probe-Ergebnis aufgerufen. */
export function extractModelIds(body: unknown): string[] {
  if (typeof body !== "object" || body === null) return [];
  const data = (body as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];
  return data
    .map((entry) => (typeof entry === "object" && entry !== null ? (entry as { id?: unknown }).id : undefined))
    .filter((id): id is string => typeof id === "string");
}
