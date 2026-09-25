// Degats subis, lus sur les coeurs du HUD. Remplace le compte des monstres
// proches la ou le jeu le refuse (mondes sans cheats : pas d'expansion de
// selecteurs). Rien n'est calibre : les coeurs sont le miroir de la barre de
// faim par rapport au centre de l'ecran, au-dessus de la barre d'objets.
//
// On ne lit pas la vie exacte : on compte les pixels du rouge des coeurs,
// environ 33 pixels d'interface par coeur plein (825 px en 4K). Leur texture a
// deux rouges, #FF1313 et #BB1313 : autant de vert que de bleu, 7 a 10 % du
// rouge. On compte cette teinte plutot que ces couleurs exactes, que le fondu
// du HUD assombrit (#DE1111 observe) ; l'anneau orange d'un cadran RLCraft
// voisin (#E5853E) ou un texte rouge (#AA0000, #FF5555) en sont exclus.
//
// Une baisse confirmee sur deux releves de suite signale des degats ; une
// baisse d'un seul releve (clignotement, ecran qui se ferme) est ignoree.
// Poison, wither ou gel changent la couleur des coeurs et comptent donc aussi
// comme des degats, qu'ils infligent bel et bien.

const EXTRA_ROWS = 4; // rangees de coeurs au-dessus de la premiere (vie max augmentee)

/**
 * Zone des coeurs pour la fenetre `win` et la calibration de la faim
 * `hunger` ({ x, y, cell, period }), en coordonnees de la fenetre. Marge d'une
 * case de chaque cote, et en dessous pour le coeur qui sautille en regenerant.
 */
export function heartsRegion(win, hunger) {
  const { x, y, cell, period } = hunger;
  const right = x + 9 * period + 9 * cell; // bord droit de la barre de faim
  const x0 = win.w - right - 2 * cell;
  const x1 = win.w - x + 2 * cell;
  const y0 = y - EXTRA_ROWS * 10 * cell - 2 * cell;
  return { x: x0, y: y0, w: x1 - x0, h: y + 11 * cell - y0 };
}

/** Nombre de pixels a la teinte des coeurs dans une capture BGRA. */
export function heartPixels(img) {
  let n = 0;
  for (let i = 0; i < img.w * img.h; i++) {
    const b = img.data[i * 4];
    const g = img.data[i * 4 + 1];
    const r = img.data[i * 4 + 2];
    if (r >= 100 && Math.abs(g - b) <= 3 && g >= 0.05 * r && g <= 0.12 * r) n++;
  }
  return n;
}

/** Suit les releves successifs et repere une baisse de vie confirmee. */
export class DamageWatch {
  #confirmed = null; // derniere valeur retenue
  #pending = null; // releve qui s'en ecarte, en attente du suivant

  reset() {
    this.#confirmed = null;
    this.#pending = null;
  }

  /**
   * Nouveau releve (`pixels` : heartPixels ; `cell` : taille d'un pixel
   * d'interface). Vrai si la vie a baisse sur deux releves de suite. Ces deux
   * releves n'ont pas a etre egaux : en plein combat, la vie baisse a chacun.
   */
  update(pixels, cell) {
    const same = 6 * cell * cell; // variations sans signification
    const drop = 10 * cell * cell; // un peu moins d'un demi-coeur, la plus petite perte possible
    if (this.#confirmed === null) {
      // Premiers releves : une valeur vue deux fois de suite sert de reference.
      const seenTwice = this.#pending !== null && Math.abs(pixels - this.#pending) <= same;
      if (seenTwice) this.#confirmed = pixels;
      this.#pending = seenTwice ? null : pixels;
      return false;
    }
    if (Math.abs(pixels - this.#confirmed) <= same) {
      this.#confirmed = pixels;
      this.#pending = null; // l'ecart precedent n'a dure qu'un releve
      return false;
    }
    if (this.#pending === null) {
      this.#pending = pixels; // a confirmer au prochain releve
      return false;
    }
    const lower = this.#confirmed - drop;
    const hurt = this.#pending < lower && pixels < lower;
    this.#confirmed = pixels;
    this.#pending = null;
    return hurt;
  }
}
