import { App, Notice, PluginSettingTab, Setting, type SettingDefinitionItem } from "obsidian";
import type LlmEndpointManagerPlugin from "../main";
import { t } from "../vendor/kit/i18n";
import { renderSettingDefinitions, settingBodyHost, refreshSettingsTab } from "../vendor/kit-obsidian/settings_walker";
import { buildEndpointList, type EndpointListStrings, type EndpointSecretHook } from "../vendor/kit-obsidian/endpoint-list";
import { createModelListCache, type ModelListCache } from "../vendor/kit/model-list-cache";
import type { EndpointStatusKind } from "../vendor/kit/endpoint_diagnostics";
import { authHeaders, type EndpointRole } from "../vendor/kit/endpoint_config";
import { normalizeEndpoint } from "../vendor/kit/endpoint";
import { BACKEND_IDS, BACKENDS, FAMILIES, FAMILY_IDS, type BackendId, type FamilyId } from "../vendor/kit/sampling-profiles";
import { probeBaseUrl, probeEndpoint } from "../vendor/kit/capabilities";
import { CAPABILITIES, PROVIDERS, labelFromUrl, newId, type ManagedEndpoint, type Provider } from "../core/model";
import { modelRows, setModelMeta, type ModelRow } from "../core/model-rows";
import { PRESETS } from "../core/provider";
import { clientFor, capabilityFetch } from "./http";

type ItemDef = { name?: string; desc?: string; render?: (setting: Setting) => void };
type GroupDef = { type?: string; heading?: string; items?: ItemDef[] };

const STATUS_KEY: Record<Exclude<EndpointStatusKind, "unknown">, string> = {
  "ok": "ep.status.ok", "refused": "ep.status.refused", "unknown-host": "ep.status.unknownHost",
  "timeout": "ep.status.timeout", "not-an-llm-api": "ep.status.notAnLlmApi", "unauthorized": "ep.status.unauthorized",
};
const WARN_KEY: Record<string, string> = {
  "scheme": "ep.warn.scheme", "malformed": "ep.warn.malformed", "port": "ep.warn.port", "placeholder-ip": "ep.warn.placeholderIp",
};

export class LlmEndpointManagerSettingTab extends PluginSettingTab {
  private modelLists: ModelListCache = createModelListCache();
  private cleanupPrevious: () => void = () => {};

  constructor(app: App, readonly plugin: LlmEndpointManagerPlugin) {
    super(app, plugin);
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    const defs: GroupDef[] = [
      { type: "group", heading: t("set.groupEndpoints"), items: [
        { name: t("set.endpoints"), desc: t("set.endpointsDesc"), render: (s) => { this.renderEndpoints(s); } },
      ] },
      { type: "group", heading: t("models.heading"), items: [
        { name: t("models.heading"), render: (s) => { this.renderModelsAndBackend(s); } },
      ] },
      { type: "group", heading: t("set.groupKeychain"), items: [
        { name: t("set.groupKeychain"), render: (s) => { this.renderKeychainStatus(s); } },
      ] },
      { type: "group", heading: t("set.groupConsumers"), items: [
        { name: t("set.groupConsumers"), desc: t("set.consumersDesc"), render: (s) => { this.renderConsumers(s); } },
      ] },
    ];
    return defs as unknown as SettingDefinitionItem[];
  }

  display(): void {
    this.renderImperative();
  }

  hide(): void {
    this.modelLists.clear();   // Kit-Vertrag: sonst bleibt „nicht erreichbar" für die Sitzung stehen
  }

  /* Eigene Methode statt `this.display()` direkt aufzurufen: `display()` ist auf
   * `PluginSettingTab` seit 1.13 als veraltet markiert (Ersatz `getSettingDefinitions()`), und
   * `no-deprecated` meldet jeden Aufruf — auch den der eigenen Override. Der volle Rebuild
   * lebt deshalb hier, `display()` bleibt der schlichte Fallback-Einstiegspunkt. */
  private renderImperative(): void {
    this.cleanupPrevious();
    this.containerEl.empty();
    this.cleanupPrevious = renderSettingDefinitions(this.containerEl, this.getSettingDefinitions(), this.plugin as never, this.app);
  }

