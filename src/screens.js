// Reconnaissance des ecrans de jeu (menu pause, inventaire, coffres, poche a
// trinkets, menu LVL UP) a l'ecran. Le jeu ne les signale pas (ScreenChanged ne
// remonte plus) et, en multijoueur, rien ne se fige : on reconnait les ecrans
// eux-memes.
//
// Calibration : une capture en jeu, puis deux captures de chaque ecran, a deux
// secondes d'intervalle. Un pixel entre dans la signature d'un ecran s'il est :
//  - stable entre ses deux captures (le monde qui bouge derriere est ecarte) ;
//  - absent en jeu, et absent de tous les AUTRES ecrans calibres : l'inventaire
//    et le coffre partagent la grille d'inventaire et le gris des panneaux, qui
//    ne doivent donc compter pour aucun des deux ;
//  - a l'interieur d'un panneau ou d'un bouton de l'interface (voir uiMask) :
//    le monde autour du menu, souvent uni comme le ciel, ne peut pas en faire
//    partie, meme s'il est reste identique entre les captures ;
//  - sur la structure de l'interface (voir structureMask) : fond, bordures des
//    cases, textes. Jamais a l'interieur d'une case, ou l'inventaire du joueur,
//    le meme aux deux ouvertures, changera ensuite ;
//  - gris d'interface (faible saturation) : textes, bordures, cases vides. Les
//    icones d'objets, colorees et changeantes d'un coffre a l'autre, sont ecartees.
// On retient ensuite les zones les plus riches en details (contours du texte,
// bordures) : un aplat gris, commun a trop d'ecrans, ne suffit jamais.

const CELL_W = 256; // taille des zones candidates, en pixels ecran
const CELL_H = 64;
const MAX_PATCHES = 3;
const MIN_CANDIDATES = 0.03; // part minimale de pixels de signature dans une zone (elements discriminants clairsemes)
const MIN_DETAILS = 20; // pixels de contour minimum pour retenir une zone
const SAMPLES_PER_KIND = 40; // points de contour et points de fond par zone
const STABLE = 6; // ecart max entre les deux captures d'un meme ecran
const DISTINCT = 45; // ecart min avec le jeu et les autres ecrans (plus du double de la tolerance de patchScore)
const GREY = 24; // saturation max d'un gris d'interface

const rgbAt = (img, x, y) => {
  const i = (y * img.w + x) * 4;
  return [img.data[i + 2], img.data[i + 1], img.data[i]]; // BGRA -> RGB
};
const luma = ([r, g, b]) => 0.299 * r + 0.587 * g + 0.114 * b;
const maxDiff = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
const isGrey = ([r, g, b]) => Math.max(r, g, b) - Math.min(r, g, b) <= GREY;
const hex = ([r, g, b]) => ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');

// Gris exact des panneaux et boutons de l'interface Bedrock. Le monde n'en
// produit pratiquement jamais de grandes surfaces : il delimite l'interface.
const PANEL = [0xC6, 0xC6, 0xC6];
const BLOCK = 8; // pixels par bloc pour reperer les panneaux
const MIN_PANEL_BLOCKS = 40; // taille minimale d'un panneau ou bouton, en blocs

/**
 * Masque des zones d'interface : boites englobantes des grandes surfaces
 * #C6C6C6 (panneaux, boutons), contenu compris (textes, cases, personnage).
 * Le ciel, le monde et le monde assombri autour du menu en sont exclus.
 */
