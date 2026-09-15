import { PluginSettingTab, type App } from "obsidian";
import type LlmEndpointManagerPlugin from "../main";

export class LlmEndpointManagerSettingTab extends PluginSettingTab {
  constructor(app: App, readonly plugin: LlmEndpointManagerPlugin) { super(app, plugin); }
  display(): void { this.containerEl.empty(); }
}
