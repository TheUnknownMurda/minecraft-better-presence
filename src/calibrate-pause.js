// npm run calibrate-pause : apprend a reconnaitre le menu pause et l'ajoute a
// hud.json. Necessite la calibration de la faim (npm run calibrate), qui sert a
// savoir quand le joueur est en jeu (barre de faim lisible) ou dans un menu.
import { readFileSync, writeFileSync } from 'node:fs';
import { ScreenReader } from './screen.js';
import { readHunger } from './hunger.js';
import { buildPauseSignature, isPaused, patchScore } from './pause.js';

const HUD_FILE = new URL('../hud.json', import.meta.url);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const screen = new ScreenReader().start();

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

async function scores(win, signature) {
  const result = [];
  for (const p of signature.patches) {
    result.push(patchScore(await screen.grab(win.x + p.x, win.y + p.y, p.w, p.h), p));
  }
  return result;
}

try {
  let hud;
  try {
    hud = JSON.parse(readFileSync(HUD_FILE, 'utf8'));
  } catch {
    throw new Error('lance d\'abord `npm run calibrate` (calibration de la faim)');
  }
  const g = hud.hunger;

  const inGameWin = await waitFor((w) => hungerVisible(w, g), 60,
    '1/3 Reviens dans Minecraft, en jeu, sans aucun menu ouvert...');
  if (inGameWin.w !== hud.window.w || inGameWin.h !== hud.window.h) {
    throw new Error('la fenetre a change de taille : relance d\'abord `npm run calibrate`');
  }
  await sleep(500);
  const inGame = await grabFull(inGameWin);
  console.log('Capture en jeu faite.');

  const pausedWin = await waitFor(async (w) => !(await hungerVisible(w, g)), 60,
    '2/3 Ouvre maintenant le MENU PAUSE (Echap) et ne bouge plus...');
  await sleep(1500); // fin de l'animation d'ouverture
  const paused1 = await grabFull(pausedWin);
  await sleep(2000);
  const paused2 = await grabFull(pausedWin);
  if (await hungerVisible(pausedWin, g)) throw new Error('le menu s\'est ferme pendant les captures, recommence');

  const signature = buildPauseSignature(inGame, paused1, paused2);
  if (!signature) throw new Error('aucun element reconnaissable dans ce menu : est-ce bien le menu pause ?');
  hud.pause = signature;
  writeFileSync(HUD_FILE, `${JSON.stringify(hud, null, 2)}\n`);
  const nowPaused = await scores(pausedWin, signature);
  console.log(`Signature enregistree : ${signature.patches.length} zones (points de texte / total : `
    + `${signature.patches.map((p) => `${p.text}/${p.samples.length}`).join(', ')}).`);
  if (signature.patches.some((p) => p.text < 10)) {
    console.log('Attention : une zone contient peu de texte, elle distinguera mal la pause des autres menus.');
  }
  console.log(`Controle en pause : ${nowPaused.map((s) => `${Math.round(s * 100)} %`).join(', ')} -> `
    + `${isPaused(nowPaused) ? 'PAUSE reconnue' : 'NON reconnue (anormal)'}`);

  // La signature est deja enregistree : ce dernier controle n'est qu'une verification.
  try {
    const backWin = await waitFor((w) => hungerVisible(w, g), 60,
      '3/3 Ferme le menu pause et reprends le jeu...');
    await sleep(500);
    const inGameScores = await scores(backWin, signature);
    console.log(`Controle en jeu : ${inGameScores.map((s) => `${Math.round(s * 100)} %`).join(', ')} -> `
      + `${isPaused(inGameScores) ? 'PAUSE (faux positif, anormal)' : 'pas de pause, correct'}`);
  } catch {
    console.log('Controle en jeu non effectue (menu pas referme a temps) : la signature reste valable.');
  }
  console.log('Calibration du menu pause terminee.');
} catch (e) {
  console.error(`Echec de la calibration : ${e.message}`);
  process.exitCode = 1;
} finally {
  screen.stop();
}