export function uiMask(img) {
  const bw = Math.floor(img.w / BLOCK);
  const bh = Math.floor(img.h / BLOCK);
  const panel = new Uint8Array(bw * bh);
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      let n = 0;
      for (let y = by * BLOCK; y < (by + 1) * BLOCK; y += 2) {
        for (let x = bx * BLOCK; x < (bx + 1) * BLOCK; x += 2) {
          if (maxDiff(rgbAt(img, x, y), PANEL) <= 3) n++;
        }
      }
      if (n >= 8) panel[by * bw + bx] = 1; // au moins la moitie du bloc
    }
  }

  const mask = new Uint8Array(img.w * img.h);
  const seen = new Uint8Array(bw * bh);
  for (let start = 0; start < bw * bh; start++) {
    if (!panel[start] || seen[start]) continue;
    // Composante connexe (4-voisinage) et sa boite englobante.
    let minX = bw, minY = bh, maxX = -1, maxY = -1, count = 0;
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const j = stack.pop();
      const x = j % bw;
      const y = (j - x) / bw;
      count++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
        if (nx < 0 || ny < 0 || nx >= bw || ny >= bh) continue;
        const k = ny * bw + nx;
        if (panel[k] && !seen[k]) { seen[k] = 1; stack.push(k); }
      }
    }
    if (count < MIN_PANEL_BLOCKS) continue;
    for (let y = minY * BLOCK; y < (maxY + 1) * BLOCK; y++) {
      mask.fill(1, y * img.w + minX * BLOCK, y * img.w + (maxX + 1) * BLOCK);
    }
  }
  return mask;
}

const NEAR = 4; // px : bordures des cases (1 pixel d'interface, 5 px en 4K) et textes

/**
 * Masque de la structure de l'interface : pixels a NEAR px au plus du gris des
 * panneaux, soit le fond, les bordures des cases et les textes poses dessus.
 * Les objets, dessines a l'interieur des cases, n'y sont jamais : le contenu de
 * l'inventaire du joueur, identique d'une ouverture a l'autre, ne peut donc pas
 * entrer dans une signature.
 */
export function structureMask(img) {
  const { w, h } = img;
  const panel = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const p = [img.data[i * 4 + 2], img.data[i * 4 + 1], img.data[i * 4]];
    if (maxDiff(p, PANEL) <= 3) panel[i] = 1;
  }
  return dilate(panel, w, h, NEAR);
}

/** Dilatation carree de r px d'un masque : fenetre glissante horizontale, puis verticale. */
function dilate(src, w, h, r) {
  const rows = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    let count = 0;
    for (let x = -r; x < w; x++) {
      if (x + r < w) count += src[y * w + x + r];
      if (x - r - 1 >= 0) count -= src[y * w + x - r - 1];
      if (x >= 0 && count) rows[y * w + x] = 1;
    }
  }
  const mask = new Uint8Array(w * h);
  for (let x = 0; x < w; x++) {
    let count = 0;
    for (let y = -r; y < h; y++) {
      if (y + r < h) count += rows[(y + r) * w + x];
      if (y - r - 1 >= 0) count -= rows[(y - r - 1) * w + x];
      if (y >= 0 && count) mask[y * w + x] = 1;
    }
  }
  return mask;
}

/**
 * Ressemblance de deux captures sur leurs panneaux d'interface, de 0 a 1 : part
 * des pixels gris dans les deux qui sont identiques. Les objets colores et le
 * bouton survole (vert) ne comptent pas. L'inventaire et un coffre, aux
 * panneaux de meme taille au meme endroit, se distinguent par leurs cases
 * (0,7 environ ; 1 pour deux ouvertures du meme ecran).
 */
export function similarity(a, b) {
  const ma = uiMask(a);
  const mb = uiMask(b);
  let counted = 0;
  let same = 0;
  for (let i = 0; i < ma.length; i += 4) { // un pixel sur quatre suffit
    if (!ma[i] && !mb[i]) continue;
    const p = [a.data[i * 4 + 2], a.data[i * 4 + 1], a.data[i * 4]];
    const q = [b.data[i * 4 + 2], b.data[i * 4 + 1], b.data[i * 4]];
    if (!isGrey(p) || !isGrey(q)) continue;
    counted++;
    if (maxDiff(p, q) <= 20) same++;
  }
  return counted ? same / counted : 0;
}

/** Masque des pixels identiques entre deux captures d'un meme ecran. */
export function stableMask(a, b) {
  const mask = new Uint8Array(a.w * a.h);
  for (let y = 0; y < a.h; y++) {
    for (let x = 0; x < a.w; x++) {
      if (maxDiff(rgbAt(a, x, y), rgbAt(b, x, y)) <= STABLE) mask[y * a.w + x] = 1;
    }
  }
  return mask;
}

