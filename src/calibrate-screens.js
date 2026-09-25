// npm run calibrate-screens : apprend a reconnaitre le menu pause, l'inventaire,
// les coffres, la poche a trinkets et le menu LVL UP, et enregistre leurs
// signatures dans hud.json. Necessite la calibration de la faim (npm run
// calibrate) : la barre de faim visible signifie « en jeu », masquee « un
// ecran est ouvert ».
//
// Pour n'apprendre que certains ecrans et garder les autres :
//   npm run calibrate-screens -- trinkets lvlup
//
// npm run calibrate-menus (--menus) : ecrans du menu principal (Jouer et ses
// onglets, Parametres, Marche, Vestiaire), ouverts depuis l'ecran titre.
//
// En plein ecran, le joueur ne voit pas ce terminal : chaque etape se signale
// par un bip. Aigu = capture faite, ferme l'ecran ; grave = recommence l'ecran
// en cours (ses deux ouvertures) ; double = ouvre maintenant l'ecran demande
// (menu LVL UP, ecrans du menu principal) ;
// trois notes montantes = termine.
import { execFile } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { ScreenReader } from './screen.js';
import { readHunger } from './hunger.js';
import { backdropMask, buildSignature, matches, patchScore, similarity, stableMask, uiMask } from './screens.js';

const HUD_FILE = new URL('../hud.json', import.meta.url);
// Chaque ecran est ouvert deux fois : seul ce qui est identique les deux fois
// entre dans la signature. Les boutons survoles par la souris et le contenu
// des coffres sont ainsi exclus. `overlay` : menu dessine par-dessus le jeu,
// HUD visible, dont l'ouverture ne se voit pas a la barre de faim. `menu` :
// ecran du menu principal, reconnu a son en-tete (voir buildSignature).
const SCREENS = [
  { name: 'pause', label: 'le MENU PAUSE (Echap)', again: 'rouvre le MENU PAUSE' },
  { name: 'inventory', label: 'ton INVENTAIRE', again: 'rouvre ton INVENTAIRE' },
  { name: 'chest', label: 'un COFFRE SIMPLE (pas un grand coffre)', again: 'ouvre un AUTRE COFFRE SIMPLE, au contenu different' },
  { name: 'largeChest', label: 'un GRAND COFFRE', again: 'ouvre un AUTRE GRAND COFFRE, au contenu different' },
  { name: 'trinkets', label: 'ta POCHE A TRINKETS', again: 'rouvre ta POCHE A TRINKETS' },
  { name: 'lvlup', label: 'le menu LVL UP', again: 'rouvre le menu LVL UP', overlay: true },
  // Menu principal. `band` : hauteur de l'en-tete retenu (part de l'ecran) :
  // barre de titre et onglets pour Jouer, barre de titre seule ailleurs (en
  // dessous, le contenu change : texte d'une categorie de Parametres, offres
  // du Marche). Jouer se rouvre sur le dernier onglet utilise, il faut cliquer
  // le bon ; `wait` laisse sa liste de mondes finir de charger, son compteur
  // « Mondes (N) » change pendant ce temps.
  { name: 'menuWorlds', label: 'JOUER puis clique l\'onglet MONDES', again: 'rouvre JOUER, onglet MONDES', menu: true, band: 0.13, wait: 12000 },
  { name: 'menuRealms', label: 'JOUER puis clique l\'onglet REALMS', again: 'rouvre JOUER, onglet REALMS', menu: true, band: 0.13, wait: 12000 },
  { name: 'menuServers', label: 'JOUER puis clique l\'onglet SERVEURS', again: 'rouvre JOUER, onglet SERVEURS', menu: true, band: 0.13, wait: 12000 },
  { name: 'menuSettings', label: 'les PARAMETRES', again: 'rouvre les PARAMETRES', menu: true, band: 0.06 },
  { name: 'marketplace', label: 'le MARCHE', again: 'rouvre le MARCHE', menu: true, band: 0.06 },
  { name: 'dressingRoom', label: 'le VESTIAIRE', again: 'rouvre le VESTIAIRE', menu: true, band: 0.06 },
];
const ATTEMPTS = 3; // essais par ecran
const START_WAIT = 300; // s pour revenir au jeu au lancement, le temps de lire les consignes
// Ressemblance minimale de deux ouvertures du meme ecran (voir similarity) :
// 1 pour le meme ecran, un peu moins pour deux coffres au contenu different,
// 0,7 environ entre l'inventaire et un coffre.
const SAME_SCREEN = 0.8;
const OVERLAY_DELAY = 7000; // ms laissees pour ouvrir un menu superpose apres le bip double
const OVERLAY_CHANGE = 0.3; // part minimale du centre de l'ecran qui change a son ouverture
const OVERLAY_SAME = 0.6; // ressemblance minimale de deux ouvertures d'un menu superpose, hors fond
// En-tete des ecrans du menu principal : titre et onglets, sans les bords ou le
// decor anime reste visible. Mesure sur Jouer : 0,996 entre deux ouvertures du
// meme onglet, 0,69 a 0,70 entre deux onglets.
const MENU_BAND = { left: 0.1, right: 0.9, top: 0.15 };
const MENU_BAR = 0.5; // part claire minimale du haut de l'ecran : la barre de titre (0,98 sur Jouer, 0,74 sur le Marche, 0,07 sur l'ecran titre)
const MENU_SAME = 0.9; // ressemblance minimale de deux ouvertures du meme ecran
const MENU_DISTINCT = 0.95; // au-dela, c'est l'ecran d'une etape precedente

