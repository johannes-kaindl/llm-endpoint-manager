# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) (without a `v` prefix).

## [Unreleased]

### Added

- Settings, keychain section: tokens in the keychain that belong to no endpoint (left over after an endpoint was removed while the plugin was off, or after a reset of the settings file) are counted, and a "Clean up" button removes them after a confirmation. Nothing is removed automatically, because another device with a settings file that has not synced yet may still need them.

### Changed

- Kit pins raised to `obsidian-kit` 0.61.0 and `code-kit` 0.28.0 (from 0.60.1 and 0.27.1). Of the skipped releases (obsidian-kit 0.60.2, 0.60.3, 0.61.0; code-kit 0.27.2, 0.28.0) two things reach this plugin visibly: the family list of a model row now includes "Claude", and the backend row now knows "Anthropic" (both come from the sampling table, which gained the Claude family and the Anthropic backend). Everything else is internal: the Gemma 4 thinking channel and the streaming answer area are not used here, the keychain adapter without typed access (`secret-store-loose`) is not vendored, and the endpoint list, status texts and the settings walker behave as before.

## [0.8.0] — 2026-10-14

### Fixed

- API: a `"changed"` listener that subscribes again while it is being called (for example one that re-subscribes on every redraw) is no longer called a second time in the same round. Before, such a listener looped endlessly.
- Import by another plugin: a token that already sits in the keychain under the endpoint's standard name is linked to the merged endpoint again instead of staying orphaned (the endpoint showed "no token" although one existed). A token that comes with the import never overwrites an existing one.
- Import by another plugin: the model list of a merged endpoint is dropped, so a new token no longer leaves the old (empty) list in place.
- `models(id, { force: true })` also forgets the cached reachability of that endpoint; `resolve()` no longer keeps answering "no endpoint" for up to 30 seconds while the model list already shows models.
- Settings: when another plugin imports endpoints while the tab is open, the list updates by itself.

### Changed

- Settings, endpoint list: the row of the endpoint a plugin would get for chat now reads "active" instead of "reachable, position 1". It follows the same rule as the API call `resolve` (first enabled, reachable endpoint with a usable token); the rows below it keep "reachable, position N".
- Kit pins raised to `obsidian-kit` 0.60.1 and `code-kit` 0.27.1 (from 0.59.1 and 0.24.0). Of the skipped releases (obsidian-kit 0.60.0, 0.60.1; code-kit 0.25.0, 0.26.0, 0.27.0, 0.27.1) nothing reaches this plugin visibly: the endpoint list only had its internals tidied, `sampling-profiles` lists dropped request settings sorted instead of in stored order (order of a warning only), and the new error texts per manager code, `tool-provider`, share export, plugin-ID check and thinking button do not apply to the plugin that is the source of the endpoints. The plugin API stays at version 1 and the `ApiErrorCode` values are unchanged.

## [0.7.0] — 2026-10-12

### Changed

- Settings, endpoint list: the "move to top" and "remove endpoint" buttons stay together in one row instead of the bin icon sitting alone on a second line. The address and the model ID stay fully visible at normal window width (a very long ID gets a row of its own); in a narrow window the block of model and buttons moves to a second line as a whole, aligned to the right. Only the empty key field shows a shorter placeholder. This plugin's own stylesheet carries the same copy of the kit rules.
- Kit pins raised to `obsidian-kit` 0.59.1 and `code-kit` 0.24.0 (from 0.56.0 and 0.23.0). The plugin API stays at version 1 and answers as before. Of the skipped releases (0.56.1, 0.56.2, 0.57.0, 0.58.0, 0.59.0, 0.59.1 and code-kit 0.24.0) only the endpoint list reaches this plugin; the new "no model row" option of the endpoint-source section does not apply here, because this plugin is the source of endpoints, not a consumer.

## [0.6.1] — 2026-10-12

### Fixed

- A new Apple Intelligence row is named after its preset ("Apple Intelligence (on-device)", "Apple Intelligence (auf dem Gerät)" in German) instead of "on-device", the host part of its internal address. A preset row with a cloud address and no host (OpenAI-compatible cloud) now also takes the translated preset name. Rows created from a typed address still take the host.

## [0.6.0] — 2026-10-12

### Added

- A reachable endpoint row that has a model now shows the model's context length under the role line: "Context: loaded 65,536 · max 262,144 tokens" (only "max …" when the model is not loaded; nothing when the server does not report a number). LM Studio is asked first, then Ollama; the row's token goes with the request, each attempt gives up after 5 seconds, and "Reload models" asks again. Apple Intelligence, Automatic1111 and ComfyUI rows are never asked.
- The model dropdown of an endpoint row offers "— (server picks)" ("— (Server wählt)") again. Choosing it removes the model from the row, so the server answers with whatever it has loaded.