  private refreshUi(): void {
    refreshSettingsTab(this, () => { this.renderImperative(); });
  }

  private endpointStrings(): EndpointListStrings {
    return {
      addPlaceholder: t("ep.addPlaceholder"), apiKeyPlaceholder: t("ep.apiKeyPlaceholder"), modelPlaceholder: t("ep.modelPlaceholder"),
      ariaUrl: t("ep.ariaUrl"), ariaAdd: t("ep.ariaAdd"),
      ariaApiKey: (url) => t("ep.ariaApiKey", url), ariaModel: (url) => t("ep.ariaModel", url),
      modelHint: (key) => (key === "unreachable" ? t("ep.hint.unreachable") : key === "no-list" ? t("ep.hint.noList") : ""),
      savedSuffix: t("ep.saved"), refreshModels: t("ep.refreshModels"), moveToFront: t("ep.moveToFront"),
      remove: t("ep.remove"), thirdParty: t("ep.thirdParty"), probing: t("ep.probing"),
      statusTooltip: (status) => (status.kind === "unknown" ? t("ep.status.unknown", status.raw ?? "") : t(STATUS_KEY[status.kind])),
      role: (role: EndpointRole) => role.kind === "active" ? t("ep.role.active")
        : role.kind === "standby" ? t("ep.role.standby", String(role.position))
        : role.kind === "unreachable" ? t("ep.role.unreachable") : t("ep.role.skippedModel"),
      warnings: (ws) => ws.map((w) => (WARN_KEY[w.rule] ? t(WARN_KEY[w.rule]) : w.message)).join(" · "),
      presetTooltip: (p) => t("ep.preset", p.label), presetLabel: (p) => p.label,
      checkConnection: t("ep.checkConnection"), saveFailed: t("ep.saveFailed"),
      secretSaved: t("ep.secretSaved"), secretChange: t("ep.secretChange"), secretClear: t("ep.secretClear"), secretUnavailable: t("ep.secretUnavailable"),
    };
  }

  /** Der gespeicherte Endpunkt trägt nie ein `apiKey` (`toPersisted`); die Zeilen-Prüfung und die
   *  Modell-Liste brauchen es aber, sonst antwortet ein Bearer-geschützter Server mit 401 und
   *  die Zeile meldet „nicht erreichbar", obwohl der Token stimmt. Bewusst nicht `materialize()`:
   *  das verwirft deaktivierte Einträge und Einträge ohne Token, die Zeile soll sie trotzdem prüfen. */
  private withToken(cfg: ManagedEndpoint): ManagedEndpoint {
    const token = cfg.secretId ? this.plugin.secrets.get(cfg.secretId) : null;
    return token ? { ...cfg, apiKey: token } : cfg;
  }

  private secretHook(): EndpointSecretHook<ManagedEndpoint> {
    return {
      available: this.plugin.keychain,
      has: (cfg) => cfg.secretId !== undefined && this.plugin.secrets.has(cfg.secretId),
      set: (cfg, _i, value) => this.plugin.setSecret(cfg, value),
      clear: (cfg) => this.plugin.clearSecret(cfg),
    };
  }

  /** Einträge, die der Kit-Editor neu anlegt (Adder, Preset), sind nackte `{url}` — hier bekommen
   *  sie id, Label, Provider und Fähigkeiten. Presets liefern Provider/Fähigkeiten mit. */
  private complete(eps: ManagedEndpoint[]): ManagedEndpoint[] {
    return eps.map((e) => {
      if (e.id) return e;
      const preset = PRESETS.find((p) => normalizeEndpoint(p.url) === normalizeEndpoint(e.url));
      return { ...e, id: newId(), label: e.label || labelFromUrl(e.url) || preset?.label || t("row.newEndpoint"), provider: preset?.provider ?? "openai",
        capabilities: preset ? [...preset.capabilities] : ["chat"], enabled: true };
    });
  }

