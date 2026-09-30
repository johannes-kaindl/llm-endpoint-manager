// uebernommen aus lingotuner/src/obsidian/http.ts (probeEndpoint/listModels/clientFor), 2026-09-13 — Abweichung: Pfad und Modell-Extraktion je Provider
import { Platform, requestUrl } from "obsidian";
import { classifyEndpointStatus, type EndpointStatus } from "../vendor/kit/endpoint_diagnostics";
import { normalizeEndpoint } from "../vendor/kit/endpoint";
import { authHeaders, type EndpointConfig } from "../vendor/kit/endpoint_config";
import { withTimeout } from "../vendor/kit/timeout";
import type { CapabilityFetch } from "../vendor/kit/capabilities";
import { providerProbe } from "../core/provider";
import type { Provider } from "../core/model";

export const PROBE_TIMEOUT_MS = 5000;

type Wire = { status: number; text: string; timedOut: boolean; error: string | null };

/** `window` statt `activeWindow` als Timer-Port: der Timer berührt kein DOM, die Popout-Regel
 *  zielt auf DOM-gebundene Timer, und `obsidianmd/prefer-window-timers` verlangt hier
 *  ausdrücklich `window`. */
function toWireError(err: unknown): Wire {
  return { status: 0, text: "", timedOut: false, error: err instanceof Error ? err.message : String(err) };
}

async function send(url: string, timeoutMs: number, headers?: Record<string, string>, method = "GET", body?: string): Promise<Wire> {
  // requestUrl(...) selbst kann synchron werfen (nicht nur seine Promise ablehnen) — z. B. bei
  // einer ungueltigen URL. Ohne dieses try/catch verliesse ein solcher Wurf send() ungefangen
  // und verletzte den Vertrag "Fehler sind Werte, keine Wuerfe" der Aufrufer (probeStatus/listModels).
  let work: Promise<Wire>;
  try {
    work = requestUrl({ url, method, headers, body, throw: false })
      .then((res) => ({ status: res.status, text: res.text, timedOut: false, error: null }))
      .catch((err: unknown) => toWireError(err));
  } catch (err) {
    return toWireError(err);
  }
  const raced = await withTimeout(work, timeoutMs, window);
  return raced.timedOut ? { status: 0, text: "", timedOut: true, error: null } : raced.value;
}

/** Transport für die Backend-/Capability-Probe (`probeEndpoint`, `fetchCapabilities` aus dem
 *  Kit): Status ≠ 2xx oder nicht parsebares JSON → `null`, nie ein Wurf (CapabilityFetch-Vertrag). */
export const capabilityFetch: CapabilityFetch = async (req) => {
  const res = await send(req.url, PROBE_TIMEOUT_MS, req.headers, req.method ?? "GET", req.body);
  if (res.timedOut || res.error !== null || res.status < 200 || res.status >= 300) return null;
  try { return { json: JSON.parse(res.text) }; } catch { return null; }
};

function target(cfg: EndpointConfig, provider: Provider, probe: ReturnType<typeof providerProbe>): string {
  return `${normalizeEndpoint(cfg.url)}${probe?.path ?? ""}`;
}

/** `apple-shortcuts` hat keinen HTTP-Pfad (Spec § Baustein 2): Erreichbarkeit ist ein reiner
 *  Plattform-Check, kein Netzwerk-Aufruf. Apple Intelligence selbst (aktiviert? Modell geladen?)
 *  kann das Plugin von hier aus nicht prüfen — dafür ist der Probelauf-Knopf mit Mini-Prompt da
 *  (settings-tab.ts), der echte Rundlauf bleibt Gerätemessung. `isMacOS`/`isIosApp` prüfen nur die
 *  Geräteart, keine OS-Version — Obsidian exponiert 26+ nicht; das ist eine bekannte Grenze
 *  (Doku nennt sie), keine Falschmeldung. */
export function applePlatformStatus(): EndpointStatus {
  const supported = Platform.isIosApp || Platform.isMacOS;
  return supported
    ? { reachable: true, kind: "ok", klartext: "Gerät unterstützt Kurzbefehle (iOS/macOS) — Apple Intelligence selbst ungeprüft." }
    : { reachable: false, kind: "unknown", klartext: "", raw: "Kurzbefehle gibt es nur auf iOS und macOS." };
}

/** Erreichbarkeit MIT Token — ohne meldet ein gehosteter Anbieter 401 und gilt still als tot.
 *  Für a1111/comfy zählt nur „antwortet mit 2xx"; `classifyEndpointStatus` würde deren Antwort
 *  als not-an-llm-api werten, was hier keine Aussage ist. */
export async function probeStatus(cfg: EndpointConfig, provider: Provider, timeoutMs: number = PROBE_TIMEOUT_MS): Promise<EndpointStatus> {
  if (provider === "apple-shortcuts") return applePlatformStatus();
  const probe = providerProbe(provider);
  const res = await send(target(cfg, provider, probe), timeoutMs, authHeaders(cfg.apiKey));
  if (res.timedOut) return classifyEndpointStatus({ kind: "timeout" });
  if (res.error !== null) return classifyEndpointStatus({ kind: "error", message: res.error });
  if (provider === "a1111" || provider === "comfy") {
    const ok = res.status >= 200 && res.status < 300;
    return ok
      ? { reachable: true, kind: "ok", klartext: "Verbunden" }
      : classifyEndpointStatus({ kind: "response", status: res.status, body: null });
  }
  let body: unknown = null;
  try { body = JSON.parse(res.text); } catch { /* kein JSON → not-an-llm-api */ }
  return classifyEndpointStatus({ kind: "response", status: res.status, body });
}

export function probeReachable(cfg: EndpointConfig, provider: Provider): Promise<boolean> {
  return probeStatus(cfg, provider).then((s) => s.reachable);
}

/** `apple-shortcuts` hat keine Modell-Liste zum Abfragen — die (einzige) Modellzeile
 *  `{ id: "apple-fm", displayFamily: "apple-fm" }` kommt vorbevölkert über den Preset
 *  (`ProviderPreset.models`, beim Anlegen nach `ep.models` kopiert), `modelRows()` zeigt sie
 *  auch ohne Live-Discovery an (src/core/model-rows.ts). Vor Welle 14 stand das hier, der
 *  Preset trug aber keine Zeile. */
export async function listModels(cfg: EndpointConfig, provider: Provider, timeoutMs: number = PROBE_TIMEOUT_MS): Promise<string[]> {
  if (provider === "apple-shortcuts") return [];
  const probe = providerProbe(provider);
  if (!probe) return [];
  const res = await send(target(cfg, provider, probe), timeoutMs, authHeaders(cfg.apiKey));
  if (res.timedOut || res.error !== null || res.status < 200 || res.status >= 300) return [];
  try { return probe.models(JSON.parse(res.text)); } catch { return []; }
}

/** EIN Client je Zeile für den Kit-Listen-Editor (Status-Icon UND Modell-Liste). */
export function clientFor(cfg: EndpointConfig, provider: Provider): { probe(): Promise<EndpointStatus>; listModels(): Promise<string[]> } {
  return { probe: () => probeStatus(cfg, provider), listModels: () => listModels(cfg, provider) };
}
