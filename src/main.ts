import { Notice, Plugin, getLanguage } from "obsidian";
import "./i18n/strings";
import { pickLang, setLang, t } from "./vendor/kit/i18n";
import { MemorySecretStore, type SecretStore } from "./vendor/kit/secrets";
import { obsidianSecretStore, secretStorageAvailable } from "./vendor/kit-obsidian/secrets";
import { createManagerApi, type ManagerApiHandle } from "./core/api";
import type { LlmEndpointManagerApi } from "./core/api-types";
import { loadSettings, newId, secretIdOf, toPersisted, type ManagedEndpoint, type ManagerSettings } from "./core/model";
import { listModels, probeReachable } from "./obsidian/http";
import { LlmEndpointManagerSettingTab } from "./obsidian/settings-tab";

function safeGetLanguage(): string | null {
  try { return getLanguage(); } catch { return null; }
}

export default class LlmEndpointManagerPlugin extends Plugin {
  settings: ManagerSettings = { version: 1, endpoints: [] };
  secrets: SecretStore = new MemorySecretStore();
  keychain = false;
  handle!: ManagerApiHandle;
  api!: LlmEndpointManagerApi;

  async onload(): Promise<void> {
    setLang(pickLang(safeGetLanguage()));
    this.settings = loadSettings(await this.loadData());
    this.keychain = secretStorageAvailable(this.app);
    this.secrets = this.keychain ? obsidianSecretStore(this.app) : new MemorySecretStore();
    this.handle = createManagerApi({
      settings: () => this.settings,
      replaceSettings: async (next) => { this.settings = next; await this.saveSettings(); },
      secrets: this.secrets,
      probe: (m, provider) => probeReachable(m.config, provider),
      listModels: (m, provider) => listModels(m.config, provider),
      now: () => Date.now(),
      mint: newId,
    });
    // Sofort setzen: sobald das Plugin-Objekt in app.plugins.plugins auftaucht, soll `api` da sein.
    this.api = this.handle.api;
    this.addSettingTab(new LlmEndpointManagerSettingTab(this.app, this));
  }

  /** Der EINZIGE Weg nach data.json — über toPersisted, nie mit apiKey. */
  async saveSettings(): Promise<void> {
    this.settings = toPersisted(this.settings);
    await this.saveData(this.settings);
    this.handle.notifyChanged();
  }

  async setSecret(ep: ManagedEndpoint, value: string): Promise<void> {
    const sid = secretIdOf(ep.id);
    try {
      this.secrets.set(sid, value);
    } catch {
      new Notice(t("notice.secretFailed"), 8000);
      throw new Error("secret-not-persisted");
    }
    const target = this.settings.endpoints.find((e) => e.id === ep.id);
    if (target) target.secretId = sid;
    this.handle.invalidateUrl(ep.url);
    await this.saveSettings();
  }

  async clearSecret(ep: ManagedEndpoint): Promise<void> {
    const target = this.settings.endpoints.find((e) => e.id === ep.id);
    if (target?.secretId) this.secrets.delete(target.secretId);
    if (target) delete target.secretId;
    this.handle.invalidateUrl(ep.url);
    await this.saveSettings();
  }

  async removeEndpoint(id: string): Promise<void> {
    const target = this.settings.endpoints.find((e) => e.id === id);
    if (!target) return;
    if (target.secretId) this.secrets.delete(target.secretId);
    this.handle.invalidateUrl(target.url);
    this.settings.endpoints = this.settings.endpoints.filter((e) => e.id !== id);
    await this.saveSettings();
  }
}
