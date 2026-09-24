// Pont WebSocket avec le client Minecraft Bedrock (commande /connect).
import { EventEmitter } from 'node:events';
import {
  createCipheriv, createDecipheriv, createHash, createPublicKey,
  diffieHellman, generateKeyPairSync, randomBytes, randomUUID,
} from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { WebSocketServer } from 'ws';

// Events confirmes fonctionnels en 1.26 (voir FINDINGS.md).
export const SUBSCRIBED_EVENTS = [
  'PlayerTransform', 'PlayerTravelled', 'PlayerTeleported', 'PlayerDied',
  'BlockBroken', 'BlockPlaced', 'MobKilled',
  'ItemAcquired', 'ItemCrafted', 'ItemSmelted', 'ItemUsed', 'ItemInteracted', 'ItemEquipped',
];

// Le client execute les commandes WebSocket meme dans un monde sans cheats
// (voir FINDINGS.md). On ne laisse donc passer que des lectures d'etat :
// jamais rien qui modifie le monde, l'inventaire ou le mode de jeu.
const READ_ONLY = /^(querytarget @s|time query (daytime|day|gametime)|weather query|testfor @[aesp](\[[^\]]*\])?|list|scoreboard (players list @s|objectives list)|tag @s list)$/;

// Sous-protocole negocie par le client quand le chiffrement est actif.
const ENCRYPT_SUBPROTOCOL = 'com.microsoft.minecraft.wsencrypt';

const normalize = (ip) => String(ip ?? '').replace(/^::ffff:/, '');

/**
 * Le serveur ecoute sur toutes les interfaces (le /connect passe par l'IP LAN
 * pour eviter la restriction loopback d'UWP), mais n'accepte que ce PC :
 * un autre appareil du reseau ne doit pas pouvoir piloter le statut Discord.
 */
function isThisMachine(ip) {
  const addr = normalize(ip);
  if (addr === '127.0.0.1' || addr === '::1') return true;
  return Object.values(networkInterfaces()).flat().some((ni) => normalize(ni?.address) === addr);
}

/** Base64 sans padding, comme l'attend la commande enableencryption. */
const rawBase64 = (buf) => buf.toString('base64').replace(/=+$/, '');

/**
 * Emet 'connected' (adresse, chiffre ?), 'disconnected', 'event' (nom, body)
 * et 'warning' (message). La connexion est liee au client et survit aux
 * changements de monde.
 *
 * Chiffrement (protocole de Code Connection, cf. Sandertv/mcwss) : ECDH P-384,
 * cle AES-256 = SHA-256(sel || secret partage), AES-CFB8 avec IV = 16 premiers
 * octets de la cle, un flux continu par sens. La reponse a enableencryption
 * arrive en clair ; tout le reste est chiffre, dans des trames texte.
 */
export class MinecraftBridge extends EventEmitter {
  #socket = null;
  #pending = new Map();
  #cipher = null; // { enc, dec } une fois la poignee de main terminee

  constructor({ port, encryption = true }) {
    super();
    this.port = port;
    this.encryption = encryption;
  }

