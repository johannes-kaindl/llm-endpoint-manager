# Use the Claude API

This how-to adds Anthropic's Claude API as an endpoint, so plugins that know about Claude can use it. It needs an Anthropic API key (from the Anthropic Console); using the API is billed by Anthropic, not by this plugin.

## 1. Add the endpoint

Open **Settings → LLM Endpoint Manager**. Under **Endpoints**, click the preset button **Anthropic (Claude API)**. A row appears with the address `https://api.anthropic.com`, the protocol **Anthropic (Claude API)** and the capabilities **chat** and **vision** (Claude can read images; it has no embeddings and does not generate images).

## 2. Store your key

Paste your Anthropic API key into the field **API token (optional)** on the row. It goes into Obsidian's keychain, never into your notes or the plugin's `data.json`, and the row then reads **token saved**. The key is only ever sent to Anthropic, directly from your device.

## 3. Check the connection

Hover the status indicator on the row, or click **Check connections**. A green indicator means Anthropic answered with a model list; the **Models** group then lists the Claude models your key can use. A red indicator reads **Access denied — API key missing or invalid.** when the key is wrong.

## 4. Which plugins use it

A plugin that supports Claude lists the endpoint in its own endpoint choice and sends its requests to Anthropic's native API. **Koda can use it already; the other plugins follow with their next update.** A plugin that does not know about Claude never sees the endpoint, so adding it cannot break an older plugin.

## What to expect

- Claude's thinking is shown as a short summary. The depth of thinking follows each plugin's own setting (it is sent as Anthropic's `effort`).
- Fixed values some plugins set for a request, such as `temperature: 0`, are not sent to current Claude models, because the API refuses them. The plugin's request view lists what was left out.
- Older Claude models (Sonnet 4.5, Haiku 4.5) take neither the effort setting nor adaptive thinking; the plugins ask Anthropic which model takes what and leave the rest out.
