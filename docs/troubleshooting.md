# Troubleshooting

Each entry gives the message as it appears in the settings tab (English interface; the German texts are the same messages), the cause and what to do. Rows show the status messages as a tooltip on the status indicator.

## An endpoint is not reachable

### "Connection refused — is the server running?"

**Cause:** nothing listens on that address and port. **What to do:** start the server (for LM Studio: turn on the local server, default port 1234; Ollama: port 11434) and click **Check connections**. Check the port in the address.

### "Host not found"

**Cause:** the host name does not resolve. **What to do:** check for typos; on the same machine use `localhost`; for another machine use its IP address or a name your system can resolve.

### "No answer within the time limit"

**Cause:** the server or a firewall does not answer in time — often a wrong IP or a sleeping machine. **What to do:** open the address in a browser, wake the server, allow the port in the firewall, then **Check connections**.

### "Answers, but not like a model API"

**Cause:** something answers, but not with a model list at the expected path (any answer other than a model list, and other than 401/403, lands here). Typical: the address points at a web page, a reverse proxy without the API path, or carries a path beyond the base (for example `…/v1/chat/completions`). **What to do:** enter the base address only — `http://host:1234`. A trailing `/v1` is fine, the plugin strips it; anything deeper is not stripped. For image protocols check that the row's **Protocol** matches the server (**Automatic1111 (image)**, **ComfyUI (image)**). The [local LLM setup guide](https://uplink.jkaindl.de/llm-setup) explains the right address per server.

### "Rejected: token missing or wrong"

**Cause:** the server answered 401 or 403 — it demands an API token and got none or a wrong one. **What to do:** paste the token into **API token (optional)** on the row (see below if the field is locked). If the row says **A token is referenced but not in the keychain — enter it again.**, the keychain entry is gone (for example on a new device) — enter the token again.

### "Not reachable — the model list could not be loaded." / "Reachable, but the server did not return a model list — type the model name."

**Cause:** the first: the server did not answer. The second: it answers but offers no list (some servers and image backends do not). **What to do:** for the first, see the entries above. For the second nothing is broken — type the name into the row's model field.

### A warning under the address

These messages point at a typo and never block saving: **Address should start with http:// or https://** (a scheme is missing), **Address looks malformed** (the text is not a valid URL — also what the empty **OpenAI-compatible cloud** preset, which starts as just `https://`, shows until you complete it with your provider's address), **Port looks unusual** (a local `http://` address without a port such as `:1234`) and **Placeholder address — replace it** (`0.0.0.0` or an example address from the documentation ranges).

## The Apple Intelligence (on-device) endpoint

See [Set up the Apple shortcut](apple-shortcut.md) for the full setup. These are the **Run test prompt** failure reasons.

### "Test failed (error): …"

**Cause:** the shortcut itself reported a failure — often a guardrail rejection (the on-device model declined the prompt) or an action inside the shortcut that failed. **What to do:** read the message text; try a shorter or plainer test prompt; open the shortcut in the Shortcuts app and run it once by hand to see where it stops.

### "Test failed (cancel): …"

**Cause:** the app switch to Shortcuts was cancelled (for example by tapping away, or a system prompt was dismissed). **What to do:** run **Run test prompt** again and stay in Shortcuts until it returns to Obsidian.

### "Test failed (timeout): …"

**Cause:** no reply arrived within the configured **Timeout (seconds)** — most often the shortcut's name does not exactly match **Shortcut name**, so it never launches; less often a slow device or a long prompt. **What to do:** check the exact spelling of the shortcut name in the Shortcuts app; raise the timeout for long prompts.

### "Test failed (busy): …"

**Cause:** another shortcut run is still in flight — only one run is allowed at a time (the app switch cannot tell two runs apart). **What to do:** wait for the first run to finish (or its timeout to pass), then try again.

### The plugin does not know whether Apple Intelligence is actually on

**Cause:** the endpoint's reachability check only confirms the device is iOS or macOS — it cannot ask whether Apple Intelligence is enabled or which iOS/macOS version is running. **What to do:** use **Run test prompt** as the real check; if it fails with **error**, confirm in **Settings → Apple Intelligence & Siri** (iOS/macOS) that it is turned on and the device meets the requirements.

## Tokens and the keychain

### "Tokens need the Obsidian keychain (Obsidian 1.11.4 or newer, desktop and mobile). Endpoints without a token still work." / "Keychain not available — tokens cannot be stored."

**Cause:** your Obsidian has no working keychain — it is older than 1.11.4 or the system keychain is unavailable. **What to do:** update Obsidian. Until then use endpoints that need no token. The plugin never falls back to storing a token in a file.

### "The keychain did not store the token. Nothing was saved."

**Cause:** the keychain refused the write. **What to do:** try again; if it keeps failing, check that the system keychain is unlocked and reload Obsidian. Nothing was stored, so there is nothing to clean up.

### "This endpoint carries a token — requests may leave your machine."

Not an error: a reminder. A token usually means a hosted service, so what plugins send to it leaves your computer.

## Nothing seems to happen

### "No plugin has asked for an endpoint yet."

**Cause:** the manager only stores and checks endpoints; it does not use them itself. The list under **Plugins using these endpoints** fills only when another plugin asks (and only for the current session). **What to do:** install or enable a plugin that supports the manager, and select it there. A plugin that supports the manager asks for a capability; make sure your endpoint has the capability switched on and is **Enabled**.

### A plugin says it found no endpoint

**Cause:** no enabled, reachable endpoint offers the capability the plugin asked for. **What to do:** on the row, switch on the capability (**Capabilities**), make sure **Enabled** is on and the status is **Reachable**. Plugins built on the shared endpoint source use their own endpoint list only when the manager is not installed or disabled; once the manager is active, it alone decides.

### The manager is disabled or missing

Plugins read the manager's API fresh on every call; without the plugin they behave as if it were not installed. Enable **LLM Endpoint Manager** under **Settings → Community plugins**.

## Other messages

### "Saving failed — the list was rebuilt."

The settings could not be written (disk full or file locked). The list shows what is really stored; repeat your last change.

### "Could not detect the backend — set it by hand if you know it."

**Detect** asks the server only read-only questions; not every server answers them. Choose the entry in the **Backend** dropdown by hand, or leave it unset.

### `localhost` does not work on my phone

On a phone, `localhost` is the phone itself. Use your computer's network address or a name that resolves on your network, and make sure the server listens on it — the [local LLM setup guide](https://uplink.jkaindl.de/llm-setup) covers mobile access.

## Getting help

Open an issue on GitHub: <https://github.com/johannes-kaindl/llm-endpoint-manager/issues>. Include your Obsidian version, the exact message and the protocol of the endpoint — never your token.
