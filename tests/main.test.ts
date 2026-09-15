import { describe, it, expect } from "vitest";
import { makeFakeApp } from "./vendor/kit/obsidian-mock";
import LlmEndpointManagerPlugin from "../src/main";

function plugin(data: unknown, app = makeFakeApp()): LlmEndpointManagerPlugin {
  const p = new LlmEndpointManagerPlugin(app, { id: "llm-endpoint-manager", name: "x", version: "0", minAppVersion: "1.11.4", description: "", author: "", authorUrl: "", isDesktopOnly: false, dir: "" });
  (p as unknown as { loadData: () => Promise<unknown> }).loadData = () => Promise.resolve(data);
  const saved: unknown[] = [];
  (p as unknown as { saveData: (d: unknown) => Promise<void> }).saveData = (d) => { saved.push(d); return Promise.resolve(); };
  (p as unknown as { __saved: unknown[] }).__saved = saved;
  return p;
}

describe("LlmEndpointManagerPlugin", () => {
  it("lädt Settings, hängt die API an und schreibt nie ein apiKey", async () => {
    const p = plugin({ endpoints: [{ url: "http://a", apiKey: "leak" }] });
    await p.onload();
    expect(p.api.version).toBe(1);
    expect(p.settings.endpoints[0]?.url).toBe("http://a");
    await p.saveSettings();
    const saved = (p as unknown as { __saved: Array<{ endpoints: Array<Record<string, unknown>> }> }).__saved;
    expect(saved.at(-1)?.endpoints[0] && "apiKey" in saved.at(-1)!.endpoints[0]!).toBe(false);
  });
  it("setSecret schreibt in den Schlüsselbund, clearSecret und removeEndpoint räumen ihn", async () => {
    const app = makeFakeApp();
    const p = plugin({ endpoints: [{ id: "e1", url: "http://a" }] }, app);
    await p.onload();
    expect(p.keychain).toBe(true);
    const ep = p.settings.endpoints[0]!;
    await p.setSecret(ep, "tok\n");
    expect(app.secretStorage.getSecret("llm-endpoint-manager-e1")).toBe("tok");
    expect(p.settings.endpoints[0]?.secretId).toBe("llm-endpoint-manager-e1");
    await p.clearSecret(ep);
    // Raw app.secretStorage.getSecret bliebe hier bei "" — Obsidian hat keinen Löschaufruf,
    // obsidianSecretStore.delete() schreibt Leerstring (siehe src/vendor/kit-obsidian/secrets.ts).
    // Geprüft wird deshalb über den SecretStore-Wrapper, der "" als null behandelt.
    expect(p.secrets.get("llm-endpoint-manager-e1")).toBeNull();
    expect(p.settings.endpoints[0]?.secretId).toBeUndefined();
    await p.setSecret(ep, "tok2");
    await p.removeEndpoint("e1");
    expect(p.settings.endpoints.length).toBe(0);
    expect(p.secrets.get("llm-endpoint-manager-e1")).toBeNull();
  });
  it("ohne Schlüsselbund: keychain=false, Memory-Store, kein Wurf", async () => {
    const app = makeFakeApp(); delete app.secretStorage;
    const p = plugin({}, app);
    await p.onload();
    expect(p.keychain).toBe(false);
  });
});
