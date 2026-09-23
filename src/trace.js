// Mode trace (TRACE_RLCRAFT=1) : enregistre chaque changement des scoreboards
// et tags RLCraft, avec le contexte de jeu, dans logs/rlcraft-trace.jsonl.
// Sert a calibrer des valeurs dont l'addon ne documente pas l'echelle (soif,
// temperature...).
import { appendFileSync } from 'node:fs';

const FILE = new URL('../logs/rlcraft-trace.jsonl', import.meta.url);

export function createTracer(log) {
  let prev = null;

  return (state) => {
    const raw = state.rlcraftRaw;
    if (!raw) return;

    const changes = {};
    for (const k of new Set([...Object.keys(prev?.scores ?? {}), ...Object.keys(raw.scores)])) {
      if (prev?.scores[k] !== raw.scores[k]) changes[k] = [prev?.scores[k] ?? null, raw.scores[k] ?? null];
    }
    const added = raw.tags.filter((t) => !prev?.tags.includes(t));
    const removed = (prev?.tags ?? []).filter((t) => !raw.tags.includes(t));
    const first = prev === null;
    prev = raw;
    if (!first && !Object.keys(changes).length && !added.length && !removed.length) return;

    const p = state.player.pos;
    const entry = {
      at: Date.now(),
      ...(first ? { snapshot: raw } : { changes, added, removed }),
      ctx: {
        dim: state.player.dimension,
        pos: p ? [Math.round(p.x), Math.round(p.y), Math.round(p.z)] : null,
        travel: state.player.travel,
        underwater: state.player.underwater,
        timeOfDay: state.world.timeOfDay,
        weather: state.world.weather,
        activity: state.activity().kind,
      },
    };
    appendFileSync(FILE, `${JSON.stringify(entry)}\n`);

    if (first) {
      log(`trace : releve initial (${Object.keys(raw.scores).length} scores, ${raw.tags.length} tags)`);
      return;
    }
    const parts = Object.entries(changes).map(([k, [a, b]]) => `${k} ${a}->${b}`);
    if (added.length) parts.push(`+${added.join(',')}`);
    if (removed.length) parts.push(`-${removed.join(',')}`);
    log(`trace : ${parts.join(' | ')}`);
  };
}
