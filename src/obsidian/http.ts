// uebernommen aus lingotuner/src/obsidian/http.ts (probeEndpoint/listModels/clientFor), 2026-09-13 — Abweichung: Pfad und Modell-Extraktion je Provider
import { requestUrl } from "obsidian";
import { classifyEndpointStatus, type EndpointStatus } from "../vendor/kit/endpoint_diagnostics";
import { normalizeEndpoint } from "../vendor/kit/endpoint";
import { authHeaders, type EndpointConfig } from "../vendor/kit/endpoint_config";
import { withTimeout } from "../vendor/kit/timeout";
import { providerProbe } from "../core/provider";
import type { Provider } from "../core/model";

export const PROBE_TIMEOUT_MS = 5000;

type Wire = { status: number; text: string; timedOut: boolean; error: string | null };

/** `window` statt `activeWindow` als Timer-Port: der Timer berührt kein DOM, die Popout-Regel
 *  zielt auf DOM-gebundene Timer, und `obsidianmd/prefer-window-timers` verlangt hier
 *  ausdrücklich `window`. */
async function send(url: string, timeoutMs: number, headers?: Record<string, string>): Promise<Wire> {
  const work = requestUrl({ url, method: "GET", headers, throw: false })
    .then((res) => ({ status: res.status, text: res.text, timedOut: false, error: null }))
    .catch((err: unknown) => ({ status: 0, text: "", timedOut: false, error: err instanceof Error ? err.message : String(err) }));
  const raced = await withTimeout(work, timeoutMs, window);
  return raced.timedOut ? { status: 0, text: "", timedOut: true, error: null } : raced.value;
}

function target(cfg: EndpointConfig, provider: Provider): string {
  return `${normalizeEndpoint(cfg.url)}${providerProbe(provider).path}`;
}

/** Erreichbarkeit MIT Token — ohne meldet ein gehosteter Anbieter 401 und gilt still als tot.
 *  Für a1111/comfy zählt nur „antwortet mit 2xx"; `classifyEndpointStatus` würde deren Antwort
 *  als not-an-llm-api werten, was hier keine Aussage ist. */
export async function probeStatus(cfg: EndpointConfig, provider: Provider, timeoutMs: number = PROBE_TIMEOUT_MS): Promise<EndpointStatus> {
  const res = await send(target(cfg, provider), timeoutMs, authHeaders(cfg.apiKey));
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

export async function listModels(cfg: EndpointConfig, provider: Provider, timeoutMs: number = PROBE_TIMEOUT_MS): Promise<string[]> {
  const res = await send(target(cfg, provider), timeoutMs, authHeaders(cfg.apiKey));
  if (res.timedOut || res.error !== null || res.status < 200 || res.status >= 300) return [];
  try { return providerProbe(provider).models(JSON.parse(res.text)); } catch { return []; }
}

/** EIN Client je Zeile für den Kit-Listen-Editor (Status-Icon UND Modell-Liste). */
export function clientFor(cfg: EndpointConfig, provider: Provider): { probe(): Promise<EndpointStatus>; listModels(): Promise<string[]> } {
  return { probe: () => probeStatus(cfg, provider), listModels: () => listModels(cfg, provider) };
}
