// Banc d'essai du cote Discord, independant de Minecraft.
// Fait defiler des etats factices pour valider l'App ID, les assets uploades
// et le rendu reel de la presence avant de brancher quoi que ce soit au jeu.
import { Client } from '@xhayper/discord-rpc';

const clientId = process.env.DISCORD_APP_ID;

if (!clientId) {
  console.error('\n  Il manque l\'App ID Discord.\n');
  console.error('  1. https://discord.com/developers/applications -> New Application');
  console.error('     Le NOM de l\'application est ce qui s\'affiche apres "Joue a".');
  console.error('  2. Rich Presence > Art Assets : uploade tes images.');
  console.error('  3. Relance avec :  $env:DISCORD_APP_ID="123..."; npm run rpc\n');
  process.exit(1);
}

// Ce que la route WebSocket + pack compagnon permettrait d'afficher.
// Les cles d'image doivent correspondre aux assets uploades dans le portail.
const startTimestamp = new Date(Date.now() - 2 * 3600 * 1000);
const MOCK_STATES = [
  {
    details: 'Mine dans le Nether -- Y=12',
    state: 'RLCraft 1.3 | Survie | 1247 blocs mines',
    largeImageKey: 'nether',
    largeImageText: 'Nether Wastes',
    smallImageKey: 'pickaxe',
    smallImageText: 'Pioche en diamant',
  },
  {
    details: 'Combat un Dragon de feu',
    state: 'RLCraft 1.3 | 7/20 PV | Niveau 24',
    largeImageKey: 'overworld',
    largeImageText: 'Cherry Grove',
    smallImageKey: 'sword',
    smallImageText: 'Epee en fer',
  },
  {
    details: 'Explore en elytres',
    state: 'RLCraft 1.3 | 3240 blocs parcourus',
    largeImageKey: 'overworld',
    largeImageText: 'Plaines -- nuit',
    smallImageKey: 'elytra',
    smallImageText: 'Elytres',
  },
  {
    details: 'Dans les menus',
    state: 'RLCraft 1.3 | Inventaire',
    largeImageKey: 'overworld',
    largeImageText: 'En pause',
  },
];

const client = new Client({ clientId });
let i = 0;

function push() {
  const s = MOCK_STATES[i % MOCK_STATES.length];
  i++;
  client.user
    ?.setActivity({ ...s, startTimestamp })
    .then(() => {
      console.log(`\x1b[32m  ->\x1b[0m ${s.details}`);
      console.log(`     \x1b[90m${s.state}\x1b[0m`);
    })
    .catch((e) => console.error('  Echec setActivity :', e.message));
}

client.on('ready', () => {
  console.log(`\n\x1b[32m  [OK] Connecte a Discord\x1b[0m en tant que ${client.user?.username}`);
  console.log('  Regarde ton profil Discord. Etat suivant toutes les 12 s.');
  console.log('  \x1b[90m(Ctrl+C pour arreter et effacer la presence)\x1b[0m\n');
  push();
  // Discord limite a ~5 updates / 20 s : 12 s laisse une marge confortable.
  setInterval(push, 12_000);
});

client.login().catch((e) => {
  console.error('\n  Connexion a Discord impossible :', e.message);
  console.error('  Verifie que le client Discord desktop tourne (le web ne suffit pas).\n');
  process.exit(1);
});

process.on('SIGINT', async () => {
  await client.user?.clearActivity().catch(() => {});
  await client.destroy().catch(() => {});
  console.log('\n  Presence effacee.\n');
  process.exit(0);
});
