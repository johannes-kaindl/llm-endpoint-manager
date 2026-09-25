// src/core darf `obsidian` nicht importieren (PROF-OBS-03/04).
// Bewusst ein Script und kein grep-Einzeiler: grep in package.json erfasst nur eine
// Anfuehrungszeichen-Variante und laesst die andere still durch.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = "src/core";
const FORBIDDEN = /(?:from|import)\s*\(?\s*["']obsidian(\/[^"']*)?["']/;

// Git trackt keine leeren Verzeichnisse — ein frischer Klon eines Repos, dessen src/core
// noch nichts enthaelt (z.B. dieses Geruest vor Task 10), hat den Ordner schlicht nicht.
// Ohne Guard crasht readdirSync mit ENOENT statt "nichts zu pruefen" zu melden.
function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const files = walk(ROOT).filter((f) => f.endsWith(".ts"));
// CORE-TEST-19: „nichts gemessen“ ist kein Erfolg. Der ENOENT-Guard oben war für das leere Gerüst
// richtig; jetzt, wo src/core existiert, wäre ein leerer Lauf (falsches CWD, umbenannter Ordner)
// ein stilles Grün.
if (files.length === 0) {
  console.error(`check:pure: keine .ts-Datei unter ${ROOT} gefunden — nichts geprüft (falsches Verzeichnis?)`);
  process.exit(1);
}
const offenders = files.filter((f) => FORBIDDEN.test(readFileSync(f, "utf8")));

if (offenders.length > 0) {
  console.error("src/core darf obsidian nicht importieren:");
  for (const f of offenders) console.error(`  ${f}`);
  process.exit(1);
}
console.log(`check:pure: ${ROOT} ist frei von obsidian (${files.length} Dateien geprüft)`);
