# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) (without a `v` prefix).

## [Unreleased]

## [0.1.0] — 2026-09-15

### Added
- Endpoint list with label, protocol (OpenAI-compatible, Ollama, Automatic1111, ComfyUI), capabilities (chat, embedding, vision, image), default model, enabled flag; order = priority.
- API tokens live in the Obsidian keychain (1.11.4+), never in `data.json`; without a keychain the token field is locked.
- Plugin API v1 at `app.plugins.plugins["llm-endpoint-manager"].api`: `list`, `get`, `resolve`, `materialize`, `models`, `importEndpoints`, `on("changed")`. Errors are values.
- Reachability cache per endpoint (30 s) so twelve plugins do not ping the same server twelve times.
- Settings tab: keychain status, list of plugins that asked for an endpoint in this session.
