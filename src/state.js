// Etat de jeu normalise, alimente par les events et le polling de commandes.
import { RLCRAFT_PASSIVE } from './names.js';

const WINDOW_MS = 30_000; // fenetre d'observation pour deduire l'activite

// Soif RLCraft (scoreboard "thirst"), calibree en jeu le 2026-09-23 contre le
// HUD : plafond observe ~38000 (une gorgee = +6000), 10 gouttes de 3800.
// Releves : 23116 -> 6, 25804 -> 7, 29072 -> 8, 37986 -> 10 gouttes.
const THIRST_PER_DROP = 3800;
const ARMOR_SLOTS = { 2: 'head', 3: 'chest', 4: 'legs', 5: 'feet' };

// Blocs poses/casses par les scripts de RLCraft au nom du joueur : pas une activite.
const TECHNICAL_BLOCK = /^minecraft:(air|barrier|light_block.*|structure_void|invisible_bedrock|border_block|allow|deny)$/;

/** "minecraft:dirt" a partir d'un objet item/bloc du protocole. */
const idOf = (x) => (x?.id ? `${x.namespace || 'minecraft'}:${x.id}` : null);
const stripColors = (s) => String(s ?? '').replace(/§./g, '');

function mostCommon(values) {
  const counts = new Map();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
}

export class GameState {
  constructor() {
    this.reset();
  }

  reset() {
    this.sessionStart = Date.now();
    this.inMenu = false; // menu principal : connexion ouverte, aucun monde charge
    this.cameFromRlcraft = false; // monde quitte pour le menu : une partie RLCraft ?
    this.screen = null; // ecran reconnu : 'pause', 'inventory', 'chest', 'trinkets' ou 'lvlup' (screens.js)
    // Preuves de presence en jeu, independantes des commandes (voir applyPoll).
    this.lastEventAt = 0;
    this.lastHudAt = 0;
    this.commandsUnavailable = false; // en jeu, mais le monde refuse les commandes
    this.failingSince = null; // debut de la serie de releves ou tout echoue
    // lastMoveAt a maintenant : pas de faux "En pause" juste apres la connexion.
    this.player = { name: null, dimension: null, pos: null, travel: null, underwater: false, lastMoveAt: Date.now() };
    this.world = { day: null, timeOfDay: null, weather: null };
    this.players = { count: null, max: null };
    this.nearby = { monsters: 0 };
    this.counters = { blocksBroken: 0, kills: 0, deaths: 0, coins: 0 };
    this.armor = { head: null, chest: null, legs: null, feet: null };
    this.lastKill = null;
    this.lastDeath = null;
    this.recent = [];
    this.rlcraft = null;
    this.rlcraftRaw = null;
    this.level = null; // niveau d'XP par commande (level.js), null sans cheats
    this.levelScreen = null; // niveau d'XP lu sur le HUD (levelocr.js)
    this.hunger = null; // 0 a 20, lue a l'ecran, voir hunger.js
  }

  /** Niveau d'XP : la commande quand elle est disponible, sinon la lecture ecran. */
  get xpLevel() {
    return this.level ?? this.levelScreen;
  }