const EDGE = 16; // px moyennes au bord de chaque ligne pour la couleur du fond
const BACKDROP = 16; // ecart max avec cette couleur

/**
 * Fond d'un menu superpose au jeu (menu LVL UP) : pixels proches de la couleur
 * des bords gauche et droit de leur ligne, soit le ciel autour du menu. Ce fond
 * change avec l'heure : il ne doit pas entrer dans la signature.
 */
export function backdropMask(img) {
  const { w, h } = img;
  const mask = new Uint8Array(w * h);
  const edge = (y, x0) => {
    const c = [0, 0, 0];
    for (let x = x0; x < x0 + EDGE; x++) {
      const p = rgbAt(img, x, y);
      for (let k = 0; k < 3; k++) c[k] += p[k] / EDGE;
    }
    return c;
  };
  for (let y = 0; y < h; y++) {
    const left = edge(y, 0);
    const right = edge(y, w - EDGE);
    for (let x = 0; x < w; x++) {
      const p = rgbAt(img, x, y);
      if (maxDiff(p, left) <= BACKDROP || maxDiff(p, right) <= BACKDROP) mask[y * w + x] = 1;
    }
  }
  return mask;
}

/**
 * Signature d'un ecran. `target` : { img, stable } ; `others` : captures des
 * autres ecrans calibres ; `inGame` : capture sans menu (ou l'ecran titre,
 * pour les ecrans du menu principal). Toutes plein ecran et de meme taille.
 * Renvoie { patches: [{ x, y, w, h, samples }] } ou null.
 *
 * `overlay` : menu dessine par-dessus le jeu, HUD visible (menu LVL UP). Il
 * n'a ni panneau gris ni structure d'interface : on ecarte plutot le fond
 * (backdropMask) et tout ce qui sort de `region` { x0, y0, x1, y1 } (HUD,
 * coordonnees). On ne garde que les contours poses directement sur le fond,
 * comme un texte d'aide : le contenu des cadres du menu (niveaux, selection,
 * capacites debloquees) change en jouant, et un aplat pourrait etre du ciel.
 *
 * `menu` : ecran du menu principal (Jouer, Parametres, Marche...). Pas de
 * panneau gris non plus, et un decor anime derriere. Leur identite est dans
 * leur en-tete (titre, onglet selectionne), que `region` delimite : le contenu
 * (mondes, dates, serveurs ou offres en vedette) change d'un jour a l'autre.
 */
