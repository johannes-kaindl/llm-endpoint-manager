// vendored from obsidian-kit@0.43.0, src/obsidian/endpoint-list.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
// ONE mechanical deviation from verbatim: kit-internal imports (../pure/ and ../vendor/code-kit/{pure,web}/) → ../kit/ (vendor layout); reproduce on every re-vendor, nothing else may differ.
/* Geordneter Endpunkt-Fallback-Listen-Editor: eine Setting-Zeile je Endpunkt (URL ·
 * Schlüssel · Modell-Override · „zuerst verwenden" · entfernen) plus Adder-Zeile,
 * Status-Icon, Rollenzeile, Drittanbieter-Hinweis und Preset-Knöpfe.
 *
 * Herkunft: vault-rag/src/settings.ts (buildEndpointList, 0.19.x, 274 Zeilen, zwei
 * Aufrufstellen: Chat + Embedding). Umzug ohne Verhaltensänderung. Abweichungen zur
 * Vorlage: alle Texte kommen über `strings` aus `opts` (das Kit formuliert nicht),
 * Modell-Cache und Tab-Neuaufbau sind Callbacks statt Tab-Zustand, CSS-Präfix `okit-`. */
import { Notice, Setting, setIcon, setTooltip } from "obsidian";
import { renderModelPicker } from "./model-picker";
import { resolveModelChoice } from "../kit/model-choice";
import type { ModelHintKey } from "../kit/model-choice";
import type { ModelListCache, ModelListClient } from "../kit/model-list-cache";
import { normalizeEndpoint } from "../kit/endpoint";
import { applyEndpointEdit, carriesApiKey, endpointRole, moveEndpointToFront } from "../kit/endpoint_config";
import type { EndpointConfig, EndpointRole } from "../kit/endpoint_config";
import { ENDPOINT_PRESETS, validateEndpointInput } from "../kit/endpoint_diagnostics";
import type { EndpointPreset, EndpointStatus, EndpointWarning } from "../kit/endpoint_diagnostics";

/** Jeder benutzersichtbare Text dieser Komponente. Das Kit formuliert nichts selbst —
 *  Sprache, Tonfall und Übersetzung gehören dem Consumer. */
export interface EndpointListStrings {
  addPlaceholder: string;
  apiKeyPlaceholder: string;
  modelPlaceholder: string;
  /** `aria-label` der URL-Felder bestehender Einträge. Stehen MEHRERE Listen auf demselben
   *  Settings-Tab (vault-rag: Chat und Embedding), braucht jede Liste ihren eigenen Text —
   *  ein gemeinsam genutztes `strings`-Objekt gäbe allen URL-Feldern beider Listen dasselbe
   *  Label, und ein Screenreader könnte sie nicht mehr auseinanderhalten. In der Vorlage war
   *  der Text aus `opts.label` abgeleitet; das Kit formuliert nicht, also entscheidet das
   *  der Consumer. */
  ariaUrl: string;
  /** `aria-label` des leeren Add-Felds am Listenende. Dieselbe Pflicht wie `ariaUrl`:
   *  je Liste unterschiedlich, wenn mehrere Listen auf einem Tab stehen. */
  ariaAdd: string;
  ariaApiKey(url: string): string;
  ariaModel(url: string): string;
  /** Beschriftung der Leer-Option des Modell-Dropdowns („nimm das globale Modell").
   *  `globalModel` kann LEER sein — ist global kein Modell gesetzt, steht sonst
   *  „globales Modell ()" in der Oberfläche. Die Vorlage hatte dafür einen Fallback
   *  (`globalModel() || "nicht gesetzt"`); der gehört jetzt dem Consumer, weil der
   *  Ersatztext ein Satz in seiner Sprache ist. */
  /** Nur nötig, wenn `globalModel` gesetzt ist — ohne globales Feld gibt es keine Leer-Option
   *  zu beschriften. */
  emptyModelLabel?(globalModel: string): string;
  modelHint(key: ModelHintKey): string;
  savedSuffix: string;
  refreshModels: string;
  moveToFront: string;
  remove: string;
  thirdParty: string;
  probing: string;
  statusTooltip(status: EndpointStatus): string;
  role(role: EndpointRole): string;
  warnings(warnings: EndpointWarning[]): string;
  presetTooltip(preset: EndpointPreset): string;
  presetLabel(preset: EndpointPreset): string;
  checkConnection: string;
  saveFailed: string;
  /** Nur mit `secret`-Hook: Zustandstext und Knöpfe des Schlüsselfelds. */
  secretSaved?: string;
  secretChange?: string;
  secretClear?: string;
  secretUnavailable?: string;
}

