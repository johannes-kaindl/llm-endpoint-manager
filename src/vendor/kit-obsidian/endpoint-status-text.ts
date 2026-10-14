// vendored from obsidian-kit@0.60.1, src/obsidian/endpoint-status-text.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
/** Texte (EN/DE) für den Status einer Endpunkt-Zeile und für die Eingabe-Hinweise — ohne die
 *  Verbindung, die Endpunkt-Liste oder ein Bündel dahinter.
 *
 *  Warum ein eigenes Blatt-Modul: dieselbe Zuordnung `kind → Text` und `rule → Text` trugen
 *  slide-deck (`statusKindKey`), vault-crews (`endpoint-labels.ts`), yijing-oracle
 *  (`endpoint-editor-model.ts`) und llm-endpoint-manager (`settings-tab.ts`) je selbst. Wer nur die
 *  Texte braucht, vendort dieses Modul und zieht weder `llm-connection` noch `embedding-connection`
 *  nach; `llm-connection-strings` baut sein Bündel aus denselben Tabellen (eine Quelle).
 *
 *  Herkunft der Texte: lingotuner, die reicheren Fassungen aus vault-rag (`timeout`,
 *  `not-an-llm-api`) und koda-agent — siehe `llm-connection-strings` (UI-STANDARD § 10). */
import type { EndpointStatusKind } from "../kit/endpoint_diagnostics";

export type EndpointStatusTextLang = "en" | "de";

/** Regeln aus `validateEndpointInput`; eine unbekannte Regel liefert den `fallback` (die Meldung der Regel). */
export type EndpointWarningRule = "scheme" | "malformed" | "port" | "placeholder-ip";

type KnownKind = Exclude<EndpointStatusKind, "unknown">;

interface StatusTexts {
  kinds: Record<KnownKind, string>;
  /** `{0}` = Rohtext der Probe. */
  unknown: string;
  unknownBare: string;
  warnings: Record<EndpointWarningRule, string>;
}

export const ENDPOINT_STATUS_TEXTS_EN: StatusTexts = {
  kinds: {
    ok: "Connected",
    refused: "Connection refused — server not running or wrong port.",
    "unknown-host": "Unknown host — typo in the address?",
    timeout: "Timeout — network unreachable (wrong network / VPN off?).",
    "not-an-llm-api": "Responds, but is not an OpenAI-compatible endpoint — wrong path/service?",
    unauthorized: "Access denied — API key missing or invalid.",
  },
  unknown: "Not reachable — {0}",
  unknownBare: "Not reachable",
  warnings: {
    scheme: "Address needs http:// or https://",
    malformed: "Address is not a valid URL",
    port: "Local LLM servers almost always need a port (e.g. :1234)",
    "placeholder-ip": "Looks like an example or placeholder address",
  },
};

export const ENDPOINT_STATUS_TEXTS_DE: StatusTexts = {
  kinds: {
    ok: "Verbunden",
    refused: "Verbindung abgelehnt — Server läuft nicht oder Port falsch.",
    "unknown-host": "Hostname unbekannt — Tippfehler in der Adresse?",
    timeout: "Zeitüberschreitung — Netz nicht erreichbar (falsches Netz / VPN aus?).",
    "not-an-llm-api": "Antwortet, ist aber kein OpenAI-kompatibler Endpunkt — falscher Pfad/Dienst?",
    unauthorized: "Zugriff verweigert — Schlüssel fehlt oder ist ungültig.",
  },
  unknown: "Nicht erreichbar — {0}",
  unknownBare: "Nicht erreichbar",
  warnings: {
    scheme: "Adresse braucht http:// oder https://",
    malformed: "Adresse ist keine gültige URL",
    port: "Lokale LLM-Server brauchen fast immer einen Port (z. B. :1234)",
    "placeholder-ip": "Sieht aus wie eine Beispiel- oder Platzhalter-Adresse",
  },
};

const tablesOf = (lang?: EndpointStatusTextLang): StatusTexts => (lang === "de" ? ENDPOINT_STATUS_TEXTS_DE : ENDPOINT_STATUS_TEXTS_EN);

/** Text zu einer Status-Marke. `unknown` (und jede künftige, hier nicht bekannte Marke) zeigt den
 *  Rohtext, wenn einer da ist, sonst „Not reachable“ ohne hängenden Strich. */
export function endpointStatusText(kind: EndpointStatusKind, opts?: { lang?: EndpointStatusTextLang; raw?: string }): string {
  const t = tablesOf(opts?.lang);
  const known = (t.kinds as Partial<Record<string, string>>)[kind];
  if (known !== undefined) return known;
  return opts?.raw ? t.unknown.replace("{0}", () => opts.raw as string) : t.unknownBare;
}

/** Text zu einer Eingabe-Regel; eine unbekannte Regel liefert `opts.fallback` (Default: die Regel selbst). */
export function endpointWarningText(rule: string, opts?: { lang?: EndpointStatusTextLang; fallback?: string }): string {
  const known = (tablesOf(opts?.lang).warnings as Partial<Record<string, string>>)[rule];
  return known ?? opts?.fallback ?? rule;
}
