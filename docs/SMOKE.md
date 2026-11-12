# GUI-Smoke — llm-endpoint-manager

Faehrt die 26 Pruefpunkte (Soll-Liste `PUNKTE` im Treiber) gegen ein LAUFENDES Obsidian (CDP, CORE-TEST-02 b): Schluesselbund
(A1-A5), API gegen einen im Treiber selbst laufenden Fake-Endpunkt (B1-B3), Restricted-Mode-
Guard einer frischen Zweitinstanz (C1) und Aufräumprüfung (C2), Modellblock und Familie (D1-D3), Zusatzzeile (E1), Hilfe-Zeile (F1), Apple Intelligence (G1-G2), verwaiste Schlüssel (H1), Claude-API (I1-I3), Fokus und Scrollposition beim Neuzeichnen (J1-J2), Hinweis zu `embedding` an einem Chat-Modell (K1-K3). Treiber: `scripts/gui-smoke.ts`.

## Voraussetzung

`STAGING_VAULTS_DIR` gesetzt (Dach-`AGENTS.md` § Staging-Vaults), CDP-Lock-Skript verfuegbar
(`~/.claude/hooks/obsidian-cdp-lock.py`).

## Lauf — Zweitinstanz (eigenes Profil, eigener Port)

```bash
npm run build && npm run smoke:gui -- --setup
UD=/tmp/obs-test-llm-endpoint-manager; mkdir -p "$UD"
lsof -nP -iTCP:9395 -sTCP:LISTEN && echo "Port belegt — anderen nehmen"
node -e 'const p=process.env.STAGING_VAULTS_DIR+"/llm-endpoint-manager";require("fs").writeFileSync(process.argv[1]+"/obsidian.json",JSON.stringify({vaults:{"llm-endpoint-manager":{path:p,ts:Date.now(),open:true}}}))' "$UD"
pgrep -f "user-data-dir=$UD" && echo "Profil belegt — auf $UD-w19 ausweichen, nie beenden"
cp ~/Library/Application\ Support/obsidian/obsidian-*.asar "$UD"/   # aktuelle Version, nicht die gebuendelte
/Applications/Obsidian.app/Contents/MacOS/Obsidian --user-data-dir="$UD" --remote-debugging-port=9395 &
python3 ~/.claude/hooks/obsidian-cdp-lock.py acquire --label llm-endpoint-manager --intent "GUI-Smoke :9395" --exclusive focus --port 9395 --ttl 300
npm run smoke:gui -- --port 9395
python3 ~/.claude/hooks/obsidian-cdp-lock.py release
```

Ein frisches Profil startet im Restricted Mode und fragt nach dem Vertrauen in den Vault;
`bereiteInstanzVor` (zentrale Brücke) bestätigt den Dialog und schaltet den Modus frei, bevor
irgendetwas gemessen wird, C1 trägt ihren Hinweis im Detail. `--port` ist Pflicht. Die Bilanz
zählt in vier Zuständen (grün · rot · übersprungen · nichts gemessen), Nenner ist die Soll-Liste;
ein Abbruch endet mit Exit 2. Je Messlauf ein frischer Prozess, der erste Lauf nach der
Profilanlage ist ein Aufwärmlauf. Bei jedem Lauf wird das Plugin vorher per
`disablePlugin`/`enablePlugin` neu geladen, damit ein frisch deploytes Bundle auch wirklich
greift (Obsidian haelt `main.js` sonst im Speicher).

## Die Pruefpunkte

