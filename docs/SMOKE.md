# GUI-Smoke — llm-endpoint-manager

Faehrt neun Pruefpunkte gegen ein LAUFENDES Obsidian (CDP, CORE-TEST-02 b): Schluesselbund
(A1-A5), API gegen einen im Treiber selbst laufenden Fake-Endpunkt (B1-B3), Restricted-Mode-
Guard einer frischen Zweitinstanz (C1). Treiber: `scripts/gui-smoke.ts`.

## Voraussetzung

`STAGING_VAULTS_DIR` gesetzt (Dach-`AGENTS.md` § Staging-Vaults), CDP-Lock-Skript verfuegbar
(`~/.claude/hooks/obsidian-cdp-lock.py`).

## Lauf — Zweitinstanz (eigenes Profil, eigener Port)

```bash
npm run build && npm run smoke:gui -- --setup
UD=/tmp/obs-test-llm-endpoint-manager; mkdir -p "$UD"
lsof -nP -iTCP:9346 -sTCP:LISTEN && echo "Port belegt — anderen nehmen"
node -e 'const p=process.env.STAGING_VAULTS_DIR+"/llm-endpoint-manager";require("fs").writeFileSync(process.argv[1]+"/obsidian.json",JSON.stringify({vaults:{"llm-endpoint-manager":{path:p,ts:Date.now(),open:true}}}))' "$UD"
cp ~/Library/Application\ Support/obsidian/obsidian-*.asar "$UD"/   # aktuelle Version, nicht die gebuendelte
/Applications/Obsidian.app/Contents/MacOS/Obsidian --user-data-dir="$UD" --remote-debugging-port=9346 &
python3 ~/.claude/hooks/obsidian-cdp-lock.py acquire --label llm-endpoint-manager --intent "GUI-Smoke" --exclusive focus --ttl 300
npm run smoke:gui -- --port 9346
python3 ~/.claude/hooks/obsidian-cdp-lock.py release
```

Ein frisches Profil startet im Restricted Mode; C1 schaltet ihn per `app.plugins.setEnable(true)`
frei, bevor irgendetwas anderes gemessen wird. Bei jedem Lauf wird das Plugin vorher per
`disablePlugin`/`enablePlugin` neu geladen, damit ein frisch deploytes Bundle auch wirklich
greift (Obsidian haelt `main.js` sonst im Speicher).

## Die 9 Pruefpunkte

| # | Prüft |
|---|---|
| C1 | Restricted-Mode-Guard: `app.plugins.setEnable(true)` schaltet ein frisches Profil frei, danach ist das Plugin geladen. |
| A1 | Settings-Tab öffnet, Abschnitt „LLM-Endpunkte" vorhanden, Adder-Zeile leer. |
| A2 | Preset „LM Studio" klicken → Zeile `http://localhost:1234`, Provider `openai`, Fähigkeiten chat/vision/embedding gesetzt. |
| A3 | Token `sk-test` setzen → `app.secretStorage.getSecret(secretId)` liefert `sk-test`, `data.json` im Vault enthält kein `sk-test`, Zeile zeigt „Token gespeichert" (DE) / „token saved" (EN). |
| A4 | Token entfernen (Knopf per `aria-label` getroffen, nicht Position) → Secret ist leer, Zeile zeigt wieder ein Passwortfeld. |
| A5 | Endpunkt entfernen → Secret ist leer, Endpunktliste leer. |
| B1 | `api.list({capability:"embedding"})` gegen den Mini-HTTP-Server des Treibers (`startFakeEndpoint`, koda-agent-Muster) → genau der Eintrag mit dieser Fähigkeit. |
| B2 | `api.resolve("chat", {caller:"gui-smoke"})` → `config.url` zeigt auf den Fake-Server; Konsumenten-Übersicht im Settings-Tab zeigt nach Re-Render „gui-smoke — chat" / „gui-smoke — Chat". |
| B3 | Fake-Server stoppen → `api.resolve("chat")` liefert `{error:"no-endpoint"}`; **innerhalb der TTL (30 s)**, auch nachdem der Server auf demselben Port wieder läuft, bleibt es bei `no-endpoint` (Reachability-Cache hält das negative Ergebnis); `api.models(id, {force:true})` — ein UNABHÄNGIGER Cache ohne TTL-Bindung an `resolve()` — liefert danach wieder die Modell-Liste des Servers. |

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
verifiziert. Beide Läufe gegen dieselbe Zweitinstanz (Port 9346), Plugin vor jedem Lauf per
`disablePlugin`/`enablePlugin` neu geladen.

**Lage 1 — TTL = 30 000 ms (Normalzustand):** 9/9 grün, 0 übersprungen.

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

Zurückgesetzt auf `30_000`, neu gebaut, deployt, erneut 9/9 grün bestätigt (dritter Lauf).

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
