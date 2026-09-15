# LLM Endpoint Manager

**One place for your LLM endpoints: URLs, models, capabilities and API tokens in the Obsidian
keychain — shared with other plugins through a small API.**

[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)
[![Docs: CC BY-SA 4.0](https://img.shields.io/badge/docs-CC%20BY--SA%204.0-lightgrey.svg)](LICENSE-DOCS)
![Status](https://img.shields.io/badge/status-scaffold-lightgrey)
![Platform](https://img.shields.io/badge/platform-Obsidian%201.11.4%2B%20%C2%B7%20desktop%20%26%20mobile-7c3aed)

> **Status: scaffold.** This repository is the freshly built skeleton for the plugin — a
> minimal, loadable plugin with a green gate (`npm run gate`) and no user-facing feature yet.
> No release exists. The rest of this document describes the intended shape.

LLM Endpoint Manager centralizes what other LLM-using plugins in this workspace otherwise
duplicate: a list of endpoints (URL, wire format, capabilities, default model) and the API
tokens that go with them. Tokens are never written to `data.json` — they live exclusively in
Obsidian's keychain, and the plugin exposes both the endpoint list and token access to
neighboring plugins through a small API
(`app.plugins.plugins["llm-endpoint-manager"].api`). It owns endpoints, tokens, model lists
and reachability checks; it knows nothing about prompts, roles or requests — that stays with
the plugins that consume this API.

## Quick start

This plugin is not yet released. To build and try the scaffold locally:

```bash
npm install
npm run gate     # lint + typecheck + tests + build
npm run deploy    # requires OBSIDIAN_PLUGIN_DIR pointing at a vault's plugin folder
```

## Usage

Not yet available — the scaffold ships a minimal `onload()` and no settings tab. Endpoint
management, secret storage wiring and the neighbor-plugin API are built in the tasks that
follow this one.

## License

Code: [AGPL-3.0-or-later](LICENSE). Documentation: [CC BY-SA 4.0](LICENSE-DOCS).