  start() {
    this.wss = new WebSocketServer({
      host: '0.0.0.0',
      port: this.port,
      // Les trames texte chiffrees ne sont pas de l'UTF-8 valide.
      skipUTF8Validation: true,
      handleProtocols: (protocols) => (protocols.has(ENCRYPT_SUBPROTOCOL) ? ENCRYPT_SUBPROTOCOL : false),
      verifyClient: ({ req }) => {
        const ok = isThisMachine(req.socket.remoteAddress);
        if (!ok) this.emit('warning', `connexion refusee depuis ${normalize(req.socket.remoteAddress)} (pas ce PC)`);
        return ok;
      },
    });
    this.wss.on('connection', (ws, req) => this.#attach(ws, normalize(req.socket.remoteAddress)));
    return this;
  }

  get connected() {
    return this.#socket?.readyState === 1;
  }

  #attach(ws, from) {
    // Un seul client a la fois : une nouvelle connexion remplace l'ancienne.
    if (this.#socket && this.#socket !== ws) this.#socket.close();
    this.#socket = ws;
    this.#cipher = null;

    ws.on('message', (raw) => {
      if (ws !== this.#socket) return;
      const text = this.#cipher ? this.#cipher.dec.update(raw).toString('utf8') : raw.toString('utf8');
      let msg;
      try { msg = JSON.parse(text); } catch {
        if (this.#cipher) this.emit('warning', 'message indechiffrable : retape /connect');
        return;
      }
      const { messagePurpose, requestId, eventName } = msg.header ?? {};
      if (messagePurpose === 'event') {
        this.emit('event', eventName ?? msg.body?.eventName, msg.body ?? {});
      } else if (messagePurpose === 'commandResponse' || messagePurpose === 'error') {
        const p = this.#pending.get(requestId);
        if (!p) return;
        this.#pending.delete(requestId);
        clearTimeout(p.timer);
        p.resolve(msg.body ?? {});
      }
    });

    ws.on('close', () => {
      if (this.#socket !== ws) return;
      this.#socket = null;
      this.#cipher = null;
      for (const p of this.#pending.values()) {
        clearTimeout(p.timer);
        p.resolve({ statusCode: -1, disconnected: true });
      }
      this.#pending.clear();
      this.emit('disconnected');
    });
    ws.on('error', () => {});

    if (this.encryption) this.#handshake(from);
    else this.#ready(from);
  }

  /**
   * Abonnements, puis annonce de la connexion : les commandes peuvent partir.
   * `refusal` : message du jeu si le chiffrement a ete refuse.
   */
  #ready(from, refusal = null) {
    for (const eventName of SUBSCRIBED_EVENTS) this.#send('subscribe', { eventName });
    this.emit('connected', from, Boolean(this.#cipher), refusal);
  }

  #handshake(from) {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'secp384r1' });
    const salt = randomBytes(16);
    const spki = publicKey.export({ type: 'spki', format: 'der' });
    const commandLine = `enableencryption "${rawBase64(spki)}" "${rawBase64(salt)}"`;

    // Pas de await : le dechiffrement doit etre actif avant que le message
    // suivant soit traite, or le client peut enchainer des events chiffres
    // (abonnements conserves d'une session precedente) dans la meme trame TCP.
    const id = this.#send('commandRequest', { origin: { type: 'player' }, commandLine, version: 1 });
    const timer = setTimeout(() => {
      this.#pending.delete(id);
      this.#finishHandshake({ statusCode: -1, timeout: true }, privateKey, salt, from);
    }, 5000);
    this.#pending.set(id, { timer, resolve: (res) => this.#finishHandshake(res, privateKey, salt, from) });
  }

  #finishHandshake(res, privateKey, salt, from) {
    if (!this.connected) return;
    if (!res.publicKey) {
      // Client trop ancien ou refus : on continue en clair. Si le jeu exige le
      // chiffrement, c'est lui qui fermera la connexion.
      const why = res.timeout ? 'pas de reponse' : (res.statusMessage ?? res.statusCode);
      this.emit('warning', `chiffrement refuse par le client (${why}), connexion en clair`);
      this.#ready(from, String(why));
      return;
    }

    const clientKey = createPublicKey({ key: Buffer.from(res.publicKey, 'base64'), format: 'der', type: 'spki' });
    const secret = diffieHellman({ privateKey, publicKey: clientKey });
    if (secret[0] === 0) {
      // mcwss retire les zeros de tete du secret, Node les garde : les deux
      // conventions ne different que dans ce cas (1 sur 256).
      this.emit('warning', 'secret partage atypique : si rien ne s\'affiche, retape /connect');
    }
    const key = createHash('sha256').update(Buffer.concat([salt, secret])).digest();
    const iv = key.subarray(0, 16);
    this.#cipher = {
      enc: createCipheriv('aes-256-cfb8', key, iv),
      dec: createDecipheriv('aes-256-cfb8', key, iv),
    };
    this.#ready(from);
  }

  #send(messagePurpose, body) {
    const requestId = randomUUID();
    const data = JSON.stringify({
      header: { version: 1, requestId, messageType: 'commandRequest', messagePurpose },
      body,
    });
    if (this.#cipher) this.#socket.send(this.#cipher.enc.update(data, 'utf8'), { binary: false });
    else this.#socket.send(data);
    return requestId;
  }

  /** Envoi brut d'une commande, sans filtrage. Resout toujours. */
  #request(commandLine, timeoutMs = 5000) {
    if (!this.connected) return Promise.resolve({ statusCode: -1, disconnected: true });
    return new Promise((resolve) => {
      const id = this.#send('commandRequest', { origin: { type: 'player' }, commandLine, version: 1 });
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        resolve({ statusCode: -1, timeout: true });
      }, timeoutMs);
      this.#pending.set(id, { resolve, timer });
    });
  }

  /** Execute une commande de lecture. Resout toujours : statusCode < 0 en cas d'echec. */
  command(commandLine, timeoutMs = 5000) {
    if (!READ_ONLY.test(commandLine)) {
      return Promise.resolve({ statusCode: -1, refused: `commande hors liste blanche : ${commandLine}` });
    }
    return this.#request(commandLine, timeoutMs);
  }
}
