# Recording contract — README images

This folder holds the images that `README.md` and `README.de.md` embed. This file is the **contract**: which images exist, what each must show, which class it belongs to, and how to record them again reproducibly. `readme_lint.py` (workspace tool, run as `npm run shots:check`) compares contract ↔ files ↔ README embeds.

The plugin has no view of its own, so every image shows its settings tab. Since Obsidian 1.13 the settings tab is a window of its own; the recipe drives it through the workspace window (state) and captures the settings window.

## Status

**2026-09-26: all four images recorded** in a second Obsidian instance (own profile, own debug port, Obsidian 1.14.2, English interface, light theme) against the fixture vault in `fixture/`. Every image was looked at after recording.

## Images

| Datei | Klasse | referenziert von | muss zeigen |
| --- | --- | --- | --- |
| `hero.png` | hero | README (oben) | The whole settings window: the sidebar entry **LLM Endpoint Manager** selected, the group **Endpoints** with the first two rows — **LM Studio (desktop)** at "reachable, position 1" and **Ollama (laptop)** at "reachable, position 2", each with its green status indicator, protocol, capability toggles and **Enabled** switch. Must explain without a caption that this is one list of endpoints for other plugins. |
| `endpoints.png` | feature | README § Features | The lower half of the endpoint list with **two rows of different role**: a reachable one ("reachable, position 2") and an unreachable one (red indicator, "not reachable", "token saved" with the change/remove icons, the warning icon), plus the add field and the preset buttons **LM Studio**, **Ollama**, **OpenAI-compatible cloud** and **Check connections**. The claim: reachability and order are two different things, and tokens show as "saved", never as a value. |
| `models.png` | feature | README § Features | The **Models** group for one endpoint: model rows with a set **Family** ("Qwen 3.8"), a suggested one ("Suggested: Qwen 3.8", "Suggested: Gemma 4"), one row filled in **Other spelling of** (`qwen/qwen3.8-27b@4bit` → `qwen/qwen3.8-27b`) and the **Backend** row with **Detect**. |
| `consumers.png` | feature | README § Features | The groups **API tokens** (keychain status text) and **Plugins using these endpoints** with two calling plugins, each with a capability and a time. The claim: you can see which plugin asked for what. |

## Fixture and recipe

- `fixture/notes/` — one note; `fixture/obsidian/` — vault config: only this plugin enabled, light theme (`moonstone`).
- The plugin's own data is **not** in the fixture: `scripts/shots.ts` sets it through the plugin at run time (three endpoints, one placeholder token `demo-token`, two calls of invented plugins "Notes Assistant" and "Vault Search") and removes it again afterwards.
- Two endpoints answer from small fake servers the recipe starts itself, on ports `1235` and `11435`; the third points at closed port `1237`. The real default ports `1234` and `11434` stay untouched, so a running LM Studio or Ollama cannot change an image.
- Example data is generic and English. The token is an ASCII placeholder, never a masked value.

```bash
npm run build && npm run shots -- --setup        # build the vault from the fixture
# start Obsidian with that vault, English interface (obsidian.json "language": "en" AND
# localStorage["language"] = "en", then restart), own --user-data-dir, own debug port
npm run shots -- --port <port> [--only hero|endpoints|models|consumers]
npm run shots:check                              # must report no findings
```

The recipe needs a display at least 900 px high (the settings window is set to 1000×900) and aborts with a message if the interface language is not English.