/** Schlüssel-Hook: der Consumer hält das Token woanders (Obsidian-Schlüsselbund, Kit-Modul
 *  `secrets`) — die Liste schreibt dann NIE in `cfg.apiKey`, sondern ruft diese vier. Fehlt der
 *  Hook, gilt das bisherige Verhalten (Passwortfeld → `apiKey` in der Liste). */
export interface EndpointSecretHook<T extends EndpointConfig = EndpointConfig> {
  available: boolean;
  has(cfg: T, index: number): boolean;
  set(cfg: T, index: number, value: string): Promise<void>;
  clear(cfg: T, index: number): Promise<void>;
}

export interface EndpointListOptions<T extends EndpointConfig = EndpointConfig> {
  containerEl: HTMLElement;
  label: string;
  desc: string;
  placeholder: string;
  strings: EndpointListStrings;
  /** Modell-Listen je Endpunkt + Generationszähler. Gehört der Lebensdauer des
   *  Settings-Tabs, nicht dieser Funktion — deshalb von außen. */
  cache: ModelListCache;
  get(): T[];
  set(eps: T[]): void;
  active(): string | null;
  /** Client GENAU dieser Zeile (URL + Schlüssel der Zeile) — trägt sowohl die Erreichbarkeits-
   *  Probe (Status-Icon) als auch die Modell-Liste (Dropdown). EIN Client statt zwei getrennt
   *  parametrierten Konstruktionen, damit Status-Icon und Modell-Liste nie über dieselbe Zeile
   *  auseinanderlaufen können.
   *
   *  Reihenfolge der Intersection ist bedeutungstragend: `ModelListClient.probe()` liefert nur
   *  `{ reachable }`, diese Zeile den vollen `EndpointStatus` (Diagnose-Klartext fürs Icon).
   *  TypeScript löst eine Methoden-Intersection als Überladungsliste in Schreibreihenfolge auf —
   *  stünde `ModelListClient` vorn, käme am Aufruf die schmalere Signatur heraus. */
  clientFor(cfg: T): { probe(): Promise<EndpointStatus> } & ModelListClient;
  /** Globales Modell, das gilt, wenn die Zeile keinen Override trägt.
   *
   *  **Optional, und das Fehlen ist eine Aussage.** Fehlt der Callback, gibt es kein globales
   *  Modellfeld: das Zeilen-Modell ist die einzige Wahrheit, und die Leer-Option des Dropdowns
   *  („nimm das globale") entfällt — sie hätte nichts mehr zu bedeuten. `emptyModelLabel` wird
   *  dann nie gerufen.
   *
   *  Bis 0.29.0 war der Callback **Pflicht**, und das war ein Konstruktionsfehler: ein Modellname
   *  existiert nur auf dem Endpunkt, der ihn in `/v1/models` meldet — auf der Nachbarzeile ist er
   *  bedeutungslos. „Globales Modell + Override je Zeile" ist dieselbe Information an zwei Orten
   *  plus Vorrangregel, und der Leerwert wird dabei still bedeutungstragend. Das Kit hat diese
   *  Struktur nicht erfunden, sondern von seinen ersten Konsumenten geerbt und im Vertrag
   *  festgeschrieben — womit sie jeder neue Konsument erbte, auch wer nie ein globales Feld hatte
   *  (belegt an vault-crews, das 2026-08-14 einen Wert übergeben musste, den es nicht hat). */
  globalModel?(): string;
  /** Nur Embedding-Listen: passt das (Override-)Modell dieser Zeile zum geladenen Index?
   *  Fehlt der Callback (Chat-Liste), gilt true — dort hängt kein Index am Modell. */
  modelFits?(cfg: T): boolean;
  save(): Promise<void>;
  reconnect(): Promise<void>;
  rerender(): void;
  presets?: readonly EndpointPreset[];
  secret?: EndpointSecretHook<T>;
  /** Zusatz-Slot je echter Zeile (nicht am Adder): der Consumer zeichnet eigene Felder in
   *  `host` (ein `div.okit-ep-extra` unter der Rollenzeile). Für Einträge mit mehr Feldern als
   *  `EndpointConfig` — der Listen-Editor bleibt für URL/Schlüssel/Modell/Reihenfolge zuständig. */
  extraRow?(host: HTMLElement, cfg: T, index: number): void;
}

/** Rendert `[...endpoints, Adder]` (leeres Add-Feld), Label/Desc als eigene Zeile davor.
 *  Mutation NUR bei blur (nicht pro Tastendruck), via applyEndpointEdit → save → reconnect →
 *  Re-Render. Pro echtem Eintrag: Status-Icon (loader → check/x, aktiver Endpunkt markiert),
 *  URL-, Schlüssel- (maskiert) und Modell-Feld + Mülleimer. */
