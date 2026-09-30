# AGENTS.md

Orientierung für KI-Agenten (Claude Code, Codex, …) und Mitwirkende an diesem Repository.
Workspace-weite Standards (comply-or-explain): siehe [`../../workspace/_docs/CONVENTIONS.md`](../../workspace/_docs/CONVENTIONS.md)
(maintainer-lokal, nicht Teil dieses Repos — ignorieren, falls im Klon nicht vorhanden).

**Profil:** `ts-node` · `obsidian-plugin`.

**Stand 2026-09-25: 0.2.2 (Sampling-Profile-Modelltabelle seit 0.2.0); Plan 2 seit 0.1.0 released.** Alle 13 Tasks aus Plan 2 umgesetzt: Kern-Datenmodell,
Plugin-API v1 (`createManagerApi`, „Fehler sind Werte"), HTTP-Probe, Settings-Tab (Endpunkt-Liste,
Protokoll/Fähigkeiten/Aktiv-Schalter), i18n, Schlüsselbund-Verdrahtung (`obsidianSecretStore`),
GUI-Smoke 9/9. Vendoring auf obsidian-kit 0.36.1 + code-kit 0.6.0, `npm run gate` grün. Tag + Forgejo-Release
für 0.1.0 existieren. Für neue Vorhaben gilt: erst Kit-first-Sondierung (`../AGENTS.md` +
`../REGISTRY.md`), dann `superpowers:brainstorming` → Spec → Plan → TDD.

## Project character

**Projekt:** `llm-endpoint-manager` — Obsidian-Plugin, das LLM-Endpunkte (URL, Wire-Format,
Fähigkeiten, Default-Modell) zentral verwaltet, API-Tokens ausschließlich im Obsidian-Schlüsselbund
hält und beides über `app.plugins.plugins["llm-endpoint-manager"].api` an Nachbar-Plugins gibt.
Besitzt: Endpunkte, Tokens, Modell-Listen, Erreichbarkeit. Kennt nicht: Prompts, Rollen, Anfragen
(Dach-AGENTS.md § Zuständigkeits-Zuschnitt). Spec: `../docs/superpowers/specs/2026-09-12-llm-endpoint-manager-design.md`.
Autor: Johannes Kaindl.

**Nie Klartext:** `data.json` trägt nie ein Token. `ManagedEndpoint.apiKey` ist im gespeicherten
Zustand immer leer; der Sanitizer entfernt es. Ohne Schlüsselbund ist das Token-Feld gesperrt.

## Architecture principles

**PROF-OBS-03/04 — reiner Kern ohne `obsidian`-Import.** `src/core/` ist obsidian-frei und in
Node ohne DOM-Mock testbar; nur `main.ts`, Settings-Tab und IO-Adapter importieren `obsidian`.
`npm run check:pure` nagelt das fest (`scripts/check-pure.mjs`).

**Vendoring statt Dependency.** Geteilte Bausteine aus `obsidian-kit` und `code-kit` liegen als
verbatim-Snapshot unter `src/vendor/kit/` (pure) und `src/vendor/kit-obsidian/` (obsidian-gekoppelt),
je mit Herkunfts-Header in Zeile 1 und `VENDOR.json`. Nie von Hand editieren — Re-Vendor über
`tools/sync-kit.sh`.

```
src/core/            pure, obsidian-frei, Vitest
src/main.ts           Plugin-Einstiegspunkt (onload, Secret-Wiring, ManagerApiHandle)
src/obsidian/         obsidian-gekoppelt: Settings-Tab, IO-Adapter
src/i18n/strings.ts   alle Texte (UI-STANDARD §10)
src/vendor/kit/       vendorte pure Kit-Module (verbatim, Header via sync-kit.sh)
src/vendor/kit-obsidian/  vendorte obsidian-gekoppelte Kit-Module (verbatim)
tests/vendor/kit/     vendorter Obsidian-Mock (obsidian-mock.ts)
```

## Commands

- `npm run gate` — lint + typecheck + typecheck:test + typecheck:scripts + test + check:pure + build; Pflicht vor
  jedem Commit.
- `npm run deploy` — Build + Kopie nach `$OBSIDIAN_PLUGIN_DIR` (Staging-Vault-Plugin-Ordner).
- `KIT_REF=<version> CODE_KIT_REF=<version> sh tools/sync-kit.sh` — Re-Vendoring aus
  `obsidian-kit` (Default `KIT_DIR=../obsidian-kit`) und `code-kit` (Default `CODE_KIT_DIR=../../code-kit`
  — in diesem Workspace liegt `code-kit` unter `~/Projects/jkaindl/libs/code-kit`, also
  zusätzlich `CODE_KIT_DIR=<pfad>` setzen).

## Conventions