  private renderEndpoints(setting: Setting): void {
    buildEndpointList<ManagedEndpoint>({
      containerEl: settingBodyHost(setting),
      label: t("set.endpoints"), desc: t("set.endpointsDesc"), placeholder: "http://localhost:1234",
      strings: this.endpointStrings(), cache: this.modelLists,
      get: () => this.plugin.settings.endpoints,
      set: (eps) => {
        // Entfernte Einträge nehmen ihr Token mit; die Liste selbst kennt den Schlüsselbund nicht.
        const kept = new Set(eps.map((e) => e.id));
        for (const old of this.plugin.settings.endpoints) {
          if (old.id && !kept.has(old.id)) { if (old.secretId) this.plugin.secrets.delete(old.secretId); this.plugin.handle.invalidateUrl(old.url); }
        }
        this.plugin.settings.endpoints = this.complete(eps);
      },
      active: () => null,
      clientFor: (cfg) => clientFor(this.withToken(cfg), cfg.provider ?? "openai"),
      save: () => this.plugin.saveSettings(),
      reconnect: async () => { this.plugin.handle.reachability.clear(); },
      rerender: () => { this.refreshUi(); },
      presets: PRESETS.map((p) => ({ label: p.label, url: p.url })),
      secret: this.secretHook(),
      extraRow: (host, cfg) => { this.renderExtra(host, cfg); },
    });
  }

  private renderExtra(host: HTMLElement, cfg: ManagedEndpoint): void {
    const save = async (mutate: (e: ManagedEndpoint) => void): Promise<void> => {
      const target = this.plugin.settings.endpoints.find((e) => e.id === cfg.id);
      if (!target) return;
      mutate(target);
      this.plugin.handle.invalidateUrl(target.url);
      await this.plugin.saveSettings();
    };
    new Setting(host).setName(t("row.label")).addText((tx) => {
      tx.setValue(cfg.label);
      tx.inputEl.setAttribute("aria-label", t("row.label"));
      tx.inputEl.addEventListener("blur", () => { void save((e) => { e.label = tx.getValue().trim() || labelFromUrl(e.url) || t("row.newEndpoint"); }); });
    });
    new Setting(host).setName(t("row.provider")).addDropdown((d) => {
      for (const p of PROVIDERS) d.addOption(p, t(`row.provider.${p}`));
      d.setValue(cfg.provider);
      d.selectEl.setAttribute("aria-label", t("row.provider"));
      // Protokollwechsel ändert den Probe-Pfad, nicht die (normalisierte) URL — der Modell-Cache
      // ist nach Schlüssel indiziert, muss also hier gezielt invalidiert werden. `save()` invalidiert
      // nur `handle.invalidateUrl` (API-interne Caches, s. Kommentar dort); dieser Cache ist lokal
      // im Settings-Tab und lebt in `this.modelLists`, nicht im Handle.
      d.onChange((v) => { this.modelLists.invalidate(normalizeEndpoint(cfg.url)); void save((e) => { e.provider = v as Provider; }).then(() => this.refreshUi()); });
    });
    const caps = new Setting(host).setName(t("row.capabilities"));
    // Eigene Klasse statt `:has(.lem-cap)` in styles.css (Store-Befund „Avoid :has“, 0.2.3).
    caps.settingEl.addClass("lem-cap-row");
    for (const c of CAPABILITIES) {
      // Toggle und Beschriftung als eine Einheit, damit ein schmales Fenster sie nicht trennt
      // (das Label rutschte sonst als Einzelzeile unter den Toggle, s. Screenshot 2026-09-25).
      const unit = caps.controlEl.createDiv({ cls: "lem-cap" });
      caps.addToggle((tg) => {
        tg.setValue(cfg.capabilities.includes(c)).setTooltip(t(`cap.${c}`));
        tg.toggleEl.setAttribute("aria-label", t(`cap.${c}`));
        tg.onChange((on) => { void save((e) => {
          e.capabilities = on ? [...new Set([...e.capabilities, c])] : e.capabilities.filter((x) => x !== c);
        }).then(() => { this.syncCapWarning(host, cfg.id); }); });
      });
      const toggleEl = caps.controlEl.lastElementChild;
      if (toggleEl && toggleEl !== unit) unit.appendChild(toggleEl);
      unit.createSpan({ cls: "lem-cap-label", text: t(`cap.${c}`) });
    }
    new Setting(host).setName(t("row.enabled")).addToggle((tg) => {
      tg.setValue(cfg.enabled);
      tg.toggleEl.setAttribute("aria-label", t("row.enabled"));
      tg.onChange((on) => { void save((e) => { e.enabled = on; }); });
    });
    const warn = host.createDiv({ cls: "lem-row-warn" });
    warn.setAttribute("data-for", cfg.id);
    this.syncCapWarning(host, cfg.id);
    if (cfg.secretId && !this.plugin.secrets.has(cfg.secretId)) host.createDiv({ cls: "lem-row-warn", text: t("row.secretMissing") });
  }

