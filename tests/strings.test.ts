import { describe, it, expect } from "vitest";
import { STRINGS } from "../src/i18n/strings";

describe("STRINGS", () => {
  it("de hat genau die Schlüssel von en, keiner leer", () => {
    const en = Object.keys(STRINGS.en).sort(); const de = Object.keys(STRINGS.de).sort();
    expect(de).toEqual(en);
    const enDict: Record<string, string> = STRINGS.en; const deDict: Record<string, string> = STRINGS.de;
    for (const k of en) { expect(enDict[k]).toBeTruthy(); expect(deDict[k]).toBeTruthy(); }
  });
  it("kein Fachbegriff ohne Auflösung: 'Endpoint' wird beim ersten Vorkommen erklärt", () => {
    expect(STRINGS.en["set.endpointsDesc"]).toMatch(/server address/i);
    expect(STRINGS.de["set.endpointsDesc"]).toMatch(/Serveradresse/);
  });
  it("kein Fachbegriff ohne Auflösung: 'Capability' wird bei row.capabilities erklärt", () => {
    expect(STRINGS.en["row.capabilities"]).toMatch(/chat/i);
    expect(STRINGS.en["row.capabilities"]).toMatch(/embedding/i);
    expect(STRINGS.en["row.capabilities"]).toMatch(/vision/i);
    expect(STRINGS.en["row.capabilities"]).toMatch(/image/i);
    expect(STRINGS.de["row.capabilities"]).toMatch(/Chat/);
    expect(STRINGS.de["row.capabilities"]).toMatch(/Embedding/);
  });
});
