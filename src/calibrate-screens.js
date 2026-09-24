// npm run calibrate-screens : apprend a reconnaitre le menu pause, l'inventaire,
// les coffres, la poche a trinkets et le menu LVL UP, et enregistre leurs
// signatures dans hud.json. Necessite la calibration de la faim (npm run
// calibrate) : la barre de faim visible signifie « en jeu », masquee « un
// ecran est ouvert ».
//
// Pour n'apprendre que certains ecrans et garder les autres :
//   npm run calibrate-screens -- trinkets lvlup
//
// En plein ecran, le joueur ne voit pas ce terminal : chaque etape se signale
// par un bip. Aigu = capture faite, ferme l'ecran ; grave = recommence l'ecran
// en cours (ses deux ouvertures) ; double = ouvre maintenant le menu LVL UP ;
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
// HUD visible, dont l'ouverture ne se voit pas a la barre de faim.
const SCREENS = [
  { name: 'pause', label: 'le MENU PAUSE (Echap)', again: 'rouvre le MENU PAUSE' },
  { name: 'inventory', label: 'ton INVENTAIRE', again: 'rouvre ton INVENTAIRE' },
  { name: 'chest', label: 'un COFFRE SIMPLE (pas un grand coffre)', again: 'ouvre un AUTRE COFFRE SIMPLE, au contenu different' },
  { name: 'largeChest', label: 'un GRAND COFFRE', again: 'ouvre un AUTRE GRAND COFFRE, au contenu different' },
  { name: 'trinkets', label: 'ta POCHE A TRINKETS', again: 'rouvre ta POCHE A TRINKETS' },
  { name: 'lvlup', label: 'le menu LVL UP', again: 'rouvre le menu LVL UP', overlay: true },
];
const ATTEMPTS = 3; // essais par ecran
// Ressemblance minimale de deux ouvertures du meme ecran (voir similarity) :
// 1 pour le meme ecran, un peu moins pour deux coffres au contenu different,
// 0,7 environ entre l'inventaire et un coffre.
const SAME_SCREEN = 0.8;
const OVERLAY_DELAY = 7000; // ms laissees pour ouvrir un menu superpose apres le bip double
const OVERLAY_CHANGE = 0.3; // part minimale du centre de l'ecran qui change a son ouverture
const OVERLAY_SAME = 0.6; // ressemblance minimale de deux ouvertures d'un menu superpose, hors fond

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
  const wanted = process.argv.slice(2);
  const unknown = wanted.filter((n) => !SCREENS.some((s) => s.name === n));
  if (unknown.length) {
    throw new Error(`ecran inconnu : ${unknown.join(', ')} (au choix : ${SCREENS.map((s) => s.name).join(', ')})`);
  }
  const run = wanted.length ? SCREENS.filter((s) => wanted.includes(s.name)) : SCREENS;
  const g = hud.hunger;
  const inGameNow = (w) => hungerVisible(w, g);

  const win = await waitFor(inGameNow, 60, 'Reviens dans Minecraft, en jeu, sans aucun menu ouvert...');
  if (win.w !== hud.window.w || win.h !== hud.window.h) {
    throw new Error('la fenetre a change de taille : relance d\'abord `npm run calibrate`');
  }
  // Zone d'un menu superpose : le centre de l'ecran, sans le HUD du bas (coeurs,
  // faim, barre d'objets) ni les coordonnees du haut, qui changent en jouant.
  const region = {
    x0: Math.round(win.w * 0.15), x1: Math.round(win.w * 0.85),
    y0: Math.round(win.h * 0.2), y1: g.y - 40 * g.cell,
  };
  await sleep(500);
  const inGame = await grabFull(win);
  debugSave(inGame, 'en-jeu');
  console.log('Capture en jeu faite.');
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

  /** Attend la fermeture d'un menu superpose : le centre de l'ecran change nettement. */
  async function overlayClosed(open, prefix) {
    await waitFor(async (x) => 1 - alikeIn(open, await grabFull(x), region) >= OVERLAY_CHANGE, 90,
      `${prefix} : ferme le menu et reviens en jeu...`);
  }

  const captured = {};
  for (const [index, s] of run.entries()) {
    const prefix = `Ecran ${index + 1}/${run.length}`;
    const capture = s.overlay ? captureOverlay : captureOpen;
    const closed = s.overlay
      ? (open) => overlayClosed(open, prefix)
      : () => waitFor(inGameNow, 90, `${prefix} : ferme-le et reviens en jeu...`);
    for (let attempt = 1; ; attempt++) {
      let open = null;
      try {
        const first = await capture(`${prefix}, ouverture 1/2 : ouvre ${s.label}, souris hors des cases et des boutons, et attends le bip...`,
          `${s.name}-1`);
        open = first.a;
        if (!s.overlay) {
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
        const alike = s.overlay ? alikeIn(first.a, second.a, region, backdropMask(first.a)) : similarity(first.a, second.a);
        if (alike < (s.overlay ? OVERLAY_SAME : SAME_SCREEN)) {
          throw new Retry(`les deux ouvertures ne montrent pas le meme ecran (ressemblance ${alike.toFixed(2)})`);
        }
        // Signature = ce qui est stable dans chaque ouverture ET identique entre les deux.
        const stable = stableMask(first.a, first.b);
        const stable2 = stableMask(second.a, second.b);
        const same = stableMask(first.a, second.a);
        for (let i = 0; i < stable.length; i++) stable[i] &= stable2[i] & same[i];
        captured[s.name] = { img: first.a, stable, overlay: !!s.overlay };
        console.log(`${prefix} : captures faites (ressemblance ${alike.toFixed(2)}).`);
        await beep(BEEP_OK);
        await closed(second.a);
        break;
      } catch (e) {
        if (!(e instanceof Retry)) throw e;
        if (attempt === ATTEMPTS) throw new Error(`${s.label} : ${e.message} (${ATTEMPTS} essais)`);
        console.log(`${prefix} : ${e.message}. Recommence cet ecran depuis sa premiere ouverture.`);
        await beep(BEEP_RETRY);
        if (!s.overlay) await waitFor(inGameNow, 90, `${prefix} : ferme-le et reviens en jeu...`);
        else if (open) await overlayClosed(open, prefix);
      }
    }
  }

  const signatures = {};
  for (const s of run) {
    const others = run.filter((o) => o.name !== s.name).map((o) => captured[o.name].img);
    const sig = buildSignature(captured[s.name], others, inGame, { overlay: !!s.overlay, region });
    if (!sig) throw new Error(`aucun element propre a ${s.label} : recommence en ouvrant bien les bons ecrans`);
    signatures[s.name] = sig;
  }
  // Calibration partielle : les ecrans non recalibres gardent leur signature.
  const all = {};
  for (const s of SCREENS) {
    const sig = signatures[s.name] ?? (wanted.length ? hud.screens?.[s.name] : null);
    if (sig) all[s.name] = sig;
  }

  // Controle croise : chaque signature doit reconnaitre son ecran, et lui seul.
  console.log('\nControle croise (zones reconnues a 90 % ou plus) :');
  let confusion = false;
  for (const shown of [...run.map((s) => s.name), 'en jeu']) {
    const img = shown === 'en jeu' ? inGame : captured[shown].img;
    const hits = Object.keys(all).filter((sig) => matches(all[sig].patches.map((p) => patchScore(crop(img, p), p))));
    const expected = shown === 'en jeu' ? [] : [shown];
    const ok = JSON.stringify(hits) === JSON.stringify(expected);
    if (!ok) confusion = true;
    console.log(`  ${ok ? 'OK    ' : 'ERREUR'} ${shown.padEnd(10)} -> ${hits.join(', ') || 'aucun'}`);
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
