// src/core darf `obsidian` nicht importieren (PROF-OBS-03/04).
// Bewusst ein Script und kein grep-Einzeiler: grep in package.json erfasst nur eine
// Anfuehrungszeichen-Variante und laesst die andere still durch.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = "src/core";
const FORBIDDEN = /(?:from|import)\s*\(?\s*["']obsidian(\/[^"']*)?["']/;

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const offenders = walk(ROOT)
  .filter((f) => f.endsWith(".ts"))
  .filter((f) => FORBIDDEN.test(readFileSync(f, "utf8")));

if (offenders.length > 0) {
  console.error("src/core darf obsidian nicht importieren:");
  for (const f of offenders) console.error(`  ${f}`);
  process.exit(1);
}
console.log(`check:pure: ${ROOT} ist frei von obsidian`);