  private syncCapWarning(host: HTMLElement, id: string): void {
    const e = this.plugin.settings.endpoints.find((x) => x.id === id);
    // querySelectorAll statt querySelector + Klasse-only-Selektor: der Obsidian-Mock
    // (tests/vendor/kit/obsidian-mock.ts) kennt weder ersteres noch ein Attribut-Selektor-Suffix
    // an einer Klasse — Filterung nach data-for deshalb hier in JS, nicht im Selektor.
    const warn = Array.from(host.querySelectorAll<HTMLElement>(".lem-row-warn")).find((w) => w.getAttribute("data-for") === id);
    if (!warn) return;
    warn.setText(e && e.capabilities.length === 0 ? t("row.noCapability") : "");
  }

  /** Modelltabelle (Familie, Alias) und Backend je Endpunkt — bewusst NICHT in `renderExtra`
   *  (dort zählt der Kit-Editor die Fähigkeiten-/Protokoll-Zeilen; eine zusätzliche Dropdown
   *  dort verschöbe deren Form). Eigene Gruppe, ein Block je Endpunkt. */
  private renderModelsAndBackend(setting: Setting): void {
    const host = settingBodyHost(setting);
    for (const ep of this.plugin.settings.endpoints) {
      new Setting(host).setName(ep.label).setHeading();
      this.renderModels(host, ep);
      this.renderBackend(host, ep);
    }
  }

  private renderModels(host: HTMLElement, cfg: ManagedEndpoint): void {
    const listHost = host.createDiv({ cls: "lem-models-list" });
    const draw = (listed: string[]): void => {
      listHost.empty();
      const current = this.plugin.settings.endpoints.find((e) => e.id === cfg.id) ?? cfg;
      for (const row of modelRows(listed, current.models)) this.renderModelRow(listHost, current, row);
    };
    draw([]);
    void this.plugin.api.models(cfg.id).then((r) => { if (Array.isArray(r)) draw(r); });
  }

  private renderModelRow(host: HTMLElement, cfg: ManagedEndpoint, row: ModelRow): void {
    const save = async (patch: { family?: FamilyId | null; aliasOf?: string | null }): Promise<void> => {
      const target = this.plugin.settings.endpoints.find((e) => e.id === cfg.id);
      if (!target) return;
      const updated = setModelMeta(target, row.id, patch);
      if (updated.models) target.models = updated.models; else delete target.models;
      await this.plugin.saveSettings();
    };
    const setting = new Setting(host).setName(row.id);
    setting.addDropdown((d) => {
      d.addOption("", row.suggested ? t("models.familySuggested", FAMILIES[row.suggested].label) : t("models.familyAuto"));
      for (const f of FAMILY_IDS) d.addOption(f, FAMILIES[f].label);
      d.selectEl.setAttribute("aria-label", t("models.family"));
      d.setValue(row.family ?? "");
      d.onChange((v) => { void save({ family: v ? (v as FamilyId) : null }); });
    });
    setting.addText((tx) => {
      tx.setValue(row.aliasOf ?? "");
      tx.setPlaceholder(t("models.aliasOf"));
      tx.inputEl.setAttribute("aria-label", t("models.aliasOfDesc"));
      tx.inputEl.addEventListener("blur", () => { void save({ aliasOf: tx.getValue().trim() || null }); });
    });
  }