export function buildEndpointList<T extends EndpointConfig = EndpointConfig>(opts: EndpointListOptions<T>): void {
  const eps = opts.get();
  const rows: EndpointConfig[] = [...eps, { url: "" }];   // leeres Zusatzfeld am Ende
  // Jede Mutation, die die Listen-FORM ändert (URL-Edit, Mülleimer, Preset), macht die
  // gerenderten Zeilen-Indizes stale — bis der Re-Render kommt, wäre ein blur in einer anderen
  // Zeile auf den falschen Eintrag gebucht (im schlimmsten Fall ein Anbieter-Schlüssel am
  // falschen Host). Darum: Zeilen sofort sperren, das Re-Render entsperrt durch Neuaufbau.
  /** Sperr-ZUSTAND des Containers. Die Klasse sperrt auch die Icon-Buttons (Obsidian rendert sie
   *  als div, das kein `disabled` kennt), `aria-busy` sagt es Screenreadern. */
  const setLockState = (locked: boolean): void => {
    if (locked) opts.containerEl.addClass("okit-ep-busy");
    else opts.containerEl.removeClass("okit-ep-busy");
    opts.containerEl.setAttribute("aria-busy", locked ? "true" : "false");  // "false" = gültiger ARIA-Ruhezustand
  };
  const setRowsDisabled = (disabled: boolean): void => {
    opts.containerEl.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>("input, button, select")
      .forEach(el => { el.disabled = disabled; });
  };
  const lockRows = (): void => {
    opts.cache.bump();
    setLockState(true);
    setRowsDisabled(true);
  };
  // Idempotente Freigabe beim Betreten: Klasse und aria-busy überleben sonst den 1.13-Pfad —
  // rerender() geht dort über update(), und settingBodyHost leert zwar die Kinder des Containers, aber
  // nicht seine Klassen/Attribute. Ohne das bliebe die Liste dauerhaft pointer-events: none.
  // Nur der Zustand: die Zeilen entstehen erst darunter, es gibt hier noch nichts zu entsperren.
  setLockState(false);
  // Rettungsnetz: eine gescheiterte Kette (Speichern, reconnect) darf die UI nicht verriegelt
  // zurücklassen. Bewusst ohne Fehlerdetails in Log/Notice — hier hängen Anbieter-Schlüssel dran.
  const failSafe = (): void => {
    setLockState(false);
    setRowsDisabled(false);
    new Notice(opts.strings.saveFailed, 8000);
    // Re-Render statt bloßem Entsperren: bei einer gescheiterten Kette hat opts.set(...) die
    // Settings im Speicher bereits mutiert, bevor save()/reconnect() geworfen hat — ohne
    // Rebuild zeigt das DOM weiter die alte Reihenfolge/Indizes, und der nächste Klick auf
    // Mülleimer/„zuerst verwenden" träfe den falschen Eintrag.
    opts.rerender();
  };
  // Beschriftung + Erklärung als EIGENE Zeile ohne Steuerelemente. Vorher hingen sie an der
  // ersten Endpunkt-Zeile — Obsidians `Setting` teilt die Zeile in Info (links) und Controls
  // (rechts), und mit drei Feldern rechts blieb der Text auf eine unlesbare Buchstabensäule
  // gequetscht (gemeldet 2026-08-04). Die Zeilen selbst tragen deshalb keinen Text mehr und
  // bekommen über `okit-ep-row` die volle Breite für ihre Felder.
  new Setting(opts.containerEl).setName(opts.label).setDesc(opts.desc);

  rows.forEach((cfg, i) => {
    const isAdder = i >= eps.length;
    const s = new Setting(opts.containerEl);
    s.settingEl.addClass("okit-ep-row");
    const statusIcon = s.controlEl.createSpan({ cls: "okit-ep-status" });
    // Drittanbieter-Hinweis: in-place umschaltbar, NICHT nur einmal beim Zeilen-Render gebaut —
    // der apiKey-Commit unten baut den Tab bewusst nicht neu (siehe dort), also muss dieses Icon
    // sich selbst zeigen/verstecken können, sonst bleibt der Nutzer genau im Moment, in dem er den
    // Schlüssel einträgt, ohne Hinweis. Eine Wahrheit (`carriesApiKey`), zwei Aufrufzeitpunkte
    // (Erst-Render unten + apiKey-Commit) statt einer zweiten Bedingung.
    let thirdPartyIcon: HTMLSpanElement | null = null;
    const syncThirdPartyIcon = (hasKey: boolean): void => {
      if (hasKey) {
        if (thirdPartyIcon) return;   // schon da — nicht doppelt anlegen
        thirdPartyIcon = s.controlEl.createSpan({ cls: "okit-ep-thirdparty" });
        setIcon(thirdPartyIcon, "alert-triangle");
        setTooltip(thirdPartyIcon, opts.strings.thirdParty);
      } else if (thirdPartyIcon) {
        thirdPartyIcon.remove();
        thirdPartyIcon = null;
      }
    };
    /** Schreibt die Rollen-Zeile neu, ohne den Tab neu aufzubauen. Wird vom probe-Block
     *  unten gesetzt (vorher gibt es keine Zeile) und beim Modell-Commit aufgerufen —
     *  das Modell-Override entscheidet über `skipped-model`, ändert die Listen-FORM aber
     *  nicht, löst also bewusst kein `rerender()` aus. Ohne diesen Rückruf behielte die
     *  Zeile ihre Aussage von vor der Modellwahl: ein Endpunkt, den der Guard längst
     *  überspringt, meldete weiter „erreichbar, aber Platz N" (gemeldet 2026-08-05). */
    let syncRoleLine: (() => void) | null = null;
    // Listen-Mutation NUR bei blur, NICHT in onChange: onChange feuert pro Tastendruck und
    // würde im Add-Feld jeden Zwischenstand (h, ht, htt, …) als eigenen Eintrag anhängen.
    // Nur URL-Änderungen rendern neu (Statuszeile hängt an der URL). Schlüssel/Modell tun das
    // NICHT: rerender baut den Tab komplett neu auf, und da reconnect() jeden Endpunkt pingt
    // (bis 5 s), risse es dem Nutzer sonst mitten im Tippen des nächsten Feldes das DOM weg.
    const commit = (field: "url" | "apiKey" | "model", value: string): void => {
      const before = opts.get();
      const updated = applyEndpointEdit(before, i, field, value, isAdder) as T[];
      if (JSON.stringify(updated) === JSON.stringify(before)) return;   // unverändert → kein Re-Render
      const rerender = field === "url";
      if (rerender) lockRows();
      // apiKey ändert die Listen-FORM nicht (kein Re-Render) — das Drittanbieter-Icon muss sich
      // deshalb hier selbst aktualisieren, statt auf den (bewusst ausbleibenden) Neuaufbau zu warten.
      if (field === "apiKey") {
        syncThirdPartyIcon(carriesApiKey(updated[i]));
        // Ohne Schlüssel lieferte der Endpunkt vermutlich 401 → leere Liste → Notausgang.
        // Mit Schlüssel hat er eine Liste; der alte Eintrag wäre eine Lüge. Anders als das
        // Drittanbieter-Icon oben korrigiert sich die Modell-Zeile dadurch NICHT selbst —
        // sichtbar wird die neue Liste erst beim nächsten Zeilen-Neuaufbau (URL-Commit,
        // „Modelle abrufen", Tab-Reload), da dieser Commit bewusst kein rerender() auslöst.
        opts.cache.invalidate(normalizeEndpoint(updated[i].url));
      }
      // Ein URL-Commit setzt oder entfernt den Bezug zu (mindestens) einer URL — die alte UND
      // die neue, denn beide koennen bereits eine (moeglicherweise laengst veraltete) Liste im
      // Cache tragen: die alte, weil ihr Eintrag jetzt verwaist; die neue, weil genau diese URL
      // schon einmal (unter einem anderen Eintrag) geladen wurde, z. B. nach Loeschen +
      // Neuanlage derselben Adresse (gemeldet von image-to-markdown, 2026-09-12). Ohne beide
      // Invalidierungen zeigt das Dropdown die Liste von VOR der Mutation weiter an.
      if (field === "url") {
        const oldUrl = before[i]?.url;
        if (oldUrl) opts.cache.invalidate(normalizeEndpoint(oldUrl));
        const newUrl = value.trim();
        if (newUrl) opts.cache.invalidate(normalizeEndpoint(newUrl));
      }
      opts.set(updated);
      const chain = opts.save().then(() => opts.reconnect());
      // Das Modell-Override entscheidet mit über die Rolle der Zeile (`skipped-model`).
      // Erst NACH reconnect() nachziehen: der Resolver kann den Endpunkt wegen des neuen
      // Modells gerade fallengelassen oder übernommen haben, und die Zeile soll den
      // Zustand danach zeigen, nicht den davor.
      const withRoleSync = field === "model" ? chain.then(() => { syncRoleLine?.(); }) : chain;
      void (rerender ? withRoleSync.then(() => opts.rerender()) : withRoleSync).catch(failSafe);
    };
    s.addText(tx => {
      tx.setPlaceholder(isAdder ? opts.strings.addPlaceholder : opts.placeholder).setValue(cfg.url);
      tx.inputEl.setAttribute("aria-label", isAdder ? opts.strings.ariaAdd : opts.strings.ariaUrl);
      tx.inputEl.addEventListener("blur", () => { commit("url", tx.getValue()); });
    });
    // Schlüssel + Modell nur an bestehenden Einträgen — am leeren Adder gäbe es nichts zu tragen.
    // aria-label statt bloßem Placeholder: der verschwindet beim Tippen, und drei unbeschriftete
    // Felder in einer Zeile sind für Screenreader nicht auseinanderzuhalten.
    if (!isAdder && opts.secret) {
      const hook = opts.secret;
      const current = opts.get()[i] ?? cfg;
      const st = opts.strings;
      const afterSecret = (): void => {
        lockRows();
        void opts.save().then(() => opts.reconnect()).then(() => opts.rerender()).catch(failSafe);
      };
      const secretInput = (): void => {
        s.addText(tx => {
          tx.setPlaceholder(st.apiKeyPlaceholder).setValue("");
          tx.inputEl.type = "password";
          tx.inputEl.setAttribute("autocomplete", "off");
          if (!hook.available) {
            tx.inputEl.disabled = true;
            tx.inputEl.setAttribute("aria-label", `${st.ariaApiKey(cfg.url)} — ${st.secretUnavailable ?? ""}`);
            setTooltip(tx.inputEl, st.secretUnavailable ?? "");
            return;
          }
          tx.inputEl.setAttribute("aria-label", st.ariaApiKey(cfg.url));
          tx.inputEl.addEventListener("blur", () => {
            const v = tx.getValue();
            if (!v) return;
            // Cache-Eintrag der URL invalidieren: mit Token antwortet ein gehosteter Endpunkt anders.
            opts.cache.invalidate(normalizeEndpoint(cfg.url));
            void hook.set(current, i, v).then(afterSecret).catch(failSafe);
          });
        });
      };
      if (hook.has(current, i)) {
        const saved = s.controlEl.createSpan({ cls: "okit-ep-secret", text: st.secretSaved ?? "" });
        saved.setAttribute("aria-label", st.ariaApiKey(cfg.url));
        // Beide Knöpfe gehören zusammen: „ändern" zeichnet ein leeres Eingabefeld darunter —
        // bleibt „entfernen" dabei stehen, wirkt er weiter auf den ALTEN, noch gespeicherten
        // Schlüssel, während der Nutzer gerade einen neuen einträgt (gemeldet im Review).
        let clearBtnEl: HTMLElement | null = null;
        s.addExtraButton(b => b.setIcon("pencil").setTooltip(st.secretChange ?? "").onClick(() => {
          saved.remove();
          b.extraSettingsEl.remove();
          clearBtnEl?.remove();
          secretInput();
        }));
        s.addExtraButton(b => {
          clearBtnEl = b.extraSettingsEl;
          return b.setIcon("key-round").setTooltip(st.secretClear ?? "").onClick(() => {
            opts.cache.invalidate(normalizeEndpoint(cfg.url));
            void hook.clear(current, i).then(afterSecret).catch(failSafe);
          });
        });
      } else {
        secretInput();
      }
    } else if (!isAdder) {
      s.addText(tx => {   // bisheriges Passwortfeld, unverändert
        tx.setPlaceholder(opts.strings.apiKeyPlaceholder).setValue(cfg.apiKey ?? "");
        tx.inputEl.type = "password";                    // maskiert gegen Schultergucken/Screenshots
        tx.inputEl.setAttribute("autocomplete", "off");
        tx.inputEl.setAttribute("aria-label", opts.strings.ariaApiKey(cfg.url));
        tx.inputEl.addEventListener("blur", () => { commit("apiKey", tx.getValue()); });
      });
    }
    if (!isAdder) {
      // Modell-Override: Dropdown mit den Modellen GENAU DIESES Endpunkts. Die Liste kommt
      // aus dem Cache, nicht vom aktiven Client — eine Zeile kann einen ganz anderen
      // Anbieter meinen als den gerade verbundenen.
      // Platz SYNCHRON reservieren: der Picker zeichnet erst nach dem geladenen Promise, der
      // Mülleimer/das Warn-Icon gleich darunter aber synchron. Ohne Reservierung hängt Obsidian
      // (das jede add*-Komponente in Aufrufreihenfolge an controlEl anhängt) das Dropdown ans
      // Ende der Zeile — hinter den Mülleimer, ein Layout-Sprung inklusive. `renderModelPicker`
      // zeichnet über `target` deshalb direkt in dieses Element statt in `s.controlEl`.
      const modelSlot = s.controlEl.createSpan({ cls: "okit-model-slot" });
      const listKey = normalizeEndpoint(cfg.url);
      const gen = opts.cache.generation();
      void opts.cache.load(listKey, opts.clientFor(opts.get()[i] ?? cfg)).then(({ models, reachable }) => {
        if (gen !== opts.cache.generation()) return;   // Liste hat sich verschoben
        // `allowEmpty: true` wie in der Vorlage — die Leer-Option muss auch dann im Dropdown
        // stehen, wenn die Zeile bereits ein Override trägt, sonst ließe sich das Override
        // über die Oberfläche nicht mehr zurücknehmen (Einbahnstraße). Die Kit-Fassung von
        // resolveModelChoice kennt kein `emptyLabel`: die Option kommt sprachfrei mit leerem
        // Label, beschriftet wird sie erst hier, beim Zeichnen.
        // Die Leer-Option existiert nur, wo es ein globales Modell gibt, auf das sie zeigen kann.
        const allowEmpty = opts.globalModel !== undefined;
        const choice = resolveModelChoice({ reachable, models, current: cfg.model ?? "", allowEmpty });
        const emptyLabel = allowEmpty ? opts.strings.emptyModelLabel?.(opts.globalModel?.() ?? "") : undefined;
        const labelled = emptyLabel === undefined ? choice : {
          ...choice,
          options: choice.options.map(o => o.value === "" ? { ...o, label: emptyLabel } : o),
        };
        renderModelPicker({
          setting: s,
          target: modelSlot,
          choice: labelled,
          ariaLabel: opts.strings.ariaModel(cfg.url),
          placeholder: opts.strings.modelPlaceholder,
          hint: opts.strings.modelHint(choice.hintKey),
          hintAs: "tooltip",
          savedSuffix: opts.strings.savedSuffix,
          refreshTooltip: opts.strings.refreshModels,
          onPick: (v: string) => { commit("model", v); },
          onRefresh: () => { opts.cache.invalidate(listKey); opts.rerender(); },
        });
      });
    }
    // „Zuerst verwenden": setzt die Zeile an die Spitze der Prioritätsliste. An Platz 1
    // bewusst GAR NICHT gezeichnet statt deaktiviert — ein setDisabled-Element trägt seinen
    // Tooltip in Electron unsichtbar (Befund aus dem Modell-Picker-Review 2026-08-05), der
    // Knopf wäre dort also stumm UND wirkungslos.
    if (!isAdder && i > 0) {
      s.addExtraButton(b => b
        .setIcon("arrow-up-to-line")
        .setTooltip(opts.strings.moveToFront)
        .onClick(() => {
          lockRows();
          opts.set(moveEndpointToFront(opts.get(), i) as T[]);
          void opts.save()
            .then(() => opts.reconnect())
            .then(() => opts.rerender())
            .catch(failSafe);
        }));
    }
    // Löschen: expliziter Mülleimer-Button (nicht am leeren Add-Feld). Das Status-Icon links
    // ist nur Erreichbarkeits-Anzeige, kein Lösch-Button.
    if (!isAdder) {
      s.addExtraButton(b => b
        .setIcon("trash-2")
        .setTooltip(opts.strings.remove)
        .onClick(() => {
          lockRows();
          // Geht an commit() vorbei (kein blur-Feld) — die Invalidierung muss deshalb hier
          // selbst passieren, sonst ueberlebt die Modell-Liste dieser URL ihren Eintrag.
          opts.cache.invalidate(normalizeEndpoint(cfg.url));
          opts.set(applyEndpointEdit(opts.get(), i, "url", "", false) as T[]);
          void opts.save()
            .then(() => opts.reconnect())
            .then(() => opts.rerender())
            .catch(failSafe);
        }));
    }
    // Pro-Feld-Status in A11y-Form (Form + Text + Farbe): loader → check/x, aktiver markiert.
    const ep = cfg.url.trim();
    if (!isAdder && ep) {
      setIcon(statusIcon, "loader"); setTooltip(statusIcon, opts.strings.probing);
      // Rolle der Zeile als eigene Zeile UNTER den Feldern (flex-basis 100% im umbrechenden
      // Control-Container): horizontal ist die Zeile mit drei Feldern + bis zu drei Icons +
      // zwei Knöpfen ausgereizt (Layout-Fix 2026-08-04). Synchron angelegt, asynchron befüllt.
      const stateEl = s.controlEl.createDiv({ cls: "okit-ep-state", text: opts.strings.probing });
      // Erreichbarkeit ändert sich nur durch eine neue Probe, die Rolle aber auch durch das
      // Modell-Override. Das Probe-Ergebnis wird deshalb festgehalten, damit die Rolle ohne
      // erneuten Netzzugriff nachgezogen werden kann.
      let probed: EndpointStatus | null = null;
      const applyRole = (): void => {
        if (!probed) return;
        const isActive = normalizeEndpoint(ep) === (opts.active() ?? "");
        // Den Eintrag frisch aus der Liste lesen, nicht das `cfg` vom Render-Zeitpunkt:
        // nach einem Modell-Commit trägt nur die Liste den neuen Wert.
        const current = opts.get()[i] ?? cfg;
        const role = endpointRole({
          isActive,
          reachable: probed.reachable,
          // Gilt nur für Embedding-Endpunkte; für Chat hängt kein Index am Modell (immer true).
          modelFits: opts.modelFits?.(current) ?? true,
          position: i + 1,
        });
        stateEl.setText(opts.strings.role(role));
        stateEl.toggleClass("is-active", role.kind === "active");
      };
      syncRoleLine = applyRole;
      void opts.clientFor(opts.get()[i] ?? cfg).probe().then(status => {
        statusIcon.empty();
        setIcon(statusIcon, status.reachable ? "circle-check" : "circle-x");
        statusIcon.toggleClass("is-ok", status.reachable);
        statusIcon.toggleClass("is-error", !status.reachable);
        // Tooltip trägt nur noch die Erreichbarkeits-Diagnose; das frühere " · aktiv" entfällt,
        // weil die Rolle jetzt als Text in der Zeile steht (keine zweite Wahrheit im Hover).
        setTooltip(statusIcon, opts.strings.statusTooltip(status));
        probed = status;
        applyRole();
      });
      // Eingabe-Prüfung: nicht-blockierendes Warn-Icon (WCAG-Form + Tooltip)
      const warnings = validateEndpointInput(ep);
      if (warnings.length) {
        const warnIcon = s.controlEl.createSpan({ cls: "okit-ep-warn" });
        setIcon(warnIcon, "alert-triangle");
        setTooltip(warnIcon, opts.strings.warnings(warnings));
      }
      // Drittanbieter-Hinweis (Erst-Render): der Schlüssel ist der verlässliche Indikator, nicht
      // die URL (ein eigener Server im LAN braucht keinen — eine URL-Heuristik wäre unzuverlässig).
      // Sachlicher Hinweis, keine Warnung vor einem Fehler — Form/Icon + Text, nie Farbe allein
      // (WCAG 1.4.1); NIE den Schlüssel selbst im Text/Tooltip. syncThirdPartyIcon() hält das
      // danach auch beim apiKey-Commit aktuell (siehe dort), ohne den Tab neu zu bauen.
      syncThirdPartyIcon(opts.secret ? opts.secret.has(opts.get()[i] ?? cfg, i) : carriesApiKey(cfg));
    }
    if (!isAdder && opts.extraRow) {
      const host = s.controlEl.createDiv({ cls: "okit-ep-extra" });
      opts.extraRow(host, opts.get()[i] ?? cfg, i);
    }
  });
  const actions = new Setting(opts.containerEl);
  (opts.presets ?? ENDPOINT_PRESETS).forEach(preset => {
    actions.addButton(b => b
      .setButtonText(opts.strings.presetLabel(preset))
      .setTooltip(opts.strings.presetTooltip(preset))
      .onClick(() => {
        const cur = opts.get();
        if (cur.some(c => c.url === preset.url)) return;   // schon in der Liste — kein Duplikat anhängen
        lockRows();
        // Geht an commit() vorbei — dieselbe URL kann von einem zuvor geloeschten Eintrag noch
        // eine (veraltete) Liste im Cache tragen.
        opts.cache.invalidate(normalizeEndpoint(preset.url));
        opts.set(applyEndpointEdit(cur, cur.length, "url", preset.url, true) as T[]);
        void opts.save()
          .then(() => opts.reconnect())
          .then(() => opts.rerender())
          .catch(failSafe);
      }));
  });
  actions.addButton(b => b.setButtonText(opts.strings.checkConnection).onClick(() => opts.rerender()));
}