const BEEP_OK = [[1200, 150]];
const BEEP_RETRY = [[300, 700]];
const BEEP_GO = [[900, 100], [0, 80], [900, 100]];
const BEEP_DONE = [[800, 120], [1000, 120], [1300, 300]];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const screen = new ScreenReader().start();

/** Joue une suite de notes [frequence, duree ms] (frequence 0 : silence) ; la promesse se resout a la fin. */
function beep(tones) {
  const script = tones.map(([f, ms]) => (f ? `[console]::beep(${f},${ms})` : `Start-Sleep -Milliseconds ${ms}`)).join(';');
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true }, () => resolve());
  });
}

/** Un ecran a recommencer, pour la raison donnee. */
class Retry extends Error {}

/** Capture toute la zone client, par bandes pour limiter la taille des echanges. */
async function grabFull(win) {
  const data = Buffer.alloc(win.w * win.h * 4);
  for (let y = 0; y < win.h; y += 216) {
    const part = await screen.grab(win.x, win.y + y, win.w, Math.min(216, win.h - y));
    part.data.copy(data, y * win.w * 4);
  }
  return { w: win.w, h: win.h, data };
}

async function hungerVisible(win, g) {
  const img = await screen.grab(win.x + g.x, win.y + g.y - g.cell, 9 * g.period + 9 * g.cell, 11 * g.cell);
  return readHunger(img, { x: 0, y: g.cell, cell: g.cell, period: g.period }) !== null;
}

/** Attend qu'une condition soit vraie, Minecraft au premier plan ; message chaque 5 s. */
async function waitFor(check, seconds, message) {
  for (let i = 0; i < seconds * 2; i++) {
    const win = await screen.window();
    if (win.found && win.fg && !win.minimized && await check(win)) return win;
    if (i % 10 === 0) console.log(message);
    await sleep(500);
  }
  throw new Error(`delai depasse : ${message}`);
}

/** Diagnostic (CALIBRATION_DEBUG=<dossier>) : enregistre chaque capture, en BGRA brut. */
let debugCount = 0;
function debugSave(img, name) {
  const dir = process.env.CALIBRATION_DEBUG;
  if (!dir) return;
  debugCount++;
  writeFileSync(`${dir}/${String(debugCount).padStart(2, '0')}-${name}-${img.w}x${img.h}.bgra`, img.data);
}

/** Part des pixels de `region` (un sur quatre) identiques dans deux captures, hors `skip`. */
function alikeIn(a, b, region, skip = null) {
  let counted = 0;
  let same = 0;
  for (let y = region.y0; y < region.y1; y += 2) {
    for (let x = region.x0; x < region.x1; x += 2) {
      const i = y * a.w + x;
      if (skip?.[i]) continue;
      counted++;
      const d = Math.max(Math.abs(a.data[i * 4] - b.data[i * 4]), Math.abs(a.data[i * 4 + 1] - b.data[i * 4 + 1]),
        Math.abs(a.data[i * 4 + 2] - b.data[i * 4 + 2]));
      if (d <= 20) same++;
    }
  }
  return counted ? same / counted : 0;
}

