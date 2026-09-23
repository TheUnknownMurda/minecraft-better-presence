// Lecture de la faim sur le HUD. Aucune commande Bedrock ne la donne et RLCraft
// ne la stocke pas : on compte les cuisses de la barre de faim a l'ecran.
//
// Une cuisse fait 9x9 pixels de texture, agrandis d'un facteur `cell` selon la
// resolution et l'echelle d'interface. Les icones sont espacees de 8 pixels de
// texture : elles partagent une colonne, que l'on ignore. Grille relevee en jeu,
// identique pleine ou vide (# contour noir, o interieur) :
//
//   ....##...
//   ...#oo#..
//   ..#oooo#.
//   ..#ooooo.
//   ...#oooo.
//   ....#ooo.
//   .##..###.
//   ..#......
//   .#.......
//
// Interieur : viande (rouges et bruns) si pleine, #282828 si vide.

const OUTLINE = [
  [0, 4], [0, 5], [1, 3], [1, 6], [2, 2], [2, 7], [3, 2], [4, 3], [5, 4],
  [6, 1], [6, 2], [6, 5], [6, 6], [6, 7], [7, 2], [8, 1],
];
const INTERIOR = [
  [1, 4], [1, 5], [2, 3], [2, 4], [2, 5], [2, 6], [3, 3], [3, 4], [3, 5], [3, 6], [3, 7],
  [4, 4], [4, 5], [4, 6], [4, 7], [5, 5], [5, 6], [5, 7],
];

// Palette de la viande (icone pleine, sans effet de faim), relevee en jeu.
const MEAT = [0xD42A2A, 0xB21818, 0xDFB18F, 0xB88458, 0x9D6D43, 0x613C1B, 0x7B512D];
const EMPTY = 0x282828;
// Niveau d'XP, dont les chiffres recouvrent la premiere cuisse.
const TEXT = [0x7FFF00, 0x204000];

const near = (rgb, hex, tol) =>
  Math.abs(rgb[0] - (hex >> 16)) <= tol
  && Math.abs(rgb[1] - ((hex >> 8) & 0xFF)) <= tol
  && Math.abs(rgb[2] - (hex & 0xFF)) <= tol;

function pixel(img, x, y) {
  const i = (y * img.w + x) * 4;
  return [img.data[i + 2], img.data[i + 1], img.data[i]]; // BGRA -> RGB
}

/** 'black' | 'text' | 'empty' | 'meat' | 'unknown' */
function classify(rgb) {
  if (rgb[0] < 24 && rgb[1] < 24 && rgb[2] < 24) return 'black';
  if (TEXT.some((c) => near(rgb, c, 12))) return 'text';
  if (near(rgb, EMPTY, 10)) return 'empty';
  if (MEAT.some((c) => near(rgb, c, 14))) return 'meat';
  return 'unknown';
}

/** Echantillonne le centre de la case (r, c) d'une icone d'origine (x, y). */
function cellAt(img, x, y, cell, [r, c]) {
  const px = x + c * cell + (cell >> 1);
  const py = y + r * cell + (cell >> 1);
  if (px < 0 || py < 0 || px >= img.w || py >= img.h) return 'unknown';
  return classify(pixel(img, px, py));
}

/** Part du contour trouvee en noir (le texte ne compte ni pour ni contre). */
function outlineScore(img, x, y, cell) {
  let black = 0;
  let seen = 0;
  for (const rc of OUTLINE) {
    const k = cellAt(img, x, y, cell, rc);
    if (k === 'text') continue;
    seen++;
    if (k === 'black') black++;
  }
  return seen >= 10 ? black / seen : 0;
}

/**
 * Analyse la barre de faim dans une capture. `geo` : origine de la premiere
 * cuisse dans la capture (x, y), taille d'un pixel de texture (cell) et pas
 * entre icones (period). Renvoie les points (0 a 20) et les indices de
 * fiabilite ; `valid` est faux si le HUD n'est pas lisible.
 */
export function analyzeHunger(img, geo) {
  let points = 0;
  let scoreSum = 0;
  let known = 0;
  // Interieur noir ou de couleur inattendue. Dans une vraie cuisse, l'interieur
  // n'est jamais noir : c'est de la viande ou du #282828. Un ecran assombri
  // (menu pause, inventaire) donne au contraire un interieur noir.
  let suspicious = 0;
  let blackInside = 0; // detail de `suspicious`, pour le diagnostic

  for (let i = 0; i < 10; i++) {
    const x = geo.x + i * geo.period;
    // Quand la saturation est nulle, les cuisses tremblent d'un pixel de texture.
    let best = { dy: 0, score: -1 };
    for (const dy of [0, -geo.cell, geo.cell]) {
      const score = outlineScore(img, x, geo.y + dy, geo.cell);
      if (score > best.score) best = { dy, score };
      if (score === 1) break;
    }
    scoreSum += best.score;

    let meat = 0;
    let empty = 0;
    for (const rc of INTERIOR) {
      const k = cellAt(img, x, geo.y + best.dy, geo.cell, rc);
      if (k === 'meat') meat++;
      else if (k === 'empty') empty++;
      else if (k !== 'text') {
        suspicious++;
        if (k === 'black') blackInside++;
      }
    }
    known += meat + empty;
    const filled = meat + empty ? meat / (meat + empty) : 0;
    points += filled >= 0.75 ? 2 : filled >= 0.25 ? 1 : 0;
  }

  const outline = scoreSum / 10;
  const suspiciousRatio = suspicious / Math.max(1, known + suspicious);
  return {
    points,
    outline,
    suspiciousRatio,
    known,
    suspicious,
    blackInside,
    valid: outline >= 0.8 && suspiciousRatio <= 0.2 && known >= 100,
  };
}

/** Faim (0 a 20), ou null si la lecture est douteuse : l'appelant garde alors la derniere valeur. */
export function readHunger(img, geo) {
  const a = analyzeHunger(img, geo);
  return a.valid ? a.points : null;
}

/**
 * Cherche la barre de faim dans une capture (calibration) : une rangee d'au
 * moins 9 cuisses alignees, a une echelle de 2 a 10. La premiere cuisse peut
 * etre masquee par le niveau d'XP. Renvoie { x, y, cell, period } ou null.
 */
export function findHungerBar(img) {
  let best = null;
  for (let cell = 2; cell <= 10; cell++) {
    const period = 8 * cell;
    const span = 9 * cell;
    for (let y = 0; y + span <= img.h; y++) {
      for (let x = 0; x + span <= img.w; x++) {
        // Filtre rapide : les deux pixels noirs du haut de la cuisse.
        if (cellAt(img, x, y, cell, [0, 4]) !== 'black' || cellAt(img, x, y, cell, [0, 5]) !== 'black') continue;
        if (outlineScore(img, x, y, cell) < 0.9) continue;
        let n = 1;
        while (x + n * period + span <= img.w && outlineScore(img, x + n * period, y, cell) >= 0.9) n++;
        if (n >= 9 && n <= 10 && (!best || n > best.n)) {
          // Premier point de correspondance = coin exact moins une demi-case.
          const last = x + (n - 1) * period + (cell >> 1);
          best = { n, x: last - 9 * period, y: y + (cell >> 1), cell, period };
        }
      }
    }
    if (best) break; // la plus petite echelle qui correspond est la bonne
  }
  return best && { x: best.x, y: best.y, cell: best.cell, period: best.period };
}
