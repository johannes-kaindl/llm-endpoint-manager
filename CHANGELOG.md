# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) (without a `v` prefix).

## [Unreleased]

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