/** Regeln der Endpunkt-Zeile. Consumer hängen sie in ihre styles.css (kein CSS-Import im
 *  Plugin-Bundle) — dasselbe Muster wie COLLAPSIBLE_CSS. */
export const ENDPOINT_LIST_CSS = `
/* Pro-Zeile-Status der Endpunkt-Fallback-Liste: Form trägt die Bedeutung, Farbe sekundär (WCAG 1.4.1). */
.okit-ep-status { display: inline-flex; align-items: center; margin-right: 8px; vertical-align: middle; color: var(--text-muted); }
.okit-ep-status svg { width: 14px; height: 14px; }
.okit-ep-status.is-ok { color: var(--text-success); }
.okit-ep-status.is-error { color: var(--text-error); }
.okit-ep-warn { display: inline-flex; align-items: center; margin-right: 8px; vertical-align: middle; color: var(--text-warning); }
.okit-ep-warn svg { width: 14px; height: 14px; }
/* Drittanbieter-Hinweis (Schlüssel gesetzt): sachlicher Hinweis, keine Fehler-Warnung — bewusst
   gedämpfter als .okit-ep-warn, Bedeutung trägt das Dreieck + der Tooltip, nicht die Farbe. */
.okit-ep-thirdparty { display: inline-flex; align-items: center; margin-right: 8px; vertical-align: middle; color: var(--text-muted); }
.okit-ep-thirdparty svg { width: 14px; height: 14px; }
.okit-ep-secret { color: var(--text-muted); font-size: var(--font-ui-small); margin-right: 8px; }
.okit-ep-extra { flex: 0 0 100%; order: 2; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 4px; }
/* Rolle der Zeile als Text unter den Feldern: „aktiv" / „erreichbar, aber Platz N" / … .
   Erreichbarkeit trägt das Icon (Form), die Rolle dieser Text — keins von beiden über Farbe
   allein (WCAG 1.4.1). Die frühere Auszeichnung saß auf dem Icon-Container und war wirkungslos:
   font-weight greift auf einem SVG nicht.
   flex-basis: 100% erzwingt den Umbruch im ohnehin umbrechenden .setting-item-control.
   stateEl wird VOR warnIcon/thirdPartyIcon angelegt (Erst-Render-Reihenfolge in
   buildEndpointList) — ohne order würden die beiden Icons hinter die volle-Breite-Zeile
   rutschen statt in der Feldreihe zu bleiben. order:1 hält die Rolle visuell zuletzt,
   unabhängig davon, was später noch an controlEl angehängt wird. */
.okit-ep-row > .setting-item-control .okit-ep-state {
  flex: 0 0 100%;
  order: 1;
  font-size: var(--font-ui-smaller);
  color: var(--text-muted);
  margin-top: 2px;
}
.okit-ep-row > .setting-item-control .okit-ep-state.is-active {
  color: var(--text-normal);
  font-weight: var(--font-bold);
}
/* Speicher-/Lösch-Fenster: die gerenderten Zeilen-Indizes sind stale, bis der Re-Render kommt —
   Eingaben und Icon-Buttons (divs, kein disabled) sind solange gesperrt. */
.okit-ep-busy { pointer-events: none; opacity: 0.6; }
/* Endpunkt-Zeile: drei Felder (Adresse · Schlüssel · Modell) brauchen die volle Breite.
   Die Beschriftung steht als eigene Zeile darüber, deshalb ist der Info-Block hier leer und
   darf keinen Platz beanspruchen — sonst quetscht er die Felder (gemeldet 2026-08-04).
   Kindselektor (>), kein Nachkomme: der extraRow-Host sitzt in controlEl, und ein Setting
   darin verlor sonst seine Beschriftung (gemessen 2026-09-25, llm-endpoint-manager). */
.okit-ep-row > .setting-item-info {
  display: none;
}
.okit-ep-row > .setting-item-control {
  flex-wrap: wrap;
  justify-content: flex-start;
  gap: var(--size-4-2);
  width: 100%;
}
.okit-ep-row > .setting-item-control input[type="text"],
.okit-ep-row > .setting-item-control input[type="password"] {
  flex: 1 1 12em;
  min-width: 8em;
}
/* Reservierter Platz für das Modell-Dropdown (Auffüllen der Zeile erst nach dem geladenen
   Promise, siehe buildEndpointList). Selbst ein Flex-Container, damit Dropdown/Freitext + der
   „Modelle abrufen"-Knopf innerhalb genauso mitwachsen wie URL/Schlüssel daneben. */
.okit-ep-row > .setting-item-control .okit-model-slot {
  display: flex;
  align-items: center;
  gap: var(--size-4-1);
  flex: 1 1 12em;
  min-width: 10em;
}
.okit-ep-row > .setting-item-control .okit-model-slot select,
.okit-ep-row > .setting-item-control .okit-model-slot input[type="text"] {
  flex: 1 1 auto;
  min-width: 0;
}
`;
