// vendored from obsidian-kit@0.46.0, src/obsidian/clock.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
/** Injizierter Timer-/Clock-Port. Hält timer-nutzenden Code in einer reinen Node-Umgebung
 *  (kein `window`) testbar, während die echte Obsidian-Runtime immer `window` hat — nur
 *  Test-Umgebungen fehlt es, weshalb die bare Global nie direkt aus getestetem Code gerufen
 *  wird. `now()` liefert die Wall-Clock (in Tests injizierbar für deterministische Zeit). */
export interface ClockPort {
	now(): number;
	setTimeout(fn: () => void, ms: number): number;
	clearTimeout(id: number): void;
}

export const realClock: ClockPort = {
	now: () => Date.now(),
	setTimeout: (fn, ms) => window.setTimeout(fn, ms),
	clearTimeout: (id) => window.clearTimeout(id),
};