- `src/core` ist obsidian-frei (PROF-OBS-03/04, `npm run check:pure` erzwingt es).
- Texte ausschließlich in `src/i18n/strings.ts`, kein Fachbegriff ohne Auflösung
  (Dach-AGENTS.md §10).
- CSS-Präfix `lem-`, nur Theme-CSS-Variablen, kein `!important` (UI-STANDARD).
- Vendorte Dateien unter `src/vendor/` und `tests/vendor/` nie von Hand editieren — sie sind vom
  Lint-Kern per `eslint.overrides.mjs` (`ignores: ["src/vendor/**"]`) ausgenommen, weil sie
  verbatim-Snapshots sind, nicht Verantwortung dieses Repos.

## Gotchas

- Secret-IDs dürfen nur `[a-z0-9-]` enthalten (Obsidian-Schlüsselbund-Konvention aus
  `obsidian-kit`/`secrets.ts`).
- `tools/sync-kit.sh` bricht ohne `set -e`-Fallback gezielt ab, wenn `KIT_REF`/`CODE_KIT_REF`
  nicht als Tag in der jeweiligen Quelle existieren — Version explizit prüfen
  (`git -C <repo> tag -l`), bevor der Sync läuft.
- `eslint.config.mjs` selbst klammert `src/vendor/**` NICHT aus (Kern ist template-verwaltet,
  byte-gleich mit `tools/release-template/`) — die Ausnahme lebt in `eslint.overrides.mjs`.
- **Secret-ID ist nicht die rohe Endpunkt-ID.** `secretIdOf(id)` (`src/core/model.ts`) geht über
  `secretIdFor(SECRET_PREFIX, id)` (`src/vendor/kit/secrets.ts`): lowercased, `[^a-z0-9-]` wird
  zu `-` normalisiert, doppelte/führende/trailing `-` entfernt. Ein Vergleich gegen die rohe
  Endpunkt-`id` (z. B. eine UUID mit Großbuchstaben — `crypto.randomUUID()` liefert nur
  Kleinbuchstaben, ein importierter Alt-Wert aber womöglich nicht) findet den Schlüsselbund-Eintrag
  sonst nicht.
- **`apiKey` darf nie in `data.json` landen — der einzige Weg dorthin ist `toPersisted`.** Es
  entfernt `apiKey` aus jedem Eintrag, bevor `ManagerSettings` gespeichert wird. Wer Settings über
  einen anderen Pfad schreibt (z. B. testweise `plugin.saveData(rawSettings)` statt
  `toPersisted(rawSettings)`), schreibt das Token im Klartext.
- **`hide()` im Settings-Tab muss den Modell-Cache räumen**, sonst bleibt ein Endpunkt, der
  einmal als „nicht erreichbar" gemessen wurde, für den Rest der Sitzung so stehen — auch nachdem
  die URL korrigiert wurde. Umgesetzt in `src/obsidian/settings-tab.ts` `hide()`
  (`this.modelLists.clear()`), Kit-Vertrag aus `obsidian/endpoint-list`.

## Memory

- 2026-09-15: Gerüst angelegt (Task 2 des Gesamtplans `llm-endpoint-manager`). Vorlagen aus
  `../lingotuner` + `../tools/release-template`, Vendoring-Listen in `tools/sync-kit.sh` auf
  `endpoint endpoint_config endpoint_diagnostics model-choice model-list-cache timeout i18n
  settings secrets` (pure) und `confirm endpoint-list model-picker settings_walker
  folder-suggest secrets` (obsidian) umgestellt.
- 2026-09-15: restliche 11 Tasks des Plans durchlaufen — Datenmodell, `createManagerApi` (Errors
  are values), HTTP-Probe/Reachability-Cache, Settings-Tab mit Endpunkt-Liste, i18n-Strings,
  Schlüsselbund-Anbindung, GUI-Smoke (9/9 grün). Release 0.1.0 getaggt und auf Forgejo
  veröffentlicht.
- 2026-09-15 (Whole-Branch-Review): vier Important-Funde an Task-Nähten behoben — `importEndpoints`
  wirft nie mehr (Secret-Schreibfehler wird zu `{error:"secret-missing"}`, Reihenfolge
  Settings-erst-dann-Secrets verhindert verwaiste Schlüsselbund-Einträge), Modell-Cache im
  Settings-Tab wird beim Protokollwechsel gezielt invalidiert (`this.modelLists.invalidate`,
  nicht nur `handle.invalidateUrl`), README-Aussage zum `models()`-Cache korrigiert (keine TTL,
  nur der Reachability-Cache hat 30 s). Patch-Release 0.1.1.

## Abweichungen von der Leitkonvention

Keine bekannt (Stand 2026-09-15, Release 0.1.0/0.1.1).
