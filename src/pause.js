// Detection du menu pause a l'ecran. Le jeu ne le signale pas (ScreenChanged
// ne remonte plus) et, en multijoueur, rien ne se fige : on reconnait le menu
// lui-meme.
//
// Calibration : trois captures plein ecran, une en jeu et deux en pause. Les
// pixels identiques dans les deux captures en pause et absents en jeu sont le
// menu : ce qui bouge dans le monde (eau, mobs, nuages) n'est pas stable.
//
// Le fond gris des boutons (#C6C6C6) est commun a d'autres ecrans (inventaire,
// coffres) : il ne suffit pas. On retient donc des zones faites surtout de
// bouton (pixels clairs), en privilegiant celles qui contiennent du texte
// (pixels fonces encadres par le bouton sur leur ligne) : « Reprendre le jeu »,
// « Parametres »... n'existent qu'ici. Chaque zone melange texte et fond, si
// bien qu'un simple panneau gris plafonne vers 50 %.

const CELL_W = 256; // taille des zones candidates, en pixels ecran
const CELL_H = 64;
const MAX_PATCHES = 3;
const MIN_PANEL = 0.3; // part minimale de bouton / panneau dans une zone
const SAMPLES_PER_KIND = 40; // points de texte et points de fond par zone

const rgbAt = (img, x, y) => {
  const i = (y * img.w + x) * 4;
  return [img.data[i + 2], img.data[i + 1], img.data[i]]; // BGRA -> RGB
};
const luma = ([r, g, b]) => 0.299 * r + 0.587 * g + 0.114 * b;
const maxDiff = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));

/**
 * Construit la signature du menu pause a partir de captures plein ecran de
 * meme taille. Renvoie { patches: [{ x, y, w, h, samples: [[dx, dy, 'rrggbb']] }] }
 * ou null si le menu n'a pas assez d'elements reconnaissables.
 */
export function buildPauseSignature(inGame, paused1, paused2) {
  const cols = Math.floor(inGame.w / CELL_W);
  const rows = Math.floor(inGame.h / CELL_H);
  const cells = [];

  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const panel = [];
      const dark = [];
      const isPanel = new Uint8Array(CELL_W * CELL_H);
      for (let dy = 0; dy < CELL_H; dy++) {
        for (let dx = 0; dx < CELL_W; dx++) {
          const x = cx * CELL_W + dx;
          const y = cy * CELL_H + dy;
          const p = rgbAt(paused1, x, y);
          if (maxDiff(p, rgbAt(paused2, x, y)) > 6) continue; // stable pendant la pause
          if (maxDiff(p, rgbAt(inGame, x, y)) < 60) continue; // absent en jeu
          if (luma(p) >= 180) {
            panel.push([dx, dy, p]);
            isPanel[dy * CELL_W + dx] = 1;
          } else {
            dark.push([dx, dy, p]);
          }
        }
      }
      if (panel.length < MIN_PANEL * CELL_W * CELL_H) continue;
      // Texte : pixel fonce avec du bouton a sa gauche et a sa droite sur la meme
      // ligne. Ecarte le monde assombri visible en bordure de bouton.
      const text = dark.filter(([dx, dy]) => {
        const row = isPanel.subarray(dy * CELL_W, (dy + 1) * CELL_W);
        return row.subarray(0, dx).includes(1) && row.subarray(dx + 1).includes(1);
      });
      cells.push({ cx, cy, panel, text });
    }
  }
  if (!cells.length) return null;

  // Le plus de texte d'abord, puis le plus de bouton ; deux zones voisines
  // designeraient le meme bouton.
  cells.sort((a, b) => b.text.length - a.text.length || b.panel.length - a.panel.length);
  const chosen = [];
  for (const c of cells) {
    if (chosen.some((o) => Math.abs(o.cx - c.cx) <= 1 && Math.abs(o.cy - c.cy) <= 1)) continue;
    chosen.push(c);
    if (chosen.length === MAX_PATCHES) break;
  }

  const hex = ([r, g, b]) => ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
  const spread = (points, n) => {
    const step = Math.max(1, Math.floor(points.length / n));
    return points.filter((_, i) => i % step === 0).slice(0, n);
  };
  return {
    patches: chosen.map((c) => {
      const text = spread(c.text, SAMPLES_PER_KIND);
      // Moins de texte que prevu : on complete avec du fond.
      const panel = spread(c.panel, 2 * SAMPLES_PER_KIND - text.length);
      return {
        x: c.cx * CELL_W, y: c.cy * CELL_H, w: CELL_W, h: CELL_H,
        text: text.length,
        samples: [...text, ...panel].map(([dx, dy, p]) => [dx, dy, hex(p)]),
      };
    }),
  };
}

/** Part des points de signature retrouves dans la capture d'une zone. */
export function patchScore(img, patch) {
  let hits = 0;
  for (const [dx, dy, ref] of patch.samples) {
    const n = parseInt(ref, 16);
    if (maxDiff(rgbAt(img, dx, dy), [n >> 16, (n >> 8) & 0xFF, n & 0xFF]) <= 20) hits++;
  }
  return hits / patch.samples.length;
}

/**
 * Menu pause si au moins 2 zones sur 3 (ou toutes s'il y en a moins)
 * correspondent a 80 %. Un bouton survole par la souris change de couleur :
 * une zone peut donc manquer sans fausser le resultat.
 */
export function isPaused(scores) {
  const needed = Math.min(2, scores.length);
  return scores.filter((s) => s >= 0.8).length >= needed;
}
