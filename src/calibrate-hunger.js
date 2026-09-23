// npm run calibrate : repere la barre de faim sur l'ecran et ecrit hud.json.
// A relancer apres un changement de resolution ou d'echelle d'interface.
import { writeFileSync } from 'node:fs';
import { ScreenReader } from './screen.js';
import { findHungerBar, readHunger } from './hunger.js';

const HUD_FILE = new URL('../hud.json', import.meta.url);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const screen = new ScreenReader().start();

try {
  let win = await screen.window();
  if (!win.found) throw new Error('Minecraft ne tourne pas.');
  for (let i = 30; i > 0 && !win.fg; i--) {
    console.log(`Reviens dans Minecraft, en jeu, HUD visible et inventaire ferme... ${i}`);
    await sleep(1000);
    win = await screen.window();
  }
  if (!win.fg || win.minimized) throw new Error('Minecraft n\'est pas au premier plan.');

  // La barre de faim est en bas, a droite du centre.
  const region = {
    x: Math.round(win.w * 0.15), y: Math.round(win.h * 0.55),
    w: Math.round(win.w * 0.7), h: Math.round(win.h * 0.45),
  };
  const img = await screen.grab(win.x + region.x, win.y + region.y, region.w, region.h);
  const started = Date.now();
  const bar = findHungerBar(img);
  if (!bar) {
    throw new Error('Barre de faim introuvable : es-tu en survie, HUD visible, sans menu ouvert ?');
  }

  const hud = {
    window: { w: win.w, h: win.h },
    hunger: { x: region.x + bar.x, y: region.y + bar.y, cell: bar.cell, period: bar.period },
  };
  writeFileSync(HUD_FILE, `${JSON.stringify(hud, null, 2)}\n`);

  const points = readHunger(img, bar);
  console.log(`Barre trouvee en ${Date.now() - started} ms : origine (${hud.hunger.x}, ${hud.hunger.y}), `
    + `echelle x${bar.cell}, fenetre ${win.w}x${win.h}.`);
  console.log(points === null
    ? 'Lecture de controle impossible (HUD masque ?) : relance la calibration.'
    : `Lecture de controle : ${points}/20, soit ${points / 2} cuisses sur 10. Compare avec ton HUD.`);
  console.log('Calibration enregistree dans hud.json.');
} catch (e) {
  console.error(`Echec de la calibration : ${e.message}`);
  process.exitCode = 1;
} finally {
  screen.stop();
}