### Changed

- The status tooltips and the address hints under an endpoint row now read as in every other plugin built on the shared kit (EN and DE). Status: "Reachable" is now "Connected"; "Connection refused — is the server running?" is "Connection refused — server not running or wrong port."; "Host not found" is "Unknown host — typo in the address?"; "No answer within the time limit" is "Timeout — network unreachable (wrong network / VPN off?)."; "Answers, but not like a model API" is "Responds, but is not an OpenAI-compatible endpoint — wrong path/service?"; "Rejected: token missing or wrong" is "Access denied — API key missing or invalid."; an unknown failure reads "Not reachable — …" with the raw reason. Hints: "Address needs http:// or https://", "Address is not a valid URL", "Local LLM servers almost always need a port (e.g. :1234)", "Looks like an example or placeholder address". Troubleshooting and the getting-started guide quote the new wording. The plugin's own tables are gone.
- Kit pins raised to `obsidian-kit` 0.56.0 and `code-kit` 0.23.0 (from 0.46.0 and 0.9.0). The plugin API stays at version 1 and answers as before (17 API tests and the list/resolve smoke points unchanged). Of the skipped kit releases, these reach this plugin: the model dropdown, the status wording and the context line above (obsidian-kit 0.52.0, 0.56.0); `<think>` blocks are cut out in linear time in the sampling-profile response check (code-kit 0.22.0, no visible effect here, the manager sends no requests); the keychain helpers `secrets` moved from obsidian-kit to code-kit (0.15.0, same behaviour). The key-redaction rules (code-kit 0.18.0/0.21.0), the remote-source guard and the removal of the global model field (obsidian-kit 0.55.0) concern parts of the kit this plugin does not vendor.

## [0.5.1] — 2026-10-03

### Changed

- The changelog is now written entirely in English.

## [0.5.0] — 2026-09-30

### Added

- The Apple Intelligence (on-device) preset now carries its one model row (`apple-fm`, display family "Apple Foundation Models"), and the model table draws that block from this data instead of a fixed paragraph; the limits text (4096-token context, no streaming, no sampling parameters, no tool calls, no vision input) stays underneath as a supplement. Consumers see the model with `displayFamily: "apple-fm"` through `list()`/`get()` (additive, plugin API stays at version 1). Kit: `obsidian-kit` 0.46.0, `code-kit` 0.9.0.

### Fixed

- The limits text under the Apple Intelligence model block no longer renders in heading size (it had no style rule).
- The preset buttons under the endpoint list no longer stay English in a German interface: "OpenAI-compatible cloud" now reads "OpenAI-kompatible Cloud" and "Apple Intelligence (on-device)" reads "Apple Intelligence (auf dem Gerät)" (brand names such as LM Studio and Ollama stay as they are). The tooltip "Add …" follows the same wording.
- The empty "Other spelling of" field in the model table no longer shows a truncated label as its placeholder; it now says "Model id" / "Modell-ID", the full explanation stays in the field's accessible label.

## [0.4.0] — 2026-09-30

### Added

- The GitHub release now also carries a ready-to-unpack `llm-endpoint-manager.zip` (the plugin folder with `main.js`, `manifest.json` and `styles.css`) and a `checksums.sha256` file. For a manual install, download the zip and unpack it into `.obsidian/plugins/` instead of creating the folder and saving three files by hand.
- New endpoint type "Apple Intelligence (on-device)": a preset that runs chat through the Shortcuts app instead of a server address (iOS and macOS, no network, no cloud). Add it from the endpoint list's preset row, set the shortcut's exact name and a timeout, and use the new "Run test prompt" button to confirm the round trip on your device. The plugin API stays at version 1: existing consumers never see this endpoint unless they explicitly ask for it (`list({ transports: ["shortcuts"] })`); `resolve()` continues to pick only HTTP endpoints, unaware consumers are unaffected. See the new how-to "Set up the Apple shortcut" for setup.
- Kit modules updated from `obsidian-kit` 0.43.0 to 0.45.1 (full re-vendoring; adds `shortcuts-bridge` and `clock`, and the extended `endpoint-source` with `EndpointTransport`/`ShortcutTransportConfig`/`ListFilter.transports`).

### Known limitations