export function buildSignature(target, others, inGame, { overlay = false, menu = false, region = null } = {}) {
  const { img } = target;
  const panels = !overlay && !menu; // ecran de jeu classique, delimite par ses panneaux gris
  const ui = panels ? uiMask(img) : null;
  const structure = panels ? structureMask(img) : null;
  const backdrop = overlay ? backdropMask(img) : null;
  const nearBackdrop = overlay ? dilate(backdrop, img.w, img.h, NEAR) : null;
  const outside = (x, y) => region && (x < region.x0 || x >= region.x1 || y < region.y0 || y >= region.y1);
  // Menu principal : zones deux fois plus petites. Ce qui distingue ses ecrans
  // (libelle souligne d'un onglet, titre) est etroit ; plusieurs petites zones
  // valent mieux qu'une grande.
  const cellW = menu ? CELL_W / 2 : CELL_W;
  const cellH = menu ? CELL_H / 2 : CELL_H;
  const minDetails = menu ? MIN_DETAILS / 2 : MIN_DETAILS;
  const minCandidates = menu ? MIN_CANDIDATES / 2 : MIN_CANDIDATES;
  const cols = Math.floor(img.w / cellW);
  const rows = Math.floor(img.h / cellH);
  const cells = [];

  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const candidates = [];
      for (let dy = 0; dy < cellH; dy++) {
        for (let dx = 0; dx < cellW; dx++) {
          const x = cx * cellW + dx;
          const y = cy * cellH + dy;
          const i = y * img.w + x;
          if (!target.stable[i]) continue;
          if (panels ? !ui[i] || !structure[i] : outside(x, y) || (overlay && backdrop[i])) continue;
          const p = rgbAt(img, x, y);
          if (!isGrey(p)) continue;
          if (maxDiff(p, rgbAt(inGame, x, y)) < DISTINCT) continue;
          if (others.some((o) => maxDiff(p, rgbAt(o, x, y)) < DISTINCT)) continue;
          candidates.push([dx, dy, p]);
        }
      }
      if (candidates.length < minCandidates * cellW * cellH) continue;

      // Contours : pixel de signature dont un voisin horizontal, stable lui aussi,
      // differe nettement. Ce voisin n'a pas a etre dans la signature : une
      // lettre propre a l'inventaire est bordee du gris de panneau, commun au
      // coffre, qui en est exclu.
      const details = [];
      const plain = [];
      // Menu principal : voisins verticaux aussi, pour le trait horizontal qui
      // souligne l'onglet selectionne.
      const neighbours = menu ? [[-1, 0], [1, 0], [0, -1], [0, 1]] : [[-1, 0], [1, 0]];
      for (const c of candidates) {
        const [dx, dy, p] = c;
        const edge = neighbours.some(([sx, sy]) => {
          const nx = cx * cellW + dx + sx;
          const ny = cy * cellH + dy + sy;
          if (nx < 0 || nx >= img.w || ny < 0 || ny >= img.h || !target.stable[ny * img.w + nx]) return false;
          return Math.abs(luma(p) - luma(rgbAt(img, nx, ny))) >= 40;
        });
        const onBackdrop = !overlay || nearBackdrop[(cy * cellH + dy) * img.w + cx * cellW + dx];
        (edge && onBackdrop ? details : plain).push(c);
      }
      if (details.length < minDetails) continue;
      cells.push({ cx, cy, details, plain });
    }
  }
  if (!cells.length) return null;

  // Le plus de details d'abord ; deux zones cote a cote designeraient le meme
  // element (une infobulle les masquerait ensemble). En diagonale, c'est permis :
  // l'inventaire et le coffre n'ont que quelques zones propres, groupees. Au
  // menu principal, ou les zones sont petites et le libelle d'un onglet etroit,
  // cote a cote aussi.
  cells.sort((a, b) => b.details.length - a.details.length);
  const chosen = [];
  for (const c of cells) {
    if (!menu && chosen.some((o) => Math.abs(o.cx - c.cx) + Math.abs(o.cy - c.cy) <= 1)) continue;
    chosen.push(c);
    if (chosen.length === MAX_PATCHES) break;
  }

  const spread = (points, n) => {
    const step = Math.max(1, Math.floor(points.length / n));
    return points.filter((_, i) => i % step === 0).slice(0, n);
  };
  return {
    ...(overlay && { overlay: true }),
    ...(menu && { menu: true }),
    patches: chosen.map((c) => {
      const details = spread(c.details, overlay ? 2 * SAMPLES_PER_KIND : SAMPLES_PER_KIND);
      const plain = overlay ? [] : spread(c.plain, 2 * SAMPLES_PER_KIND - details.length);
      return {
        x: c.cx * cellW, y: c.cy * cellH, w: cellW, h: cellH,
        details: details.length,
        samples: [...details, ...plain].map(([dx, dy, p]) => [dx, dy, hex(p)]),
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
 * Ecran reconnu si au moins 2 zones sur 3 (ou toutes s'il y en a moins)
 * correspondent a 90 %. Un bouton survole par la souris change de couleur :
 * une zone peut donc manquer sans fausser le resultat.
 */
export function matches(scores) {
  const needed = Math.min(2, scores.length);
  return scores.filter((s) => s >= 0.9).length >= needed;
}

/**
 * Nom de l'ecran reconnu parmi `signatures` ({ nom: signature }), ou null.
 * `grab(patch)` capture une zone. En cas de doublon, le meilleur score gagne.
 */
export async function recognize(signatures, grab) {
  let best = null;
  for (const [name, sig] of Object.entries(signatures)) {
    const scores = [];
    for (const p of sig.patches) scores.push(patchScore(await grab(p), p));
    if (!matches(scores)) continue;
    const total = scores.reduce((a, b) => a + b, 0) / scores.length;
    if (!best || total > best.total) best = { name, total };
  }
  return best?.name ?? null;
}
