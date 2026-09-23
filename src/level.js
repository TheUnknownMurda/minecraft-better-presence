// Niveau d'XP du joueur. Aucune commande de lecture ne le donne, mais le
// selecteur @s[lm=N] ne correspond que si le niveau est >= N : une recherche
// dichotomique entre 0 et le maximum de Bedrock le retrouve en 15 requetes.

const MAX_LEVEL = 24791; // plafond des niveaux sur Bedrock

class Unavailable extends Error {}

/**
 * Renvoie le niveau, `previous` si la recherche est interrompue (deconnexion,
 * delai depasse), ou null si le selecteur lm ne fonctionne pas.
 * `command` : fonction (ligne de commande) -> Promise<body de reponse>.
 */
export async function findLevel(command, previous = null) {
  const atLeast = async (n) => {
    const res = await command(`testfor @s[lm=${n}]`);
    if (res.disconnected || res.timeout || res.refused) throw new Unavailable();
    return res.statusCode >= 0;
  };

  try {
    // Cas courant : le niveau n'a pas bouge depuis le dernier releve (2 requetes).
    if (previous !== null && (await atLeast(previous)) && !(await atLeast(previous + 1))) {
      return previous;
    }
    // Tout joueur est au moins niveau 0 : sinon, le selecteur n'est pas compris.
    if (!(await atLeast(0))) return null;

    let lo = 0; // invariant : le niveau est dans [lo, hi]
    let hi = MAX_LEVEL;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (await atLeast(mid)) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  } catch (e) {
    if (e instanceof Unavailable) return previous;
    throw e;
  }
}
