# Set up the Apple shortcut

This how-to gets the **Apple Intelligence (on-device)** endpoint working: chat through Apple's on-device model, run from the Shortcuts app, with no server and no network. It needs iOS or macOS 26 or newer, with Apple Intelligence enabled on the device.

For the full picture — why this exists, its limits, and the shortcut itself — see the central guide [uplink.jkaindl.de/apple-shortcuts](https://uplink.jkaindl.de/apple-shortcuts). This page only covers the plugin-side setting.

## 1. Get the shortcut

The central guide names three ways, in this order:

1. **iCloud link** — a shared shortcut, one tap to add it to your library.
2. **Copy-paste prompt** — a text prompt for Shortcuts' own "Make a shortcut" assistant, if you would rather build it yourself.
3. **By hand** — the action list, as a fallback.

Whichever way you choose, note the exact name you gave the shortcut in the Shortcuts app (or keep the default, `Ask On-Device Model (Obsidian)`) — the plugin needs the name to match exactly, including case.

## 2. Add the endpoint

Open **Settings → LLM Endpoint Manager**. Under **Endpoints**, click the preset button **Apple Intelligence (on-device)**. A row appears; it has no server address, because this endpoint runs through the Shortcuts app instead.

## 3. Match the shortcut name and set a timeout

Below the row, set:

- **Shortcut name** — the exact name from step 1. A mismatch means the shortcut never runs (Shortcuts reports "shortcut not found").
- **Timeout (seconds)** — how long the plugin waits for a reply before giving up. The default (30 s) covers the measured round trip (8–14 s) with margin for a guardrail check or a slower device; raise it if your prompts run long.

## 4. Run the test prompt

Click **Run test prompt**. Obsidian switches to the Shortcuts app for a moment and back — that app switch is normal, not an error (Shortcuts calls it "the dance"; turning on **Reduce Motion** in iOS Accessibility settings shortens it). The reply appears as a notice: **On-device reply: …** on success, or a named reason (**error**, **cancel**, **timeout**, **busy**) on failure.

This is the acceptance check for the whole path — a successful reply here means chat through this endpoint will work for any plugin that asks for one.

## Known limits

- **No streaming.** The reply arrives all at once after the app switch, not word by word.
- **~4096-token context**, input and output combined (Apple's published limit) — a long conversation or a large retrieval result can be cut off.
- **No sampling parameters, no tool calls, no image input.** The on-device model does not accept them; a plugin that expects them degrades visibly instead of silently.
- **Guardrail rejections** are more common than with open models — a prompt that a cloud model answers may come back refused here.
- The plugin **cannot verify** that Apple Intelligence itself is turned on or that the device runs iOS/macOS 26+ — its reachability check only confirms the device family (iOS or macOS). The test prompt in step 4 is the real confirmation.

See [Troubleshooting](troubleshooting.md) for what a specific failure reason means.
