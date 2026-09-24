# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) (without a `v` prefix).

## [Unreleased]

## [0.2.1] — 2026-09-24

### Changed
- `authorUrl` im Manifest zeigt wieder auf das GitHub-Profil (Rückkehr in den Community Store); keine Funktionsänderung.

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
