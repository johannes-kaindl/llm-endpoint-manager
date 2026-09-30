# LLM Endpoint Manager

> [🇬🇧 English](https://github.com/johannes-kaindl/llm-endpoint-manager/blob/main/README.md) · 🇩🇪 Deutsch

**Ein Ort für deine LLM-Endpunkte: URLs, Modelle, Fähigkeiten und API-Tokens im Obsidian-Schlüsselbund — über eine kleine API mit anderen Plugins geteilt.**

[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)
[![Docs: CC BY-SA 4.0](https://img.shields.io/badge/docs-CC%20BY--SA%204.0-lightgrey.svg)](LICENSE-DOCS)
[![Release](https://img.shields.io/github/v/release/johannes-kaindl/llm-endpoint-manager?label=release)](https://github.com/johannes-kaindl/llm-endpoint-manager/releases)
![Platform](https://img.shields.io/badge/platform-Obsidian%201.11.4%2B%20%C2%B7%20Desktop%20%26%20Mobil-7c3aed)

Sprechen mehrere Plugins in deinem Vault mit Sprachmodellen, fragt normalerweise jedes nach derselben Serveradresse und demselben API-Token. LLM Endpoint Manager ist der eine Ort, an dem du beides nur einmal einträgst. Tokens landen nie in der `data.json` — sie liegen ausschließlich im Obsidian-Schlüsselbund —, und andere Plugins erreichen die Endpunkt-Liste über eine kleine API. Er besitzt Endpunkte, Tokens, Modell-Listen und Erreichbarkeits-Prüfungen; von Prompts, Rollen oder Anfragen weiß er nichts, das bleibt bei den Plugins, die die API nutzen.

<img src="https://raw.githubusercontent.com/johannes-kaindl/llm-endpoint-manager/main/docs/images/hero.png" width="820" alt="Das Einstellungsfenster von LLM Endpoint Manager: eine Endpunkt-Liste mit LM Studio auf erreichbar Platz 1 und Ollama auf Platz 2, je mit grünem Status-Indikator, Protokoll, Fähigkeiten-Schaltern und Aktiv-Schalter">

## Features

- **Eine Endpunkt-Liste für alle Plugins** — URL, Protokoll (OpenAI-kompatibel, Ollama, Automatic1111, ComfyUI), Fähigkeiten (`chat`, `embedding`, `vision`, `image`), Standardmodell und ein Schalter je Endpunkt. Die Reihenfolge ist die Priorität: ein Plugin bekommt den ersten aktiven, erreichbaren Endpunkt, der kann, was es braucht.
- **Tokens im Schlüsselbund, nie in deinen Notizen** — das Token-Feld schreibt direkt in den Obsidian-Schlüsselbund (Obsidian 1.11.4+). Ohne funktionierenden Schlüsselbund ist das Feld gesperrt und sagt warum; Endpunkte ohne Token funktionieren weiter.
- **Erreichbarkeit live** — jede Zeile zeigt einen Status-Indikator und beim Darüberfahren den Grund (Verbindung abgelehnt, Host nicht gefunden, Zeitüberschreitung, „antwortet, aber nicht wie eine Modell-API", Token abgelehnt). „Verbindungen prüfen“ testet alle Zeilen neu.
- **Modelltabelle** — je Endpunkt jedes Modell, das der Server meldet, plus die bereits konfigurierten. Setze die **Familie** eines Modells (aus dem Namen wird ein Vorschlag gemacht) und markiere es als **andere Schreibweise** einer zweiten Modell-ID, damit Plugins die ID senden, die du willst.
- **Backend-Erkennung** — „Erkennen“ erkennt LM Studio, Ollama, Open WebUI oder einen schlichten OpenAI-kompatiblen Server mit rein lesenden Anfragen; es lädt nie ein Modell.
- **Sehen, wer ihn nutzt** — der Einstellungs-Tab listet, welche Plugins in dieser Sitzung nach einem Endpunkt gefragt haben und für welche Fähigkeit.

<img src="https://raw.githubusercontent.com/johannes-kaindl/llm-endpoint-manager/main/docs/images/endpoints.png" width="820" alt="Die untere Endpunkt-Liste: eine Ollama-Zeile, erreichbar auf Platz 2, eine Zeile Office server mit rotem Indikator, gespeichertem Token und dem Vermerk nicht erreichbar, darunter Hinzufüge-Feld und Preset-Knöpfe LM Studio, Ollama, OpenAI-compatible cloud und Check connections">

<img src="https://raw.githubusercontent.com/johannes-kaindl/llm-endpoint-manager/main/docs/images/models.png" width="820" alt="Die Gruppe Models für einen LM-Studio-Endpunkt: vier Modelle mit Familien-Auswahl, ein Familien-Vorschlag, ein Modell als andere Schreibweise von qwen/qwen3.8-27b und die Backend-Zeile LM Studio mit Detect-Knopf">

<img src="https://raw.githubusercontent.com/johannes-kaindl/llm-endpoint-manager/main/docs/images/consumers.png" width="820" alt="Die Gruppen API tokens und Plugins using these endpoints: der Schlüsselbund-Hinweis und zwei anfragende Plugins, Vault Search für Embedding und Notes Assistant für Chat, je mit Uhrzeit">

## Voraussetzungen

- **Obsidian 1.11.4+** (Desktop und Mobile). Der Schlüsselbund braucht diese Version; ältere können keine Tokens speichern.
- **Ein erreichbarer Modell-Server** — etwa [LM Studio](https://lmstudio.ai) oder [Ollama](https://ollama.com) auf deinem Rechner, oder eine gehostete OpenAI-kompatible API, wenn du ihr Token einträgst. Neu bei lokalen LLMs? Der **[Setup-Guide für lokale LLMs](https://uplink.jkaindl.de/llm-setup)** deckt Server-Setup, die Endpunkt-Adresse samt `/v1`-Frage und den Zugriff vom Handy ab.
- **Mindestens ein Plugin, das die API nutzt.** Der Manager läuft für sich, speichert und prüft aber nur Endpunkte — mehr tut er nicht, bis ein anderes Plugin einen anfragt.

## Installation

### Plugin-Katalog (empfohlen)

[AnySource Sideloader](https://git.jkaindl.de/jkaindl/anysource-sideloader) installieren, den Katalog `https://git.jkaindl.de/jkaindl/obsidian-catalog/raw/branch/main/catalog.json` hinzufügen, dort **LLM Endpoint Manager** installieren und unter **Einstellungen → Community-Plugins** aktivieren. Oder lade `llm-endpoint-manager.zip` aus dem Release — es enthält genau diese Dateien — und entpacke es nach `.obsidian/plugins/`; mit `checksums.sha256` prüfst du den Download.

### Manuell

`main.js`, `manifest.json` und `styles.css` aus dem [letzten Release](https://github.com/johannes-kaindl/llm-endpoint-manager/releases) nach `<vault>/.obsidian/plugins/llm-endpoint-manager/` legen und **LLM Endpoint Manager** unter **Einstellungen → Community-Plugins** aktivieren.

### Aus dem Quellcode

```bash
git clone https://github.com/johannes-kaindl/llm-endpoint-manager
cd llm-endpoint-manager && npm install && npm run build
# main.js, manifest.json und styles.css nach <vault>/.obsidian/plugins/llm-endpoint-manager/ kopieren
```

## Verwendung

Das Plugin hat weder Befehle noch ein Ribbon-Icon; alles passiert unter **Einstellungen → LLM Endpoint Manager**.

1. Unter **Endpunkte** eine Adresse in das Feld **Endpunkt hinzufügen: http://localhost:1234** tippen und aus dem Feld herausklicken (Zeilen werden gespeichert, sobald ein Feld den Fokus verliert) — oder einen Preset-Knopf klicken (**LM Studio**, **Ollama**, **OpenAI-compatible cloud**).
2. **Protokoll** und **Fähigkeiten** der Zeile prüfen. Eine Zeile ohne Fähigkeit ist für jedes Plugin unsichtbar und zeigt eine Warnung.
3. Optional: ein **API-Token (optional)** in die Zeile einfügen. Es geht in den Schlüsselbund; die Zeile zeigt dann **Token gespeichert**.
4. Den Status-Indikator lesen: **erreichbar, Platz 1** heißt, das ist die erste Wahl für ein Plugin (bei der Fähigkeit, die es anfragt); **erreichbar, Platz 2** heißt, ein besserer steht davor. Mit **Zuerst verwenden** änderst du die Reihenfolge.
5. Unter **Modelle** die Modell-Liste je Endpunkt prüfen, bei falschem Vorschlag die **Familie** setzen und mit **Erkennen** das **Backend** ausfüllen.

### Konfiguration

| Einstellung | Wirkung | Standard |
|---|---|---|
| Adresse | Basis-URL des Servers. Ein abschließendes `/v1` wird automatisch entfernt. | — |
| Bezeichnung | Name in diesem Tab und für andere Plugins. | aus der Adresse abgeleitet |
| Protokoll | Wire-Format: OpenAI-kompatibel, Ollama, Automatic1111 (Bild), ComfyUI (Bild). | OpenAI-kompatibel |
| Fähigkeiten | `chat`, `embedding`, `vision`, `image` — wozu der Endpunkt taugt. | `chat` (Presets setzen mehr) |
| Aktiv | Deaktivierte Endpunkte bekommt nie ein Plugin. | an |
| API-Token | Im Obsidian-Schlüsselbund, nie in `data.json`. | keins |
| Standardmodell | Hinweis, den Plugins nutzen dürfen; jedes Plugin entscheidet selbst. | leer |
| Familie (je Modell) | Zu welcher Modellfamilie ein Modell gehört. | aus dem Namen vorgeschlagen |
| Andere Schreibweise von (je Modell) | Modell-ID, die Plugins stattdessen senden. | leer |
| Backend (je Endpunkt) | Server-Software; **Erkennen** füllt es aus. | nicht gesetzt |

## Funktionsweise

Der Manager hält die Endpunkt-Liste in der `data.json` des Plugins — ohne Tokens — und die Tokens im Obsidian-Schlüsselbund. Will ein Plugin mit einem Modell sprechen, fragt es den Manager nach einer Fähigkeit; der prüft die Erreichbarkeit (30 Sekunden zwischengespeichert, damit ein Dutzend Plugins, die nach einem Server fragen, kein Dutzend Anfragen auslösen), geht die Liste in deiner Reihenfolge durch und gibt den ersten aktiven, erreichbaren Endpunkt mit einer gebrauchsfertigen Basis-URL zurück. Prompts sendet er nie selbst. Der Code-Aufbau steht in der [`AGENTS.md`](https://github.com/johannes-kaindl/llm-endpoint-manager/blob/main/AGENTS.md).

## Dokumentation

- [Doku-Index](https://github.com/johannes-kaindl/llm-endpoint-manager/blob/main/docs/README.md) (Englisch)
- [Erste Schritte](https://github.com/johannes-kaindl/llm-endpoint-manager/blob/main/docs/getting-started.md) — von der Installation bis zum ersten funktionierenden Endpunkt (Englisch)
- [Fehlerbehebung](https://github.com/johannes-kaindl/llm-endpoint-manager/blob/main/docs/troubleshooting.md) — was eine Meldung bedeutet und was zu tun ist (Englisch)

## API

Die API für andere Plugins ist unter [API in der englischen README](https://github.com/johannes-kaindl/llm-endpoint-manager/blob/main/README.md#api) beschrieben: `app.plugins.plugins["llm-endpoint-manager"].api`, Methoden `list`, `get`, `resolve`, `materialize`, `models`, `importEndpoints`, `on`. Fehler sind Werte, keine Exceptions. **Tokens überqueren die API nie in einer Auflistung** — `list()` und `get()` liefern nur ein `hasSecret`-Flag; nur `resolve()` und `materialize()` geben das Token an einen Aufrufer, der es ausdrücklich für eine Anfrage braucht.

## Mitwirken

Issues und Pull Requests auf [GitHub](https://github.com/johannes-kaindl/llm-endpoint-manager/issues). Test-getrieben (`npm run gate`); siehe [`AGENTS.md`](https://github.com/johannes-kaindl/llm-endpoint-manager/blob/main/AGENTS.md).

## Lizenz

- **Code:** AGPL-3.0-or-later ([`LICENSE`](LICENSE)).
- **Docs/Text:** CC BY-SA 4.0 ([`LICENSE-DOCS`](LICENSE-DOCS)).

Copyright © 2026 Johannes Kaindl.
