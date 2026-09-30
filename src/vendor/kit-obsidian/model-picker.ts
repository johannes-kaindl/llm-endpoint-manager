// vendored from obsidian-kit@0.46.0, src/obsidian/model-picker.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
/* Zeichnet eine Modell-Auswahl in eine bestehende Setting-Zeile. Kennt die Regeln nicht --
 * die stehen in resolveModelChoice (pure/model-choice.ts).
 *
 * Herkunft: vault-rag/src/settings.ts (renderModelPicker, 0.19.x). Abweichung zur Vorlage:
 * alle Texte kommen aus `opts`, das Kit formuliert nicht. */
import { Setting } from "obsidian";
import type { ModelChoice } from "../kit/model-choice";

export interface ModelPickerOptions {
  setting: Setting;
  choice: ModelChoice;
  ariaLabel: string;
  placeholder: string;
  hint: string;
  hintAs?: "desc" | "tooltip";
  savedSuffix: string;
  refreshTooltip: string;
  onPick(value: string): void;
  onRefresh(): void;
  target?: HTMLElement;
}

export function renderModelPicker(opts: ModelPickerOptions): void {
  const { setting: s, choice, target } = opts;
  const hintAs = opts.hintAs ?? "desc";
  if (opts.hint && hintAs === "desc") s.setDesc(opts.hint);

  if (choice.mode === "freetext") {
    s.addText(t => {
      t.setPlaceholder(opts.placeholder).setValue(choice.value);
      t.inputEl.setAttribute("aria-label", opts.ariaLabel);
      t.inputEl.addEventListener("blur", () => { opts.onPick(t.getValue().trim()); });
      target?.appendChild(t.inputEl);
    });
  } else {
    s.addDropdown(d => {
      for (const o of choice.options) {
        d.addOption(o.value, o.suffix === "saved" ? `${o.label} ${opts.savedSuffix}` : o.label);
      }
      d.setValue(choice.value);
      d.selectEl.setAttribute("aria-label", opts.ariaLabel);
      if (choice.mode === "locked") d.setDisabled(true);
      else d.onChange((v: string) => { opts.onPick(v); });
      target?.appendChild(d.selectEl);
    });
  }

  // Der Refresh-Knopf zeichnet IMMER, in allen drei Modi -- sonst laesst sich eine frisch
  // installierte Modell-Liste nicht auffrischen, ohne die Einstellungen neu zu oeffnen. Er ist
  // ausserdem der Traeger des Hinweistexts bei hintAs "tooltip": als einziges Element ist er nie
  // disabled (anders als das <select> im Modus "locked"), ein Tooltip landet dort also
  // zuverlaessig -- deaktivierte Controls bekommen in Chromium keine Pointer-Events.
  s.addExtraButton(b => {
    const tooltip = opts.hint && hintAs === "tooltip"
      ? `${opts.hint} · ${opts.refreshTooltip}`
      : opts.refreshTooltip;
    b.setIcon("refresh-cw").setTooltip(tooltip).onClick(() => { opts.onRefresh(); });
    target?.appendChild(b.extraSettingsEl);
  });
}
