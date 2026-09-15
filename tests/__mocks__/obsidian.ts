// Der Obsidian-Mock kommt vendored aus obsidian-kit/src/testing (tools/sync-kit.sh, Task 2).
export * from "../vendor/kit/obsidian-mock";

import { ItemView } from "../vendor/kit/obsidian-mock";

/**
 * Lokale Ergaenzungen fuer `LingoTunerView` — die vendorte Datei bleibt unangetastet.
 *
 * Der Mock ist ein aus fuenf Plugins gepflegtes Superset und wird laut `tests/helpers/dom.ts`
 * NICHT lokal erweitert; erweitert wird stattdessen HIER, in der Datei, die ihn re-exportiert.
 * `LingoTunerView` braucht drei Dinge, die der Superset nicht kennt, weil bisher kein
 * Konsument eine ItemView mit Markdown-Rendering getestet hat:
 *
 *   `Component`            — Lebenszyklus-Huelle fuer MarkdownRenderer.render
 *   `MarkdownRenderer`     — dito
 *   `ItemView.addChild/removeChild` — kommen im echten Obsidian aus Component
 *
 * Landet eines davon spaeter im Kit-Superset, faellt die hiesige Fassung ersatzlos weg.
 */
export class Component {
  private readonly kinder: Component[] = [];
  onload(): void { /* im Mock ohne Wirkung */ }
  onunload(): void { /* im Mock ohne Wirkung */ }
  addChild<T extends Component>(c: T): T { this.kinder.push(c); return c; }
  removeChild<T extends Component>(c: T): T {
    const i = this.kinder.indexOf(c);
    if (i >= 0) this.kinder.splice(i, 1);
    return c;
  }
}

/** Setzt den Rohtext statt zu rendern. Die Tests messen Struktur und Fokus, nicht Markdown. */
export const MarkdownRenderer = {
  render(_app: unknown, md: string, el: { setText(t: string): void }, _path: string, _c: unknown): Promise<void> {
    el.setText(md);
    return Promise.resolve();
  },
};

// `addChild`/`removeChild` an den vendorten Prototyp haengen statt ItemView zu ersetzen:
// ein lokales `export class ItemView` kollidierte mit dem `export *` oben, und eine
// Positivliste aller uebrigen Exporte waere beim naechsten Kit-Update still unvollstaendig.
const proto = ItemView.prototype as unknown as Record<string, unknown>;
if (typeof proto.addChild !== "function") {
  proto.addChild = function <T>(c: T): T { return c; };
  proto.removeChild = function <T>(c: T): T { return c; };
}
