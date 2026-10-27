'use strict';

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_KEEPALIVE_MS = 60 * 1000;

function normalizeBaseUrl(value) {
  let url;
  try { url = new URL(String(value || '')); } catch {
    throw new Error('BROWSERLESS_BASE_URL must be the HTTPS endpoint shown in the Browserless dashboard');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('BROWSERLESS_BASE_URL must be a clean HTTPS base URL without credentials, query, or fragment');
  }
  return url.toString().replace(/\/$/, '');
}

class BrowserlessSessionManager {
  constructor({ secretStore, env = process.env, fetchImpl = globalThis.fetch, now = Date.now } = {}) {
    this.secretStore = secretStore;
    this.env = env;
    this.fetch = fetchImpl;
    this.now = now;
  }

  _config() {
    const token = String(this.env.BROWSERLESS_TOKEN || '').trim();
    if (!token) throw new Error('Browserless is not configured: set BROWSERLESS_TOKEN on the server');
    if (typeof this.fetch !== 'function') throw new Error('This Node.js runtime does not provide fetch');
    const baseUrl = normalizeBaseUrl(this.env.BROWSERLESS_BASE_URL);
    const ttlMs = Number(this.env.BROWSERLESS_SESSION_TTL_MS || DEFAULT_TTL_MS);
    const keepAliveMs = Number(this.env.BROWSERLESS_PROCESS_KEEPALIVE_MS || DEFAULT_KEEPALIVE_MS);
    if (!Number.isSafeInteger(ttlMs) || ttlMs < 60000) throw new Error('BROWSERLESS_SESSION_TTL_MS must be an integer of at least 60000');
    if (!Number.isSafeInteger(keepAliveMs) || keepAliveMs < 0 || keepAliveMs > ttlMs) {
      throw new Error('BROWSERLESS_PROCESS_KEEPALIVE_MS must be between 0 and the session TTL');
    }
    return { token, baseUrl, ttlMs, keepAliveMs };
  }

  _key(id) {
    return 'browserless-session-' + String(id);
  }

  async getOrCreate(id) {
    const config = this._config();
    const key = this._key(id);
    let saved = null;
    try {
      saved = JSON.parse(this.secretStore?.get(key) || 'null');
    } catch {}

    if (saved && typeof saved.connect === 'string' && typeof saved.stop === 'string' &&
        Number(saved.expiresAt) > this.now() + 60000) {
      return { ...saved, reused: true };
    }
    if (saved && typeof saved.stop === 'string') {
      try {
        const separator = saved.stop.includes('?') ? '&' : '?';
        await this.fetch(saved.stop + separator + 'force=true', {
          method: 'DELETE',
          signal: AbortSignal.timeout(10000)
        });
      } catch {}
      this.secretStore?.remove(key);
    }

    const endpoint = new URL('/session', config.baseUrl);
    endpoint.searchParams.set('token', config.token);
    const response = await this.fetch(endpoint.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({
        ttl: config.ttlMs,
        processKeepAlive: config.keepAliveMs,
        headless: true,
        browser: 'chromium'
      }),
      signal: AbortSignal.timeout(20000)
    });
    if (!response.ok) throw new Error('Browserless session creation failed (HTTP ' + response.status + ')');

    let remote;
    try { remote = await response.json(); } catch {
      throw new Error('Browserless returned an invalid session response');
    }
    if (!remote || typeof remote.connect !== 'string' || typeof remote.stop !== 'string') {
      throw new Error('Browserless session response did not include connect and stop URLs');
    }
    let connectUrl, stopUrl;
    try {
      connectUrl = new URL(remote.connect);
      stopUrl = new URL(remote.stop);
    } catch { throw new Error('Browserless returned malformed session URLs'); }
    if (connectUrl.protocol !== 'wss:' || stopUrl.protocol !== 'https:') {
      throw new Error('Browserless returned session URLs with unexpected protocols');
    }

    const actualTtl = Number(remote.ttl) > 0 ? Number(remote.ttl) : config.ttlMs;
    const savedSession = {
      id: String(remote.id || id),
      connect: connectUrl.toString(),
      stop: stopUrl.toString(),
      createdAt: this.now(),
      expiresAt: this.now() + actualTtl
    };
    if (this.secretStore && this.secretStore.set(key, JSON.stringify(savedSession)) !== true) {
      try { await this.fetch(savedSession.stop + '&force=true', { method: 'DELETE', signal: AbortSignal.timeout(10000) }); } catch {}
      throw new Error('Could not securely persist Browserless session metadata');
    }
    return { ...savedSession, reused: false };
  }

  async forget(id) {
    const key = this._key(id);
    let saved = null;
    try { saved = JSON.parse(this.secretStore?.get(key) || 'null'); } catch {}
    if (!saved) return { ok: true, existed: false };
    let deleted = false;
    try {
      const separator = String(saved.stop).includes('?') ? '&' : '?';
      const response = await this.fetch(String(saved.stop) + separator + 'force=true', {
        method: 'DELETE',
        signal: AbortSignal.timeout(15000)
      });
      deleted = response.ok || response.status === 404;
    } catch {}
    this.secretStore?.remove(key);
    return { ok: true, existed: true, remoteDeleted: deleted };
  }
}

module.exports = { BrowserlessSessionManager, normalizeBaseUrl };
