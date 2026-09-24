// Lecture du niveau d'XP sur le HUD. Sans cheats, le jeu refuse le selecteur
// @s[lm=N] de level.js ; le niveau reste ecrit en vert au-dessus de la barre
// d'XP, dans la police pixel de Minecraft (chiffres de 5x7, espaces de 1).
//
// Modeles releves de la police Minecraft ; le « 5 » a ete verifie pixel a
// pixel sur le HUD en jeu (2026-09-23). La lecture choisit, pour chaque
// chiffre, le modele le plus proche, et rejette tout chiffre ambigu.

const GLYPHS = {
  0: ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  1: ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '#####'],
  2: ['.###.', '#...#', '....#', '..##.', '.#...', '#...#', '#####'],
  3: ['.###.', '#...#', '....#', '..##.', '....#', '#...#', '.###.'],
  4: ['...##', '..#.#', '.#..#', '#...#', '#####', '....#', '....#'],
  5: ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  6: ['..##.', '.#...', '#....', '####.', '#...#', '#...#', '.###.'],
  7: ['#####', '#...#', '....#', '...#.', '..#..', '..#..', '..#..'],
  8: ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  9: ['.###.', '#...#', '#...#', '.####', '....#', '...#.', '.##..'],
};
const TEMPLATES = Object.entries(GLYPHS).map(([d, rows]) => [d, rows.join('')]);
const MAX_DISTANCE = 3; // pixels de police differents tolerés sur 35

/** Vert du niveau d'XP (#7FFF00). Son ombre (#204000) est ignoree. */
const isLevelGreen = (img, x, y) => {
  const i = (y * img.w + x) * 4;
  return Math.abs(img.data[i + 2] - 0x7F) <= 12 && img.data[i + 1] >= 0xF0 && img.data[i] <= 12;
};

/** Zone a capturer, en coordonnees fenetre : centree, a hauteur de la barre de faim. */
export function levelRegion(win, hunger) {
  const c = hunger.cell;
  const w = 60 * c; // jusqu'a 9 chiffres ; Bedrock plafonne a 24791 (5 chiffres)
  return { x: Math.round(win.w / 2 - w / 2), y: hunger.y - c, w, h: 10 * c };
}

/**
 * Lit le niveau dans une capture de levelRegion. `cell` : taille d'un pixel de
 * police (identique a celle des icones du HUD). A appeler seulement quand le
 * HUD est visible : sans chiffre vert, le niveau est 0. Renvoie null si le
 * texte n'est pas lisible avec certitude.
 */
export function readLevelText(img, cell) {
  let minX = img.w, maxX = -1, minY = img.h, maxY = -1;
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      if (!isLevelGreen(img, x, y)) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return 0; // Minecraft n'affiche pas de niveau 0

  const cols = Math.round((maxX - minX + 1) / cell);
  const rows = Math.round((maxY - minY + 1) / cell);
  if (rows !== 7 || (cols + 1) % 6 !== 0) return null; // pas un nombre de la police attendue

  let digits = '';
  for (let d = 0; d < (cols + 1) / 6; d++) {
    let bits = '';
    for (let fy = 0; fy < 7; fy++) {
      for (let fx = 0; fx < 5; fx++) {
        const x = minX + (d * 6 + fx) * cell + (cell >> 1);
        const y = minY + fy * cell + (cell >> 1);
        bits += isLevelGreen(img, x, y) ? '#' : '.';
      }
    }
    const ranked = TEMPLATES
      .map(([digit, t]) => [digit, [...t].filter((ch, i) => ch !== bits[i]).length])
      .sort((a, b) => a[1] - b[1]);
    // Trop loin de tout modele, ou a egalite entre deux chiffres : on renonce.
    if (ranked[0][1] > MAX_DISTANCE || ranked[1][1] === ranked[0][1]) return null;
    digits += ranked[0][0];
  }
  return Number(digits);
}