  #push(kind, target) {
    this.recent.push({ kind, target, at: Date.now() });
  }

  /**
   * Retour au menu principal : on oublie tout ce qui appartient au monde quitte,
   * pour ne rien en afficher dans le monde suivant. Les compteurs de session
   * (blocs, kills, morts) sont conserves. Renvoie vrai si l'etat a change.
   */
  enterMenu() {
    if (this.inMenu) return false;
    this.inMenu = true;
    this.cameFromRlcraft = this.rlcraft !== null; // avant d'oublier le monde quitte
    this.screen = null;
    Object.assign(this.player, { dimension: null, pos: null, travel: null, underwater: false });
    this.world = { day: null, timeOfDay: null, weather: null };
    this.players = { count: null, max: null };
    this.nearby = { monsters: 0 };
    this.armor = { head: null, chest: null, legs: null, feet: null };
    this.lastKill = null;
    this.lastDeath = null;
    this.recent = [];
    this.rlcraft = null;
    this.rlcraftRaw = null;
    this.level = null;
    this.levelScreen = null;
    this.hunger = null;
    return true;
  }

  /** Entree dans un monde. Renvoie vrai si l'etat a change. */
  leaveMenu() {
    if (!this.inMenu) return false;
    this.inMenu = false;
    this.player.lastMoveAt = Date.now(); // pas de faux "En pause" a l'arrivee
    return true;
  }

  applyEvent(name, b) {
    const now = Date.now();
    // Seul un monde charge emet des events.
    this.lastEventAt = now;
    this.leaveMenu();
    if (b.player) {
      this.player.name = b.player.name ?? this.player.name;
      if (b.player.dimension !== undefined) this.player.dimension = b.player.dimension;
      if (b.player.position) this.player.pos = b.player.position;
    }

    switch (name) {
      case 'PlayerTransform':
        this.player.lastMoveAt = now;
        break;
      case 'PlayerTravelled':
        this.player.lastMoveAt = now;
        this.player.travel = b.travelMethod;
        this.player.underwater = Boolean(b.isUnderwater);
        break;
      case 'BlockBroken':
        if (TECHNICAL_BLOCK.test(idOf(b.block))) break;
        this.counters.blocksBroken += b.count ?? 1;
        this.#push('mining', idOf(b.block));
        break;
      case 'BlockPlaced':
        if (TECHNICAL_BLOCK.test(idOf(b.block))) break;
        this.#push('building', idOf(b.block));
        break;
      case 'MobKilled': {
        const type = b.victim?.type ?? '';
        const hunting = (!b.isMonster && type.startsWith('minecraft:')) || RLCRAFT_PASSIVE.has(type);
        this.counters.kills++;
        this.lastKill = { type, hunting, at: now };
        // L'event embarque l'armure portee : source la plus fiable pour la rafraichir.
        this.armor = {
          head: idOf(b.armorHead), chest: idOf(b.armorTorso),
          legs: idOf(b.armorLegs), feet: idOf(b.armorFeet),
        };
        break;
      }
      case 'PlayerDied':
        this.counters.deaths++;
        this.lastDeath = { cause: b.cause, at: now };
        break;
      case 'ItemCrafted':
        this.#push('crafting', idOf(b.item));
        break;
      case 'ItemSmelted':
        this.#push('smelting', idOf(b.item));
        break;
      case 'ItemAcquired':
        if (idOf(b.item) === 'hfrlc:copper_coin') this.counters.coins += b.count ?? 1;
        break;
      case 'ItemEquipped': {
        const slot = ARMOR_SLOTS[b.slot];
        if (slot) this.armor[slot] = idOf(b.item);
        break;
      }
    }
  }

  /**
   * Resultats du polling rapide. querytarget donne la dimension meme quand le
   * joueur est immobile ou le jeu en pause, sans attendre un premier event.
   */
  applyPoll({ target, time, day, weather, monsters, list }) {
    // Au menu principal, meme `list` et `time` repondent « commande inconnue » :
    // sans monde charge, il n'y a plus de commandes. Dans un monde, avec ou sans
    // cheats et meme mort, ces deux-la reussissent toujours.
    const answered = (r) => !r.timeout && !r.disconnected && !r.refused;
    if ([target, time, list].every((r) => answered(r) && r.statusCode < 0)) {
      // Meme reponse dans un monde sans cheats quand la connexion y a ete
      // rouverte automatiquement (par exemple apres un redemarrage de la
      // presence) : le jeu y refuse alors toutes les commandes. Un event recent
      // ou le HUD vu a l'ecran prouvent qu'on est toujours en jeu.
      // Seule une preuve posterieure au debut des refus compte : en sortant
      // normalement vers le menu, events et HUD s'arretent en meme temps que
      // les commandes, et l'on attend alors simplement qu'ils se taisent.
      const now = Date.now();
      this.failingSince ??= now;
      if (this.lastEventAt > this.failingSince || this.lastHudAt > this.failingSince) {
        this.commandsUnavailable = true;
        this.leaveMenu(); // corrige un faux « menu » conclu faute de preuve
        return;
      }
      // Monde qui refuse les commandes : leur echec ne dit plus rien du menu.
      if (this.commandsUnavailable) return;
      if (now - this.lastEventAt >= 8_000 && now - this.lastHudAt >= 6_000) this.enterMenu();
      return;
    }
    if ([time, list].some((r) => r.statusCode >= 0)) {
      this.failingSince = null;
      this.commandsUnavailable = false;
      this.leaveMenu();
    }

    if (target.statusCode >= 0 && target.details) {
      try {
        const [me] = JSON.parse(target.details);
        if (me) {
          this.player.dimension = me.dimension;
          this.player.pos = me.position;
        }
      } catch { /* reponse inattendue : on garde les dernieres valeurs */ }
    }
    if (time.statusCode >= 0 && Number.isFinite(time.data)) this.world.timeOfDay = time.data;
    if (day.statusCode >= 0 && Number.isFinite(day.data)) this.world.day = day.data;
    if (weather.statusCode >= 0 && Number.isFinite(weather.data)) this.world.weather = weather.data;
    // testfor echoue quand personne ne correspond : c'est un zero, pas une erreur.
    this.nearby.monsters = monsters.statusCode >= 0 ? (monsters.victim ?? []).length : 0;
    if (list.statusCode >= 0) {
      this.players.count = list.currentPlayerCount;
      this.players.max = list.maxPlayerCount;
    }
  }

  /** Stats RLCraft, stockees par l'addon dans des scoreboards et des tags. */
  applyRlcraft(scores, tags) {
    const sc = {};
    // \s couvre l'espace insecable que la typographie francaise place avant ":".
    for (const m of stripColors(scores.statusMessage).matchAll(/^- ([\w.]+)\s*:\s*(-?\d+)/gm)) {
      sc[m[1]] = Number(m[2]);
    }
    if (!('melee' in sc)) {
      this.rlcraft = null; // monde sans RLCraft
      this.rlcraftRaw = null;
      return;
    }
    const tg = [...String(tags.statusMessage ?? '').matchAll(/§a(.*?)§r/g)].map((m) => m[1]);
    this.rlcraftRaw = { scores: sc, tags: tg }; // pour le mode trace
    const trinkets = [];
    for (const t of tg.filter((t) => t.startsWith('{"trinkets"'))) {
      try { trinkets.push(JSON.parse(t).trinkets.id); } catch { /* tag mal forme */ }
    }
    this.rlcraft = {
      skills: { melee: sc.melee, armor: sc.armor, mining: sc.mining, agility: sc.agility },
      thirst: Number.isFinite(sc.thirst)
        ? Math.max(0, Math.min(10, Math.round(sc.thirst / THIRST_PER_DROP)))
        : null,
      hearts: Math.max(0, ...tg.map((t) => Number(/^health(\d+)$/.exec(t)?.[1] ?? 0))),
      trinkets,
      sets: tg.filter((t) => t.endsWith('_armor_set')).map((t) => t.replace(/_armor_set$/, '')),
      dragonSlayer: tg.includes('dragon_slayer'),
    };
  }

  /** Deduit l'activite courante, par ordre de priorite. */
  activity(now = Date.now()) {
    if (this.inMenu) return { kind: 'menu' };
    if (this.screen) return { kind: this.screen === 'pause' ? 'paused' : this.screen };
    this.recent = this.recent.filter((a) => now - a.at < WINDOW_MS);

    if (this.lastDeath && now - this.lastDeath.at < 15_000) {
      return { kind: 'dead', cause: this.lastDeath.cause };
    }
    if (this.lastKill && now - this.lastKill.at < 20_000) {
      return { kind: this.lastKill.hunting ? 'hunting' : 'fighting', target: this.lastKill.type };
    }
    for (const kind of ['mining', 'building']) {
      const acts = this.recent.filter((a) => a.kind === kind);
      if (acts.length >= 3) return { kind, target: mostCommon(acts.map((a) => a.target)) };
    }
    const craft = this.recent.findLast((a) => ['crafting', 'smelting'].includes(a.kind) && now - a.at < 15_000);
    if (craft) return { kind: craft.kind, target: craft.target };

    if (now - this.player.lastMoveAt > 60_000) return { kind: 'idle' };
    if (this.player.travel === 6) return { kind: 'riding' };
    if (this.player.underwater || this.player.travel === 1) return { kind: 'swimming' };
    return { kind: 'exploring' };
  }
}