/** Part des pixels clairs et gris dans le haut (5 %) d'une capture : la barre de titre des ecrans du menu. */
function titleBar(img) {
  let counted = 0;
  let light = 0;
  for (let y = 0; y < Math.round(img.h * 0.05); y += 2) {
    for (let x = 0; x < img.w; x += 2) {
      const i = (y * img.w + x) * 4;
      const [b, g, r] = [img.data[i], img.data[i + 1], img.data[i + 2]];
      counted++;
      if (0.299 * r + 0.587 * g + 0.114 * b >= 180 && Math.max(r, g, b) - Math.min(r, g, b) <= 24) light++;
    }
  }
  return light / counted;
}

/** Recadre une zone d'une capture plein ecran. */
function crop(img, p) {
  const out = { w: p.w, h: p.h, data: Buffer.alloc(p.w * p.h * 4) };
  for (let y = 0; y < p.h; y++) img.data.copy(out.data, y * p.w * 4, ((p.y + y) * img.w + p.x) * 4, ((p.y + y) * img.w + p.x + p.w) * 4);
  return out;
}

try {
  let hud;
  try {
    hud = JSON.parse(readFileSync(HUD_FILE, 'utf8'));
  } catch {
    throw new Error('lance d\'abord `npm run calibrate` (calibration de la faim)');
  }
  const MENUS = process.argv.includes('--menus');
  const group = SCREENS.filter((s) => !!s.menu === MENUS);
  const wanted = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const unknown = wanted.filter((n) => !group.some((s) => s.name === n));
  if (unknown.length) {
    throw new Error(`ecran inconnu : ${unknown.join(', ')} (au choix : ${group.map((s) => s.name).join(', ')})`);
  }
  const run = wanted.length ? group.filter((s) => wanted.includes(s.name)) : group;
  const g = hud.hunger;
  const inGameNow = (w) => hungerVisible(w, g);
  const atMenuNow = async (w) => !(await hungerVisible(w, g));

  const win = MENUS
    ? await waitFor(atMenuNow, START_WAIT, 'Va sur l\'ecran titre du menu principal, sans rien ouvrir...')
    : await waitFor(inGameNow, START_WAIT, 'Reviens dans Minecraft, en jeu, sans aucun menu ouvert...');
  if (win.w !== hud.window.w || win.h !== hud.window.h) {
    throw new Error('la fenetre a change de taille : relance d\'abord `npm run calibrate`');
  }
  // Zone d'un menu superpose : le centre de l'ecran, sans le HUD du bas (coeurs,
  // faim, barre d'objets) ni les coordonnees du haut, qui changent en jouant.
  const region = {
    x0: Math.round(win.w * 0.15), x1: Math.round(win.w * 0.85),
    y0: Math.round(win.h * 0.2), y1: g.y - 40 * g.cell,
  };
  // Comparaisons d'ecrans du menu : bande centrale, sans le decor anime des bords.
  const menuRegion = {
    x0: Math.round(win.w * MENU_BAND.left), x1: Math.round(win.w * MENU_BAND.right),
    y0: 0, y1: Math.round(win.h * MENU_BAND.top),
  };
  // Leurs signatures : toute la largeur, sur la hauteur de l'en-tete de chaque
  // ecran. Le titre du Marche et du Vestiaire est colle a gauche ; le decor
  // anime, lui, change d'une ouverture a l'autre et n'entre donc pas dans la
  // signature.
  const menuSignatureRegion = (s) => ({ x0: 0, x1: win.w, y0: 0, y1: Math.round(win.h * s.band) });
  // Reference : le jeu sans menu, ou l'ecran titre pour les ecrans du menu principal.
  await sleep(MENUS ? 2000 : 500);
  const reference = await grabFull(win);
  debugSave(reference, MENUS ? 'ecran-titre' : 'en-jeu');
  console.log(MENUS ? 'Capture de l\'ecran titre faite.' : 'Capture en jeu faite.');
  await beep(BEEP_OK);

  /** Deux captures d'un ecran ouvert (barre de faim masquee), a une seconde d'intervalle. */
  async function captureOpen(prompt, name) {
    const w = await waitFor(async (x) => !(await hungerVisible(x, g)), 90, prompt);
    await sleep(1500); // fin de l'animation d'ouverture
    const a = await grabFull(w);
    await sleep(1000);
    const b = await grabFull(w);
    debugSave(a, `${name}a`);
    debugSave(b, `${name}b`);
    if (await hungerVisible(w, g)) throw new Retry('l\'ecran s\'est referme pendant les captures, garde-le ouvert plus longtemps');
    return { a, b };
  }

  /** Idem pour un menu superpose au jeu : ouvert au bip double, capture quelques secondes apres. */
  async function captureOverlay(prompt, name) {
    const w = await waitFor(inGameNow, 90, 'Reviens en jeu, sans aucun menu ouvert...');
    const before = await grabFull(w);
    console.log(`${prompt} (au bip double, tu as ${OVERLAY_DELAY / 1000} secondes)`);
    await beep(BEEP_GO);
    await sleep(OVERLAY_DELAY);
    const a = await grabFull(w);
    await sleep(1000);
    const b = await grabFull(w);
    debugSave(a, `${name}a`);
    debugSave(b, `${name}b`);
    if (!(await hungerVisible(w, g))) throw new Retry('la barre de faim a disparu : ce n\'est pas ce menu-la');
    if (1 - alikeIn(before, a, region) < OVERLAY_CHANGE) throw new Retry('rien ne s\'est ouvert au centre de l\'ecran');
    return { a, b };
  }

  /** Ecran du menu principal : ouvert au bip double depuis l'ecran titre, capture quelques secondes apres. */
  async function captureMenu(prompt, name, wait = OVERLAY_DELAY) {
    const w = await waitFor(atMenuNow, 90, 'Reviens au menu principal...');
    console.log(`${prompt} (au bip double, tu as ${wait / 1000} secondes, puis souris en bas de l'ecran)`);
    await beep(BEEP_GO);
    await sleep(wait);
    const a = await grabFull(w);
    await sleep(1000);
    const b = await grabFull(w);
    debugSave(a, `${name}a`);
    debugSave(b, `${name}b`);
    // Les ecrans du menu ont une barre de titre claire en haut ; l'ecran titre, non.
    const bar = titleBar(a);
    if (bar < MENU_BAR) throw new Retry(`pas de barre de titre en haut de l'ecran (${bar.toFixed(2)}) : rien ne s'est ouvert a temps`);
    return { a, b };
  }

  /** Attend qu'un ecran sans barre de faim a surveiller soit quitte : sa zone change nettement. */
  async function screenLeft(open, zone, message) {
    await waitFor(async (x) => 1 - alikeIn(open, await grabFull(x), zone) >= OVERLAY_CHANGE, 90, message);
  }
  const unstable = (c) => stableMask(c.a, c.b).map((v) => 1 - v);

  const captured = {};
  for (const [index, s] of run.entries()) {
    const prefix = `Ecran ${index + 1}/${run.length}`;
    const capture = s.menu ? (prompt, name) => captureMenu(prompt, name, s.wait) : s.overlay ? captureOverlay : captureOpen;
    const closed = s.menu ? (open) => screenLeft(open, menuRegion, `${prefix} : reviens a l'ecran titre...`)
      : s.overlay ? (open) => screenLeft(open, region, `${prefix} : ferme le menu et reviens en jeu...`)
        : () => waitFor(inGameNow, 90, `${prefix} : ferme-le et reviens en jeu...`);
    for (let attempt = 1; ; attempt++) {
      let open = null;
      try {
        const first = await capture(`${prefix}, ouverture 1/2 : ouvre ${s.label}, souris hors des cases et des boutons, et attends le bip...`,
          `${s.name}-1`);
        open = first.a;
        if (s.menu) {
          for (const [other, c] of Object.entries(captured)) {
            if (alikeIn(first.a, c.img, menuRegion, unstable(first)) >= MENU_DISTINCT) throw new Retry(`c'est le meme ecran que « ${other} »`);
          }
        } else if (!s.overlay) {
          if (!uiMask(first.a).includes(1)) throw new Retry('aucun panneau gris d\'interface a l\'ecran');
          for (const [other, c] of Object.entries(captured)) {
            if (!c.overlay && similarity(first.a, c.img) >= SAME_SCREEN) throw new Retry(`c'est le meme ecran que « ${other} »`);
          }
        }
        await beep(BEEP_OK);
        await closed(first.a);

        const second = await capture(`${prefix}, ouverture 2/2 : ${s.again}, souris hors des cases et des boutons, et attends le bip...`,
          `${s.name}-2`);
        open = second.a;
        const alike = s.menu ? alikeIn(first.a, second.a, menuRegion, unstable(first))
          : s.overlay ? alikeIn(first.a, second.a, region, backdropMask(first.a)) : similarity(first.a, second.a);
        if (alike < (s.menu ? MENU_SAME : s.overlay ? OVERLAY_SAME : SAME_SCREEN)) {
          throw new Retry(`les deux ouvertures ne montrent pas le meme ecran (ressemblance ${alike.toFixed(2)})`);
        }
        // Signature = ce qui est stable dans chaque ouverture ET identique entre les deux.
        const stable = stableMask(first.a, first.b);
        const stable2 = stableMask(second.a, second.b);
        const same = stableMask(first.a, second.a);
        for (let i = 0; i < stable.length; i++) stable[i] &= stable2[i] & same[i];
        captured[s.name] = { img: first.a, img2: second.a, stable, overlay: !!s.overlay, menu: !!s.menu };
        console.log(`${prefix} : captures faites (ressemblance ${alike.toFixed(2)}).`);
        await beep(BEEP_OK);
        await closed(second.a);
        break;
      } catch (e) {
        if (!(e instanceof Retry)) throw e;
        if (attempt === ATTEMPTS) throw new Error(`${s.label} : ${e.message} (${ATTEMPTS} essais)`);
        console.log(`${prefix} : ${e.message}. Recommence cet ecran depuis sa premiere ouverture.`);
        await beep(BEEP_RETRY);
        if (!s.menu && !s.overlay) await closed();
        else if (open) await closed(open);
      }
    }
  }

  const signatures = {};
  for (const s of run) {
    // Les deux ouvertures des autres ecrans : un element qui a varie chez eux
    // (compteur « Mondes (N) » en cours de chargement...) n'est pas distinctif.
    const others = run.filter((o) => o.name !== s.name).flatMap((o) => [captured[o.name].img, captured[o.name].img2]);
    const sig = buildSignature(captured[s.name], others, reference,
      { overlay: !!s.overlay, menu: !!s.menu, region: s.menu ? menuSignatureRegion(s) : region });
    if (!sig) throw new Error(`aucun element propre a ${s.label} : recommence en ouvrant bien les bons ecrans`);
    signatures[s.name] = sig;
  }
  // Les ecrans non recalibres (autre groupe, ou calibration partielle) gardent leur signature.
  const all = {};
  for (const s of SCREENS) {
    const sig = signatures[s.name] ?? (run.includes(s) ? null : hud.screens?.[s.name]);
    if (sig) all[s.name] = sig;
  }

  // Controle croise : chaque signature doit reconnaitre son ecran, et lui seul.
  console.log('\nControle croise (zones reconnues a 90 % ou plus) :');
  let confusion = false;
  const referenceName = MENUS ? 'ecran titre' : 'en jeu';
  for (const shown of [...run.map((s) => s.name), referenceName]) {
    const img = shown === referenceName ? reference : captured[shown].img;
    const hits = Object.keys(all).filter((sig) => matches(all[sig].patches.map((p) => patchScore(crop(img, p), p))));
    const expected = shown === referenceName ? [] : [shown];
    const ok = JSON.stringify(hits) === JSON.stringify(expected);
    if (!ok) confusion = true;
    console.log(`  ${ok ? 'OK    ' : 'ERREUR'} ${shown.padEnd(12)} -> ${hits.join(', ') || 'aucun'}`);
  }
  if (confusion) throw new Error('les signatures se confondent : recommence la calibration');

  hud.screens = all;
  delete hud.pause; // ancienne signature du seul menu pause
  writeFileSync(HUD_FILE, `${JSON.stringify(hud, null, 2)}\n`);
  for (const s of run) {
    console.log(`Signature « ${s.name} » : ${signatures[s.name].patches.length} zones (contours : `
      + `${signatures[s.name].patches.map((p) => p.details).join(', ')}).`);
  }
  console.log('Calibration des ecrans terminee.');
  await beep(BEEP_DONE);
} catch (e) {
  console.error(`Echec de la calibration : ${e.message}`);
  process.exitCode = 1;
  await beep([[300, 300], [200, 900]]);
} finally {
  screen.stop();
}
