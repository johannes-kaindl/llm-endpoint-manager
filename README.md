# LLM Endpoint Manager

**One place for your LLM endpoints: URLs, models, capabilities and API tokens in the Obsidian
keychain — shared with other plugins through a small API.**

[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)
[![Docs: CC BY-SA 4.0](https://img.shields.io/badge/docs-CC%20BY--SA%204.0-lightgrey.svg)](LICENSE-DOCS)
[![Release](https://img.shields.io/badge/release-0.1.0-blue)](https://git.jkaindl.de/jkaindl/llm-endpoint-manager/releases/tag/0.1.0)
![Platform](https://img.shields.io/badge/platform-Obsidian%201.11.4%2B%20%C2%B7%20desktop%20%26%20mobile-7c3aed)

LLM Endpoint Manager centralizes what other LLM-using plugins in this workspace otherwise
duplicate: a list of endpoints (URL, wire format, capabilities, default model) and the API
tokens that go with them. Tokens are never written to `data.json` — they live exclusively in
Obsidian's keychain, and the plugin exposes both the endpoint list and token access to
neighboring plugins through a small API
(`app.plugins.plugins["llm-endpoint-manager"].api`). It owns endpoints, tokens, model lists
and reachability checks; it knows nothing about prompts, roles or requests — that stays with
the plugins that consume this API.

## Quick start

**Via the sideloader catalog** (recommended): install
[`anysource-sideloader`](https://git.jkaindl.de/jkaindl/anysource-sideloader), point it at the
catalog `jkaindl/obsidian-catalog`, and install "LLM Endpoint Manager" from there.

**Manually:** download `main.js`, `manifest.json` and `styles.css` from the latest release and
copy them into `<vault>/.obsidian/plugins/llm-endpoint-manager/`, then enable the plugin in
Obsidian's Community Plugins settings.

```bash
npm install
npm run gate     # lint + typecheck + tests + build
npm run deploy    # requires OBSIDIAN_PLUGIN_DIR pointing at a vault's plugin folder
```

## Usage

Open **Settings → LLM Endpoint Manager** and add an endpoint:

1. **URL** — the base URL of an OpenAI-compatible server, an Ollama instance, an
   Automatic1111 (Stable Diffusion WebUI) or a ComfyUI instance.
2. **Protocol** — pick the wire format the endpoint speaks: OpenAI-compatible, Ollama,
   Automatic1111 or ComfyUI.
3. **Capabilities** — which of `chat`, `embedding`, `vision`, `image` this endpoint can
   serve. A consuming plugin asks for a capability, not for a specific endpoint.
4. **Token** — optional. If your Obsidian version has a working keychain (1.11.4+), the token
   field is available and the value goes straight into the OS keychain, never into
   `data.json`. Without a keychain the field is locked and shows why.
5. **Default model**, **enabled** and the endpoint's **order** (order doubles as priority —
   the first enabled, reachable endpoint with the requested capability wins).

A separate **Models** section lists, per endpoint, every model the endpoint reports plus any
you have already configured. For each model you can set its **family** (a guess from the model
name is offered as a suggestion, e.g. `verdigado-pro → gpt-oss`) and mark it as **another
spelling of** another model id — consumers then send that other id instead. Each endpoint also
gets a **Backend** field (LM Studio, Ollama, Open WebUI, OpenAI-compatible); "Detect" probes the
endpoint read-only (`/api/config`, `/api/show`, `/api/v1/models`, `/api/v0/models` — it never
loads a model) and fills the field in.

The settings tab also shows keychain status and which plugins asked this plugin for an
endpoint during the current session.

Other plugins do not talk to your LLM servers directly. Instead they call this plugin's API to
ask for an endpoint that can do what they need (e.g. "give me something that does `chat`"),
get back a ready-to-use base URL, wire format and — if the caller asks for it explicitly via
`materialize`/`resolve` — a token to send with the request. They choose which model to use
themselves; this plugin only offers `defaultModel` as a hint.

## API

Other plugins reach this plugin's API at `app.plugins.plugins["llm-endpoint-manager"].api`.
**Read the API object fresh on every call — never cache it** — the plugin can be disabled at
any time, in which case `app.plugins.plugins["llm-endpoint-manager"]` is `undefined`.

The contract is vendored into `src/vendor/kit/endpoint-source.ts` (from `obsidian-kit`'s
`endpoint-source` module, re-exported unchanged by `src/core/api-types.ts`) — see that file for
the full `LlmEndpointManagerApi` interface (`version`, `list`, `get`, `resolve`, `materialize`,
`models`, `importEndpoints`, `on`), the `ApiEndpoint`/`ResolvedEndpoint`/`ImportResult` shapes and
the `ApiErrorCode` union. It also exports `LLM_ENDPOINT_MANAGER_PLUGIN_ID`
(`"llm-endpoint-manager"`), the id this plugin registers itself under in
`app.plugins.plugins[...]`.

- `Provider` is `"openai" | "ollama" | "a1111" | "comfy"`, `Capability` is
  `"chat" | "embedding" | "vision" | "image"`.
- **Errors are values, not exceptions.** Every method that can fail returns `ApiError` instead
  of throwing — callers check `"error" in result` rather than wrapping every call in `try/catch`.
- `list`/`get` return a snapshot for display; they never carry a token.
- `resolve(capability)` finds the first enabled, reachable endpoint offering that capability
  (in configured order) and returns it materialized — the fastest way for a caller that just
  wants "something that can do `chat`".
- `materialize(id)` resolves one specific endpoint the caller already knows about (e.g. one the
  user picked explicitly).
- `models(id)` lists the models a specific endpoint currently reports (cached until the endpoint
  changes or `force: true` is passed — the list does not expire on its own; `resolve()`/
  `materialize()` use a separate 30 s reachability cache, so twelve plugins asking about the
  same server don't send twelve requests).
- `importEndpoints` lets a caller (e.g. a migration from an older, plugin-local endpoint list)
  add or merge endpoint configs in bulk, including their secret values.
- `on("changed", cb)` subscribes to endpoint list changes and returns an unsubscribe function.

### Security boundary

**Tokens never cross the API.** `list()` and `get()` return an `ApiEndpoint` with a boolean
`hasSecret` flag only — the token value itself is not part of that shape
(`toApiEndpoint` in `src/core/api.ts` builds the object field by field and never touches
`secretId`/`apiKey`). Only `resolve()` and `materialize()` hand back a `ResolvedEndpoint` whose
`config` carries the token — and only to a caller that explicitly asked to send a request to
that endpoint, at the moment it needs it, never as part of a listing.

## License

Code: [AGPL-3.0-or-later](LICENSE). Documentation: [CC BY-SA 4.0](LICENSE-DOCS).
