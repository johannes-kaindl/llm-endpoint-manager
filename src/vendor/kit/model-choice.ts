// vendored from code-kit@0.7.0, src/ts/pure/model-choice.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
/* Was das Modell-Feld zeigen soll — pure, entscheidet nur WAS, nie WIE.
 *
 * Herkunft: koda-agent/src/core/llm/model-choice.ts (2026-08-08), das seinerseits aus
 * vault-rag/src/model_choice.ts stammt. Von den beiden Fassungen wandert diese ins Kit:
 * sie gibt einen `hintKey` statt eines fertigen deutschen Satzes zurück und trägt
 * `suffix: "saved"` statt eines angehängten „(gespeichert)". Das Kit formuliert nicht —
 * jeder Consumer übersetzt die Schlüssel selbst. */

export type ModelChoiceMode = "dropdown" | "locked" | "freetext";
export type ModelHintKey = "" | "unreachable" | "no-list";

export interface ModelOption {
  value: string;
  /** Anzeigetext ohne Zusatz. */
  label: string;
  /** Vom Host zu übersetzender Zusatz, derzeit nur „gespeichert". */
  suffix?: "saved";
}

export interface ModelChoice {
  mode: ModelChoiceMode;
  /** Bei "dropdown"/"locked" gefüllt; enthält IMMER `value` (Invariante unten). */
  options: ModelOption[];
  value: string;
  hintKey: ModelHintKey;
}

export interface ModelChoiceInput {
  /** Erreichbar? Eine nicht leere `models`-Liste beweist das bereits. */
  reachable: boolean;
  models: string[];
  current: string;
  /** Ist der leere Wert bedeutungstragend? Dann steht die Leer-Option IMMER im Dropdown,
   *  auch wenn bereits ein Wert gewählt ist. Genau das braucht ein Modell-Override je
   *  Endpunkt-Zeile: ohne sie ließe sich ein einmal gesetztes Override über die Oberfläche
   *  nicht mehr zurücknehmen — die Zeile könnte nie wieder auf das globale Modell
   *  zurückfallen (Einbahnstraße, gemeldet 2026-08-08). Default `false`: wo "" nur
   *  „nichts gewählt" heißt, bleibt es bei der bloßen Invarianten-Sicherung.
   *  Das LABEL der Option setzt der Host — das Kit formuliert nicht. */
  allowEmpty?: boolean;
}

/**
 * INVARIANTE: In den Modi "dropdown" und "locked" enthält `options` immer `value`.
 * Ein `<select>`, dessen Wert nicht unter seinen Optionen steht, fällt still auf die erste
 * zurück — und das nächste Speichern schriebe dann diesen fremden Wert. Genau so verliert
 * man einen konfigurierten Modellnamen, ohne dass irgendetwas fehlschlägt. Das ist auch die
 * Antwort auf den Gotcha „Dropdown-Default muss persistiert werden": hier wird nie ein Wert
 * angezeigt, der nicht gespeichert ist.
 */
export function resolveModelChoice(input: ModelChoiceInput): ModelChoice {
  const current = input.current.trim();

  if (!input.reachable) {
    return {
      mode: "locked",
      options: [{ value: current, label: current }],
      value: current,
      hintKey: "unreachable",
    };
  }

  if (input.models.length === 0) {
    return { mode: "freetext", options: [], value: current, hintKey: "no-list" };
  }

  const options: ModelOption[] = [];
  // Unbedingt und als erste Option, wenn "" bedeutungstragend ist — der Weg zurück zum
  // Default darf nicht davon abhängen, ob gerade schon etwas gewählt ist.
  if (input.allowEmpty) options.push({ value: "", label: "" });
  if (current !== "" && !input.models.includes(current)) {
    // Gespeichert, aber nicht gelistet: sichtbar machen statt still verlieren.
    options.push({ value: current, label: current, suffix: "saved" });
  } else if (current === "" && !input.allowEmpty) {
    // Ohne diese Option fiele das <select> stumm auf das erste Modell. Bei `allowEmpty`
    // steht sie oben schon — hier nicht ein zweites Mal anlegen.
    options.push({ value: "", label: "—" });
  }
  for (const m of input.models) options.push({ value: m, label: m });

  return { mode: "dropdown", options, value: current, hintKey: "" };
}
