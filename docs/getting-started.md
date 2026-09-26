# Getting started

This walk-through takes you from installing LLM Endpoint Manager to a first endpoint that shows **Reachable**, with a token stored in the keychain. It takes about five minutes and needs a model server you can reach — for example [LM Studio](https://lmstudio.ai) on the same machine (the [local LLM setup guide](https://uplink.jkaindl.de/llm-setup) covers installing one).

## 1. Install and enable

Install the plugin by one of the ways in the [README](https://github.com/johannes-kaindl/llm-endpoint-manager#install) — the sideloader catalog, or by hand: put `main.js`, `manifest.json` and `styles.css` into `<vault>/.obsidian/plugins/llm-endpoint-manager/`. Then enable **LLM Endpoint Manager** under **Settings → Community plugins**.

The plugin adds no command and no ribbon icon. Everything is in its settings tab.

## 2. Add your first endpoint

Open **Settings → LLM Endpoint Manager**. Under **Endpoints** you see the **LLM endpoints** list and, below it, three preset buttons: **LM Studio**, **Ollama** and **OpenAI-compatible cloud**.

Click **LM Studio** (or **Ollama**, if that is what you run). A row appears with the address `http://localhost:1234` (Ollama: `http://localhost:11434`), the protocol and the capabilities the preset sets.

Have another server? Type its address into the empty field **Add an endpoint: http://localhost:1234** and click outside the field — a row is saved when a field loses focus. Base addresses work with or without a trailing `/v1`; the plugin strips it.

## 3. Read the status

Every row has a status indicator next to its address. Hover it to read the result: **Reachable** means the server answered like a model API. Anything else names the reason, for example **Connection refused — is the server running?** — see [Troubleshooting](troubleshooting.md).

Click **Check connections** to test all rows again.

Below the address, the row shows one of these roles:

- **active** — this is the endpoint a plugin will get.
- **reachable, position 2** — reachable, but an endpoint above it comes first. **Use first** moves a row to the top.
- **not reachable** — plugins skip it.

## 4. Choose what the endpoint can do

Look at the row's lines **Protocol** and **Capabilities**. Switch on what the server really offers: **chat**, **embedding**, **vision** (understanding images) or **image** (generating images). A plugin asks for a capability, not for a server, so a row without any capability is invisible to all plugins and shows *Without a capability no plugin will find this endpoint.*

## 5. Store a token (optional)

If the server needs an API token, paste it into the field **API token (optional)** on the row. The value goes into Obsidian's keychain — never into your notes or the plugin's `data.json` — and the row then reads **token saved**, with the actions **Change token** and **Remove token**.

If the field is locked and says **Keychain not available — tokens cannot be stored.**, your Obsidian version has no working keychain (it needs 1.11.4 or newer). Endpoints without a token keep working.

## 6. Look at the models

Scroll to **Models**. For each endpoint the plugin lists the models the server reports. For a model you can pick a **Family** — a suggestion such as *Suggested: gpt-oss* is offered from the name — and fill in **Another spelling of** when the same model appears under two ids and plugins should send one of them. The **Backend** dropdown, with the **Detect** button, names the server software; **Detect** only reads and never loads a model.

## 7. See who uses it

The last group, **Plugins using these endpoints**, stays empty — *No plugin has asked for an endpoint yet.* — until another plugin that supports the manager asks for an endpoint. Then a line like `<plugin> — Chat` appears with the time of the request. That is the sign that everything is wired up.

**Next:** keep [Troubleshooting](troubleshooting.md) at hand for the first time an endpoint turns red.