| # | Prüft |
|---|---|
| C1 | Restricted-Mode-Guard: `app.plugins.setEnable(true)` schaltet ein frisches Profil frei, danach ist das Plugin geladen. |
| A1 | Settings-Tab öffnet, Abschnitt „LLM-Endpunkte" vorhanden, Adder-Zeile leer. |
| A2 | Preset „LM Studio" klicken → Zeile `http://localhost:1234`, Provider `openai`, Fähigkeiten chat/vision gesetzt, kein `embedding` (seit Welle 33). |
| A3 | Token `sk-test` setzen → `app.secretStorage.getSecret(secretId)` liefert `sk-test`, `data.json` im Vault enthält kein `sk-test`, Zeile zeigt „Token gespeichert" (DE) / „token saved" (EN). |
| A4 | Token entfernen (Knopf per `aria-label` getroffen, nicht Position) → Secret ist leer, Zeile zeigt wieder ein Passwortfeld. |
| A5 | Endpunkt entfernen → Secret ist leer, Endpunktliste leer. |
| B1 | `api.list({capability:"embedding"})` gegen den Mini-HTTP-Server des Treibers (`startFakeEndpoint`, koda-agent-Muster) → genau der Eintrag mit dieser Fähigkeit. |
| B2 | `api.resolve("chat", {caller:"gui-smoke"})` → `config.url` zeigt auf den Fake-Server; Konsumenten-Übersicht im Settings-Tab zeigt nach Re-Render „gui-smoke — chat" / „gui-smoke — Chat". |
| B3 | Fake-Server stoppen → `api.resolve("chat")` liefert `{error:"no-endpoint"}`; **innerhalb der TTL (30 s)**, auch nachdem der Server auf demselben Port wieder läuft, bleibt es bei `no-endpoint` (Reachability-Cache hält das negative Ergebnis); `api.models(id, {force:true})` — ein UNABHÄNGIGER Cache ohne TTL-Bindung an `resolve()` — liefert danach wieder die Modell-Liste des Servers. |
| C2 | Keine liegen gebliebenen Test-Endpunkte aus einem abgebrochenen Vorlauf in den Einstellungen. |
| D1 | Modellblock sichtbar: Zeile für `verdigado-pro`. |
| D2 | Familie für ein Alias setzen → nach Neuladen der Einstellungen steht sie wieder da. |
| D3 | „Erkennen“ gegen ein Fake-LM-Studio liefert `lmstudio` (nur Lesen, kein Modell-Load). |
| E1 | Zusatzzeile eines Endpunkts: Bezeichnung, Protokoll, Fähigkeiten und Aktiv sind sichtbar beschriftet. |
| F1 | Hilfe-Zeile ist die erste Zeile, sichtbar, mit „Open documentation“ und Bug-Knopf. |
| G1 | Preset „Apple Intelligence (on-device)“ → Zeile mit `transport=shortcuts`, Kurzbefehl-Name, kein HTTP-Ziel, Modellzeile `apple-fm` (displayFamily) und Modellblock aus Kit-Daten. |
| G2 | Filter-Default: `list()` ohne `transports`-Opt-in zeigt den Apple-Shortcuts-Eintrag nicht, `list({transports:["shortcuts"]})` zeigt ihn, `resolve()` bleibt bei `http`; der Opt-in-Eintrag trägt displayFamily `apple-fm`. |
| H1 | Verwaiste Schlüsselbund-Einträge: Zeile mit Zahl und Knopf „Clean up“, Bestätigung, danach Eintrag gelöscht und Zeile weg. |
| I1 | Preset „Anthropic (Claude API)“ → Zeile mit provider/transport/backend `anthropic`, chat+vision, Hinweis zum Schlüssel sichtbar; die Knopfreihe der Vorlagen bricht um und liegt ganz im Fenster. |
| I2 | Claude-Endpunkt gegen den Anthropic-Stub: Schlüssel setzen → Status grün, Modelle aus `/v1/models`, der Stub sah `x-api-key` und `anthropic-version`; `list()`/`resolve()` ohne Opt-in zeigen ihn nie, mit Opt-in ja. |
| I3 | Ungültiger Schlüssel → Status rot mit dem Text „Access denied — API key missing or invalid.“ (EN) bzw. dem deutschen Gegenstück. |
| J1 | URL in einer unteren Endpunkt-Zeile tippen, dann das Schlüsselfeld anklicken: Eingabe übernommen, Scrollposition bleibt, Fokus liegt im Schlüsselfeld derselben Zeile. |
| J2 | URL in einer unteren Endpunkt-Zeile tippen, dann neben das Feld tippen (kein Feld): Eingabe übernommen, Scrollposition bleibt, der Fokus springt nicht in ein Feld der ersten Zeile. |
| K1 | `embedding` an einem Chat-Modell → roter Hinweis unter den Fähigkeiten mit dem Modellnamen; den Modelltyp nennt der Server (Fake-LM-Studio mit `llm` und `embedding`), nie der Name. |
| K2 | `embedding` an einem Embedding-Modell desselben Servers → kein Hinweis; der Server wurde für beide Zeilen gefragt (Zahl der Anfragen an `/api/v1/models` im Detail). |
| K3 | `embedding` an einem Modell, dessen Server nicht antwortet → gelber Hinweis „nicht prüfbar“, kein roter. |

Jeder Punkt zählt in der CORE-TEST-19-Bilanz (grün/rot/übersprungen). 0 übersprungene sind
Pflicht für ein vollständiges Ergebnis.

### Warum B3 zwei Server-Neustarts braucht