  private renderBackend(host: HTMLElement, cfg: ManagedEndpoint): void {
    new Setting(host).setName(t("backend.name")).addDropdown((d) => {
      d.addOption("", t("models.familyAuto"));
      for (const b of BACKEND_IDS) d.addOption(b, BACKENDS[b].label);
      d.selectEl.setAttribute("aria-label", t("backend.name"));
      d.setValue(cfg.backend ?? "");
      d.onChange((v) => { void this.saveBackend(cfg.id, v ? (v as BackendId) : null); });
    }).addButton((btn) => {
      btn.setButtonText(t("backend.detect"));
      btn.onClick(() => { void this.detectBackend(cfg); });
    });
  }

  private async saveBackend(id: string, backend: BackendId | null): Promise<void> {
    const target = this.plugin.settings.endpoints.find((e) => e.id === id);
    if (!target) return;
    if (backend) target.backend = backend; else delete target.backend;
    await this.plugin.saveSettings();
  }

  /** `capabilityFetch` fragt nur `/api/config`, `/api/show`, `/api/v1/models`, `/api/v0/models`
   *  — reine GET/HEAD-artige Lesevorgänge, kein JIT-Load eines Modells (Auftragsregel 12). */
  private async detectBackend(cfg: ManagedEndpoint): Promise<void> {
    const auth = authHeaders(this.withToken(cfg).apiKey);
    const r = await probeEndpoint((req) => capabilityFetch({ ...req, headers: { ...auth, ...req.headers } }), probeBaseUrl(cfg.url), cfg.model ?? "");
    if (r.backend === "unknown") { new Notice(t("backend.unknown")); return; }
    new Notice(t("backend.detected", BACKENDS[r.backend].label));
    await this.saveBackend(cfg.id, r.backend);
    this.refreshUi();
  }

  /** Schlüsselbund-Status als sichtbarer Text — bewusst als render-Hatch mit eigenem DOM-Knoten
   *  (statt nur `setDesc`): eine reine Deklaration ohne Zusatz-DOM trägt in der Obsidian-API
   *  ihren Text zwar sichtbar, ist aber für diesen Consumer nicht von einer Setting-Beschreibung
   *  zu unterscheiden, sobald mehrere Status-Zeilen (Endpunkte, Konsumenten) danebenstehen. */
  private renderKeychainStatus(setting: Setting): void {
    const host = settingBodyHost(setting);
    host.createDiv({ cls: "lem-keychain-status", text: this.plugin.keychain ? t("set.keychainOk") : t("set.keychainMissing") });
  }

  private renderConsumers(setting: Setting): void {
    const host = settingBodyHost(setting);
    const records = this.plugin.handle.callers();
    if (records.length === 0) { host.createDiv({ cls: "lem-consumers-empty", text: t("set.consumersEmpty") }); return; }
    for (const r of [...records].reverse()) {
      const when = new Date(r.at).toLocaleTimeString();
      new Setting(host).setName(t("set.consumerRow", r.caller, r.capability ? t(`cap.${r.capability}`) : "—")).setDesc(when);
    }
  }
}

export function noticeImport(r: { added: string[]; merged: string[]; skipped: string[] }): void {
  new Notice(t("notice.imported", String(r.added.length), String(r.merged.length), String(r.skipped.length)));
}