- Apple Intelligence via Shortcuts: no streaming (one-shot reply), a ~4096-token context (input and output combined, per Apple's published limit), no sampling parameters, no tool calls, and no image input. The plugin cannot verify Apple Intelligence itself is enabled or that iOS/macOS 26+ is running — reachability is a device-family check only; use the test-prompt button for a real confirmation.

## [0.3.1] — 2026-09-26

### Changed
- Kit modules updated from `obsidian-kit` 0.41.0 to 0.43.0 (full re-vendoring; apart from the endpoint list only the provenance stamps changed). The endpoint list's CSS now uses child selectors (`.okit-ep-row > …`), so the nested extra rows (label, protocol, capabilities, active) keep their labels without a local override. The two override rules in `styles.css` are removed; the endpoint rows look exactly as before, in wide and narrow settings windows.

## [0.3.0] — 2026-09-26

### Added
- Help row at the top of the settings with links to the documentation and the issue tracker.

### Fixed
- The capability row in the endpoint settings is now styled through its own class instead of the `:has()` selector the store review flagged ("Avoid :has"). The layout is unchanged.

## [0.2.3] — 2026-09-26

### Fixed
- The keychain status text and the empty-consumers text in the settings tab now sit inside their group box with the same inset as the rows below (they were flush with the box edge).

### Documentation
- README rewritten after the workspace standard (features, requirements, install, configuration, how it works), plus a German README.
- User documentation under `docs/`: an index, a getting-started tutorial and a troubleshooting guide, linked from both READMEs.

## [0.2.2] — 2026-09-25

### Fixed
- The connection check in the settings tab (status icon, model list) and the backend "Detect" button now send the token from the keychain. Before, a bearer-protected server answered 401 and the row read "unreachable" although the token was right, while plugins using the API worked.
- The Endpoint-, Protocol-, Capabilities- and "Enabled" rows of an endpoint had lost their visible labels (the "Enabled" toggle looked unlabelled). Labels are back, and each capability toggle stays together with its name in a narrow window.
- The "OpenAI-compatible cloud" preset no longer names the new endpoint `https://`; it gets the preset name, or "New endpoint" when there is no host. Endpoints created earlier keep their label until edited.

### Changed
- The keychain status line now says what it means for you ("Your token is safe: it is not written into your notes or plugin settings files") instead of naming the storage.
- `changed` listeners of `importEndpoints` are notified after the tokens are written, so `hasSecret` is already correct inside the listener.
- Provider/capability lists are now checked by the compiler against the kit unions (the guard types were declared but never enforced); `check:pure` fails when it finds no file to check.

## [0.2.1] — 2026-09-24

### Changed
- `authorUrl` in the manifest points to the GitHub profile again (return to the Community Store); no functional change.

## [0.2.0] — 2026-09-23

### Added
- Each endpoint can now carry a model table (family, alias) and a backend (LM Studio, Ollama, Open WebUI,
  OpenAI-compatible). Family is suggested from the model name (`familyFromName`) and can be overridden per
  model; an alias marks another spelling of the same model. Backend can be auto-detected ("Detect" button,
  read-only probe against `/api/config`, `/api/show`, `/api/v1/models`, `/api/v0/models` — never loads a
  model). New "Models" section in the settings tab, one block per endpoint.
- Plugin API v1 (`version` stays `1`): `get`/`resolve`/`materialize` now carry `backend`/`models` when set on
  the endpoint — both fields are optional and additive, existing consumers see no change.

### Changed
- Vendoring bumped to `obsidian-kit` 0.41.0 / `code-kit` 0.7.0 (new modules `sampling-profiles`,
  `capabilities`, `reasoning`).

## [0.1.2] — 2026-09-15

### Changed
- `src/core/api-types.ts` re-exports the API contract from `obsidian-kit` 0.37.0 `endpoint-source` instead of
  defining it locally — one source for `LlmEndpointManagerApi`, consumers vendor it from the Kit. No behavior
  change for existing users of the plugin API.

## [0.1.1] — 2026-09-15

### Fixed
- `importEndpoints` no longer throws when the keychain fails to persist a secret — it returns `{error: "secret-missing"}` instead, matching the "errors are values" contract. Settings are now persisted before secrets are written, so a partial failure never leaves an orphaned keychain entry.
- The settings tab's model-list cache is now invalidated when an endpoint's protocol changes, so the model dropdown no longer shows stale results from the previous protocol.

## [0.1.0] — 2026-09-15

### Added
- Endpoint list with label, protocol (OpenAI-compatible, Ollama, Automatic1111, ComfyUI), capabilities (chat, embedding, vision, image), default model, enabled flag; order = priority.
- API tokens live in the Obsidian keychain (1.11.4+), never in `data.json`; without a keychain the token field is locked.
- Plugin API v1 at `app.plugins.plugins["llm-endpoint-manager"].api`: `list`, `get`, `resolve`, `materialize`, `models`, `importEndpoints`, `on("changed")`. Errors are values.
- Reachability cache per endpoint (30 s) so twelve plugins do not ping the same server twelve times.
- Settings tab: keychain status, list of plugins that asked for an endpoint in this session.