`api.resolve()` benutzt die `ReachabilityCache` aus `src/core/reachability.ts` — ein einmal
gecachtes Ergebnis (positiv wie negativ) gilt für `REACHABILITY_TTL_MS` (30 s), unabhängig
davon, ob der Server inzwischen wieder erreichbar ist. `api.models()` hängt dagegen an einem
komplett getrennten Cache (`model-list-cache` in `src/core/api.ts`) und probt bei `force:true`
immer live. Der Treiber nutzt das bewusst aus, um beide Cache-Schichten getrennt zu zeigen:

1. Fake-Server stoppen, Cache-Eintrag der URL explizit invalidieren (`handle.invalidateUrl` —
   genau das, was jede Endpunkt-Mutation in der Settings-UI ohnehin auslöst) → `resolve("chat")`
   probt frisch gegen den toten Server → `no-endpoint`.
2. Denselben Port wieder öffnen, **ohne** den Cache erneut zu invalidieren → `resolve("chat")`
   liest weiter den (jetzt veralteten) negativen Cache-Eintrag → immer noch `no-endpoint`,
   obwohl der Server längst wieder antwortet.
3. `api.models(id, {force:true})` gegen denselben, jetzt laufenden Server → liefert die
   Modell-Liste, weil dieser Aufruf den Reachability-Cache nie befragt.

## Gegenprobe (Pflicht, Step 2 im Task-Brief)

Beleg, dass B3 wirklich die TTL/Cache-Semantik misst und nicht zufällig grün ist: `REACHABILITY_TTL_MS`
in `src/core/reachability.ts` testweise auf `0` gesetzt (Cache-Einträge laufen sofort ab),
gebaut, ins Staging-Vault deployt, Lauf wiederholt — danach zurückgesetzt und erneut grün
verifiziert. Beide Läufe gegen dieselbe Zweitinstanz (Port 9395), Plugin vor jedem Lauf per
`disablePlugin`/`enablePlugin` neu geladen.

**Lage 1 — TTL = 30 000 ms (Normalzustand):** 9/9 grün, 0 übersprungen (Stand der Gegenprobe: damals 9 Punkte; die Soll-Liste hat heute 26).

**Lage 2 — TTL = 0 ms (Gegenprobe):** genau B3 kippt auf rot — alle anderen 8 Punkte bleiben
grün. Detail des roten B3:

```
stop→{"error":"no-endpoint"}
restart-in-TTL→{"id":"…","label":"gui-smoke fake","config":{"url":"http://127.0.0.1:…"}}
models(force)→["smoke-model"]
```

Mit TTL 0 läuft jeder Cache-Eintrag sofort ab — der zweite `resolve("chat")`-Aufruf (Schritt 2
oben, Server wieder erreichbar, Cache absichtlich NICHT invalidiert) probt deshalb frisch statt
den veralteten negativen Eintrag zu lesen, findet den wieder laufenden Server und liefert ein
erfolgreiches Ergebnis statt `no-endpoint`. Der Punkt erwartet aber bewusst weiterhin
`no-endpoint` an dieser Stelle (das ist die zu prüfende Cache-Eigenschaft) — mit TTL 0 stimmt
diese Erwartung nicht mehr, B3 wird rot. Das belegt: B3 misst tatsächlich das TTL-Verhalten des
Reachability-Caches, nicht irgendein Zufallsergebnis.

Zurückgesetzt auf `30_000`, neu gebaut, deployt, erneut 9/9 grün bestätigt (dritter Lauf, damaliger Umfang).

## Bekannte Randbedingungen

- Settings können ab Obsidian 1.13 ein eigenes Fenster ohne `window.app` sein oder (davor) ein
  Modal im Hauptfenster — der Treiber unterscheidet über `settingsStelle()`
  (Modal-vs-eigenes-Fenster-Muster aus `anysource-sideloader/scripts/gui-smoke.ts`).
- Icon-Knöpfe (Token ändern/entfernen, Endpunkt entfernen) werden über ihr `aria-label`
  getroffen, nicht über ihre Position in der Zeile — der Modell-Refresh-Knopf lädt asynchron
  nach und verschiebt sonst die Reihenfolge der `.clickable-icon`-Elemente.
- `data.json` wird nur geprüft, wenn `STAGING_VAULTS_DIR` gesetzt ist (A3); ohne die Variable
  bleibt der Punkt trotzdem messbar (Schlüsselbund + UI-Text), nur die Datei-Halbmessung entfällt
  mit Begründung im Detailtext.
