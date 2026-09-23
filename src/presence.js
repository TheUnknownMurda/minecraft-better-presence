// Traduit un GameState en activite Discord.
import { entityName, itemName, strings } from './names.js';

// Discord accepte des URLs https en guise d'images de Rich Presence.
const WIKI = 'https://minecraft.wiki/images/';
const IMAGES = {
  overworld: `${WIKI}Grass_Block_JE7_BE6.png`,
  nether: `${WIKI}Netherrack_JE4_BE2.png`,
  end: `${WIKI}End_Stone_JE3_BE2.png`,
  fighting: `${WIKI}Diamond_Sword_JE3_BE3.png`,
  hunting: `${WIKI}Diamond_Sword_JE3_BE3.png`,
  mining: `${WIKI}Diamond_Pickaxe_JE3_BE3.png`,
  building: `${WIKI}Bricks_JE4_BE2.png`,
  crafting: `${WIKI}Crafting_Table_JE4_BE3.png`,
  smelting: `${WIKI}Lit_Furnace_%28E%29_BE2.png`,
  riding: `${WIKI}Oak_Boat_JE4_BE2.png`,
  swimming: `${WIKI}Water_Bucket_JE2_BE2.png`,
  idle: `${WIKI}Red_Bed_JE4_BE2_%28facing_NWU%29.png`,
  dead: `${WIKI}Heart_0_%28icon%29.png`,
  exploring: `${WIKI}Compass_JE2_BE2.png`,
};
const DIMENSION_IMAGES = { 0: 'overworld', 1: 'nether', 2: 'end' };

/** Discord refuse les champs de plus de 128 caracteres. */
const fit = (s) => (s.length > 128 ? `${s.slice(0, 127)}…` : s);

function describe(a, dim) {
  const t = strings().activity;
  switch (a.kind) {
    case 'dead':      return t.dead(strings().deaths[a.cause] ?? strings().died);
    case 'fighting':  return t.fighting(entityName(a.target));
    case 'hunting':   return t.hunting(entityName(a.target));
    case 'mining':    return t.mining(itemName(a.target));
    case 'building':  return t.building(itemName(a.target));
    case 'crafting':  return t.crafting(itemName(a.target));
    case 'smelting':  return t.smelting(itemName(a.target));
    case 'riding':    return t.riding(dim.in);
    case 'swimming':  return t.swimming();
    case 'idle':      return t.idle();
    default:          return t.exploring(dim.in);
  }
}

function timeOfDay(t) {
  if (t === null) return null;
  return t >= 13_000 && t < 23_000 ? strings().night : strings().daytime;
}

/** Profil RLCraft affiche au survol de la petite icone. */
function profile(state) {
  const S = strings();
  const r = state.rlcraft;
  if (!r) return '';
  const parts = [S.skills(r.skills)];
  const set = r.sets.find((s) => s !== 'dragon') ?? r.sets[0];
  if (set) parts.push(S.set(S.sets[set] ?? set));
  if (r.dragonSlayer) parts.push(S.dragonSlayer);
  return parts.join(' · ');
}

export function buildActivity(state, { showCoords = false } = {}) {
  const S = strings();
  const dimId = S.dimensions[state.player.dimension] ? state.player.dimension : 0;
  const dim = S.dimensions[dimId];
  const a = state.activity();

  const stateLine = [
    Number.isFinite(state.rlcraft?.thirst) && S.thirst(state.rlcraft.thirst),
    state.hunger !== null && S.hunger(state.hunger / 2),
    state.level !== null && S.level(state.level),
    state.world.day !== null && S.day(state.world.day),
    timeOfDay(state.world.timeOfDay),
    S.weather[state.world.weather],
    state.nearby.monsters > 0 && S.hostiles(state.nearby.monsters),
  ].filter(Boolean).join(' · ');

  const pos = state.player.pos;
  const where = showCoords && pos
    ? `${dim.name} · ${Math.round(pos.x)}, ${Math.round(pos.y)}, ${Math.round(pos.z)}`
    : dim.name;

  const activity = {
    details: fit(describe(a, dim)),
    state: fit(stateLine || 'Minecraft Bedrock'),
    startTimestamp: state.sessionStart,
    largeImageKey: IMAGES[DIMENSION_IMAGES[dimId]],
    largeImageText: fit(`${where} · ${S.session(state.counters)}`),
    smallImageKey: IMAGES[a.kind] ?? IMAGES.exploring,
    smallImageText: fit(profile(state) || describe(a, dim)),
  };

  if (state.players.count > 1) {
    activity.partySize = state.players.count;
    activity.partyMax = state.players.max;
  }
  return activity;
}
