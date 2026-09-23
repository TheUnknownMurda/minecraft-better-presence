// Noms affichables : fichier de langue officiel du jeu pour le vanilla,
// data/rlcraft.json pour RLCraft (ses packs Marketplace sont chiffres).
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { STRINGS } from './i18n.js';

const RLCRAFT_FILE = new URL('../data/rlcraft.json', import.meta.url);
const UNKNOWN_FILE = new URL('../logs/unknown-ids.txt', import.meta.url);

const lang = new Map();
let code = 'en';
let S = STRINGS.en;

/** { "hfrlc:knight": { en, fr, passive? } } — editable sans toucher au code. */
function loadRlcraft() {
  try {
    return JSON.parse(readFileSync(RLCRAFT_FILE, 'utf8'));
  } catch (e) {
    console.error(`data/rlcraft.json illisible (${e.message}) : noms RLCraft indisponibles`);
    return {};
  }
}
const RLCRAFT = loadRlcraft();

// Mobs RLCraft pacifiques (chasse plutot que combat). Les autres mobs hfrlc
// comptent comme des combats : l'addon ne renseigne pas isMonster pour eux.
export const RLCRAFT_PASSIVE = new Set(Object.keys(RLCRAFT).filter((id) => RLCRAFT[id].passive));

// Identifiants deja notes, y compris lors des sessions precedentes. Ceux qui
// ont recu un nom depuis sont retires : le fichier reste une liste a traiter.
const unknown = new Set();
try {
  const lines = readFileSync(UNKNOWN_FILE, 'utf8').split(/\r?\n/).filter(Boolean);
  const pending = lines.filter((line) => !RLCRAFT[line.split('\t')[0]]);
  for (const line of pending) unknown.add(line.split('\t')[0]);
  if (pending.length !== lines.length) {
    writeFileSync(UNKNOWN_FILE, pending.map((line) => `${line}\n`).join(''));
  }
} catch { /* premier lancement */ }

/** Textes de la langue courante. */
export const strings = () => S;

/**
 * Choisit la langue d'affichage et charge les traductions du jeu installe.
 * Renvoie le nombre d'entrees lues (0 si le fichier est introuvable).
 */
export function setLanguage(requested) {
  code = STRINGS[requested] ? requested : 'en';
  S = STRINGS[code];
  lang.clear();
  try {
    const dir = execFileSync('powershell.exe', ['-NoProfile', '-Command',
      '(Get-AppxPackage Microsoft.MinecraftUWP).InstallLocation'], { encoding: 'utf8' }).trim();
    const text = readFileSync(`${dir}/data/resource_packs/vanilla/texts/${S.gameLocale}.lang`, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const i = line.indexOf('=');
      if (i <= 0 || line.startsWith('#')) continue;
      lang.set(line.slice(0, i).trim(), line.slice(i + 1).split('\t#')[0].trim());
    }
  } catch {
    // Pas bloquant : on retombe sur les identifiants mis en forme.
  }
  return lang.size;
}

/**
 * "red_dragon_helmet" -> "Red Dragon Helmet" (en) / "Red dragon helmet" (fr).
 * Les identifiants d'addon absents de data/rlcraft.json sont notes, avec leur
 * nature (mob ou objet), dans logs/unknown-ids.txt.
 */
function prettify(id, kind) {
  const raw = String(id);
  if (!raw.startsWith('minecraft:') && raw.includes(':') && !unknown.has(raw)) {
    unknown.add(raw);
    try { appendFileSync(UNKNOWN_FILE, `${raw}\t${kind}\n`); } catch { /* pas bloquant */ }
  }
  const words = raw.split(':').pop().split('_');
  return words
    .map((w, i) => (S.titleCase || i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ');
}

const short = (id) => String(id).replace(/^minecraft:/, '');
const rlcraftName = (id) => RLCRAFT[id]?.[code] ?? RLCRAFT[id]?.en;

/**
 * Le fichier de langue garde les anciennes cles pour beaucoup de blocs :
 * oak_planks -> tile.planks.oak, grass_block -> tile.grass, stone -> tile.stone.stone.
 */
function itemKeys(id) {
  const s = short(id);
  const [head, ...rest] = s.split('_');
  const tail = rest.join('_');
  return [
    `item.${s}.name`,
    `tile.${s}.name`,
    `tile.${s}.${s}.name`,
    tail && `tile.${tail}.${head}.name`,
    tail && `item.${tail}.${head}.name`,
    `tile.${s.replace(/_block$/, '')}.name`,
    `tile.${s}.default.name`,
  ].filter(Boolean);
}

export function entityName(id) {
  if (!id) return S.unknown;
  return rlcraftName(id) ?? lang.get(`entity.${short(id)}.name`) ?? prettify(id, 'mob');
}

export function itemName(id) {
  if (!id) return S.nothing;
  const named = rlcraftName(id);
  if (named) return named;
  for (const key of itemKeys(id)) {
    if (lang.has(key)) return lang.get(key);
  }
  return prettify(id, 'objet/bloc');
}
