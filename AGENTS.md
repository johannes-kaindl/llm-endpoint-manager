# AGENTS.md

Orientierung für KI-Agenten (Claude Code, Codex, …) und Mitwirkende an diesem Repository.
Workspace-weite Standards (comply-or-explain): siehe [`../../workspace/_docs/CONVENTIONS.md`](../../workspace/_docs/CONVENTIONS.md)
(maintainer-lokal, nicht Teil dieses Repos — ignorieren, falls im Klon nicht vorhanden).

**Profil:** `ts-node` · `obsidian-plugin`.

**Stand 2026-10-16: 0.8.0 released, Claude-API-Anbieter (Welle 23) in Arbeit für 0.9.0 (Sampling-Profile-Modelltabelle seit 0.2.0); Plan 2 seit 0.1.0 released.** Alle 13 Tasks aus Plan 2 umgesetzt: Kern-Datenmodell,
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

- **Der Anbieter `anthropic` ist hinter dem Transport-Opt-in versteckt, und das ist der Schutz für ältere Plugins.** `ManagedEndpoint.transport` ist für `provider: "anthropic"` immer `"anthropic"` (`normalizeEndpointEntry`, `withProvider`), `list()` ohne `transports` und `resolve()` ohne `transports` liefern nur `http` (`autoResolvable` in `src/core/reachability.ts`). Gemessen mit einem Plugin auf Kit 0.60.1 (json-editor, Wegwerf-Klon): bekäme es den Endpunkt mit `backend: "anthropic"`, stürzte `complete()` ab (`BACKENDS[backend].fields` undefiniert), ohne `backend` ginge eine OpenAI-Anfrage mit `temperature` an Anthropic. Mit dem fertigen Manager sieht es ihn nie (Variante A: nur Claude → `no-endpoint`, Variante B: Claude vor LM Studio → LM Studio). Wer einen weiteren Anbieter mit eigener Wire-Form baut, nimmt denselben Weg (eigener Transport-Wert), nicht nur einen neuen `provider`.
- **Anthropic fragt anders:** die Probe (`probeHeaders` in `src/obsidian/http.ts`) sendet `x-api-key` und `anthropic-version` statt `Authorization: Bearer`, und `GET /v1/models?limit=1000` (ohne `limit` kommen nur 20 Modelle). Der Browser-Header `anthropic-dangerous-direct-browser-access` gehört nicht hierher, sondern in den Transport der Plugins (obsidian-kit `anthropic-transport`): `requestUrl` läuft im Hauptprozess. CORS gemessen am 2026-10-16 (Master, ohne Schlüssel, kostenlos): `OPTIONS /v1/messages` und `/v1/models` mit `Origin: app://obsidian.md` antworten 200 mit `access-control-allow-origin: *` und `access-control-allow-headers: x-api-key,anthropic-version,anthropic-dangerous-direct-browser-access,content-type`. Ob die echte Anfrage mit Schlüssel durchgeht, misst der eine Lauf mit `claude-haiku-5-5` in der Modell-Runde.
- **Die Knopfreihe der Vorlagen bricht um** (`.lem-presets` in `styles.css`, die Klasse setzt `renderEndpoints` auf die letzte Zeile, die der Kit-Editor anlegt): mit sechs Knöpfen war der letzte im 1000-px-Fenster abgeschnitten. Der Smoke-Punkt I1 prüft `flex-wrap` und dass alle Knöpfe im Fenster liegen.

- **Ein `api.on("changed")`-Listener abonniert einmal, nicht bei jedem Neuzeichnen.** `notifyChanged` iteriert über eine Kopie der Listener (seit 0.8.0); vorher lief ein Listener, der beim Melden neu abonnierte (Unsubscribe plus `on`), in eine Endlosschleife (Renderer 108 % CPU, Smoke-Timeout, Welle 22). Der Settings-Tab abonniert deshalb in `watchChanges()` nur, wenn noch kein Abo steht; eigene Speicherungen des Tabs laufen über `own()`, damit sie ihn nicht neu zeichnen.

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

## UI-Abweichungen

- **model-bar** — Grund: Das Modell-Dropdown liegt im Einstellungs-Tab des Managers (Modell-Zeilen je Endpunkt, `src/obsidian/settings-tab.ts`), nicht in einer Chat- oder LLM-Ansicht; die Kit-Modellzeile (`buildModelBar`) ist der Baustein für Ansichten, die Anfragen an ein Modell schicken, und der Manager besitzt keine (Zuständigkeit: nur Endpunkte, Modell-Listen und Beschreibung, keine Anfragen). Gemessen 2026-10-23 als Fehlalarm von `tools/ui_adoption_check.py`, deklariert 2026-10-25 (Welle 27)
  — gilt-solange: `src/obsidian/settings-tab.ts` enthaelt-nicht `buildModelBar`
