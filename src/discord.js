// Envoi de la presence a Discord : dedoublonnage, limite de debit, reconnexion.
import { EventEmitter } from 'node:events';
import { Client } from '@xhayper/discord-rpc';

const MIN_INTERVAL_MS = 5_000;  // Discord tolere ~5 mises a jour / 20 s
const RETRY_MS = 15_000;

/** Emet 'ready', 'lost', 'sent' (activite ou null) et 'rejected' (message d'erreur de Discord). */
export class DiscordSink extends EventEmitter {
  #client = null;
  #ready = false;
  #desired = null;
  #sentKey;
  #lastSentAt = 0;
  #timer = null;
  #retry = null;
  #stopped = false;

  constructor(clientId) {
    super();
    this.clientId = clientId;
  }

  start() {
    this.#connect();
    return this;
  }

  #connect() {
    this.#retry = null;
    const client = new Client({ clientId: this.clientId });
    this.#client = client;
    client.on('ready', () => {
      this.#ready = true;
      this.#sentKey = undefined; // forcer un renvoi complet apres (re)connexion
      this.emit('ready', client.user?.username);
      this.#schedule();
    });
    client.on('disconnected', () => this.#lost());
    client.login().catch(() => this.#lost());
  }

  /** Efface la presence tout de suite (sans limite de debit) et ferme la connexion. */
  async stop() {
    this.#stopped = true;
    clearTimeout(this.#timer);
    clearTimeout(this.#retry);
    if (this.#ready) await this.#client.user?.clearActivity().catch(() => {});
    await this.#client?.destroy().catch(() => {});
  }

  #lost() {
    if (this.#retry || this.#stopped) return;
    if (this.#ready) this.emit('lost');
    this.#ready = false;
    this.#client?.destroy().catch(() => {});
    this.#retry = setTimeout(() => this.#connect(), RETRY_MS);
  }

  set(activity) {
    this.#desired = activity;
    this.#schedule();
  }

  clear() {
    this.set(null);
  }

  #schedule() {
    if (this.#timer) return;
    const wait = Math.max(0, this.#lastSentAt + MIN_INTERVAL_MS - Date.now());
    this.#timer = setTimeout(() => {
      this.#timer = null;
      this.#flush();
    }, wait);
  }

  async #flush() {
    if (!this.#ready) return;
    const key = JSON.stringify(this.#desired);
    if (key === this.#sentKey) return;
    this.#sentKey = key;
    this.#lastSentAt = Date.now();
    try {
      if (this.#desired) await this.#client.user?.setActivity(this.#desired);
      else await this.#client.user?.clearActivity();
      this.emit('sent', this.#desired);
    } catch (e) {
      this.#sentKey = undefined; // on retentera au prochain changement
      this.emit('rejected', e?.message ?? String(e));
    }
  }
}
