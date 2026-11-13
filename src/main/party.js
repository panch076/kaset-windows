'use strict';
// Listening Party: a small web server on the local network. Guests open the
// link (or scan the QR code) on a phone or computer, search YouTube Music and
// request songs; requests go into the host's Up Next queue.
//
// Safety model:
//  - Off by default; only runs while the host has it switched on.
//  - Only answers clients on private/local addresses (LAN, loopback).
//  - Every API call needs the room key from the shared link; rotating it
//    locks out everyone who had the old link.
//  - Guests can only search and request. They can't control playback.
//  - Song metadata always comes from YouTube Music, never from the guest,
//    and guest names are length-limited and escaped by the pages that show them.
const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const STATIC_DIR = path.join(__dirname, '..', 'party');
const ICON = path.join(__dirname, '..', '..', 'build', 'icon.png');
const STATIC = {
  '/': ['guest.html', 'text/html; charset=utf-8'],
  '/guest.css': ['guest.css', 'text/css; charset=utf-8'],
  '/guest.js': ['guest.js', 'text/javascript; charset=utf-8'],
};
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const MAX_BODY = 4096;

function isPrivateAddress(addr) {
  if (!addr) return false;
  const a = addr.replace(/^::ffff:/, '');
  if (a === '::1' || a.startsWith('127.')) return true;
  if (/^10\./.test(a) || /^192\.168\./.test(a) || /^169\.254\./.test(a)) return true;
  const m = a.match(/^172\.(\d+)\./);
  if (m && +m[1] >= 16 && +m[1] <= 31) return true;
  if (/^(fe80|fc|fd)/i.test(a)) return true; // IPv6 link-local / unique-local
  return false;
}

function lanAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const i of list || []) {
      if (i.family !== 'IPv4' || i.internal || !isPrivateAddress(i.address) || i.address.startsWith('169.254.')) continue;
      if (/vEthernet|VirtualBox|VMware|WSL|Hyper-V|Loopback|Bluetooth/i.test(name)) continue;
      out.push({ name, address: i.address });
    }
  }
  // Prefer Wi-Fi / Ethernet adapters, then 192.168.x
  const score = (x) => (/wi-?fi|wlan|wireless/i.test(x.name) ? 0 : /ethernet/i.test(x.name) ? 1 : 2) * 10 + (x.address.startsWith('192.168.') ? 0 : 1);
  return out.sort((a, b) => score(a) - score(b));
}

const newKey = () => crypto.randomBytes(6).toString('base64url');
const cleanName = (s) => String(s || '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 24) || 'Guest';

class PartyServer {
  /**
   * @param {object} deps
   * @param {(q:string)=>Promise<object[]>} deps.searchSongs
   * @param {(q:string)=>Promise<string[]>} deps.suggest
   * @param {(videoId:string)=>Promise<object|null>} deps.lookup  resolve a song's metadata by id
   * @param {(req:object)=>void} deps.onRequest                     a guest asked for a song
   * @param {(status:object)=>void} deps.onStatus                   guest count / server status changed
   */
  constructor(deps) {
    this.deps = deps;
    this.server = null;
    this.port = 0;
    this.key = null;
    this.options = { requireApproval: false, maxPerGuest: 3, hostName: '' };
    this.snapshot = { nowPlaying: null, upNext: [] };
    this.streams = new Set();
    this.guests = new Map(); // guestId -> { name, lastSeen, lastRequestAt, ip }
    this.known = new Map(); // videoId -> song metadata seen in guest searches (bounded)
    this.requests = new Map(); // requestId -> { guestId, videoId, status }
    this.error = null;
  }

  get running() { return !!this.server?.listening; }

  status() {
    const addrs = lanAddresses();
    const urls = this.running ? addrs.map((a) => ({ name: a.name, url: `http://${a.address}:${this.port}/?k=${this.key}` })) : [];
    const cutoff = Date.now() - 60e3;
    const active = [...this.guests.values()].filter((g) => g.lastSeen > cutoff).length;
    return { running: this.running, port: this.port, urls, guests: Math.max(active, this.streams.size), error: this.error };
  }

  configure(opts) {
    Object.assign(this.options, opts);
    this.broadcast();
  }

  async start({ port = 8338, key } = {}) {
    if (this.running && this.port === port) { if (key) this.key = key; return this.status(); }
    await this.stop();
    this.key = key || this.key || newKey();
    this.error = null;
    const server = http.createServer((req, res) => this.handle(req, res).catch(() => this.send(res, 500, { error: 'Something went wrong' })));
    server.keepAliveTimeout = 5000;
    server.headersTimeout = 10000;
    await new Promise((resolve) => {
      server.once('error', (e) => {
        this.error = e.code === 'EADDRINUSE' ? `Port ${port} is already in use. Pick another port.` : e.message;
        resolve();
      });
      server.listen(port, '0.0.0.0', () => { this.server = server; this.port = port; resolve(); });
    });
    this.deps.onStatus(this.status());
    return this.status();
  }

  async stop() {
    for (const s of this.streams) { try { s.end(); } catch (_) {} }
    this.streams.clear();
    if (this.server) await new Promise((r) => this.server.close(() => r()));
    this.server = null;
    this.deps.onStatus?.(this.status());
  }

  rotateKey() {
    this.key = newKey();
    for (const s of this.streams) { try { s.end(); } catch (_) {} }
    this.streams.clear();
    this.guests.clear();
    this.deps.onStatus(this.status());
    return this.key;
  }

  /** Host's queue changed: { nowPlaying, upNext } with requestedBy on guest songs. */
  setSnapshot(snap) {
    this.snapshot = snap;
    // Track which requests are still waiting, so per-guest limits free up as songs play.
    const queuedIds = new Set((snap.upNext || []).map((x) => x.requestId).filter(Boolean));
    for (const [id, r] of this.requests) {
      // A song that has started (or been removed by the host) no longer counts as waiting.
      // The age check keeps a snapshot sent just before the request from clearing it.
      if (r.status === 'queued' && !queuedIds.has(id) && Date.now() - r.at > 3000) r.status = snap.nowPlaying?.requestId === id ? 'playing' : 'played';
      else if (r.status === 'playing' && snap.nowPlaying?.requestId !== id) r.status = 'played';
    }
    this.broadcast();
  }

  /** Host approved or declined a pending request. */
  resolveRequest(requestId, approved) {
    const r = this.requests.get(requestId);
    if (!r) return;
    r.status = approved ? 'queued' : 'declined';
    this.broadcast();
  }

  // ---------------------------------------------------------------- HTTP
  send(res, code, body, headers = {}) {
    if (res.headersSent) return;
    const isJson = typeof body !== 'string' && !Buffer.isBuffer(body);
    res.writeHead(code, {
      'Content-Type': isJson ? 'application/json; charset=utf-8' : headers['Content-Type'] || 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'X-Frame-Options': 'DENY',
      ...headers,
    });
    res.end(isJson ? JSON.stringify(body) : body);
  }

  guestFrom(req, res) {
    const cookie = Object.fromEntries((req.headers.cookie || '').split(/;\s*/).filter(Boolean).map((c) => { const i = c.indexOf('='); return [c.slice(0, i), c.slice(i + 1)]; }));
    let id = cookie.kaset_guest;
    if (!id || !/^[A-Za-z0-9_-]{16}$/.test(id)) {
      id = crypto.randomBytes(12).toString('base64url');
      res.setHeader('Set-Cookie', `kaset_guest=${id}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400`);
    }
    let g = this.guests.get(id);
    if (!g) { g = { name: 'Guest', lastSeen: 0, lastRequestAt: 0, ip: req.socket.remoteAddress }; this.guests.set(id, g); }
    const before = g.lastSeen;
    g.lastSeen = Date.now();
    if (Date.now() - before > 60e3) this.deps.onStatus(this.status());
    return [id, g];
  }

  readBody(req) {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
      req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch (e) { reject(e); } });
      req.on('error', reject);
    });
  }

  async handle(req, res) {
    if (!isPrivateAddress(req.socket.remoteAddress)) return this.send(res, 403, 'Kaset parties are only available on the local network.');
    const url = new URL(req.url, 'http://local');
    const p = url.pathname;

    if (req.method === 'GET' && STATIC[p]) {
      const [file, type] = STATIC[p];
      const csp = "default-src 'self'; img-src 'self' https: data:; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
      return this.send(res, 200, fs.readFileSync(path.join(STATIC_DIR, file)), { 'Content-Type': type, 'Content-Security-Policy': csp });
    }
    if (req.method === 'GET' && (p === '/icon.png' || p === '/favicon.ico')) {
      return this.send(res, 200, fs.readFileSync(ICON), { 'Content-Type': 'image/png', 'Cache-Control': 'max-age=86400' });
    }
    if (!p.startsWith('/api/')) return this.send(res, 404, 'Not found');

    // Everything under /api needs the room key.
    const key = req.headers['x-kaset-key'] || url.searchParams.get('k');
    if (!key || !this.key || key.length !== this.key.length || !crypto.timingSafeEqual(Buffer.from(key), Buffer.from(this.key))) {
      return this.send(res, 401, { error: 'This party link has expired. Ask the host for the new one.' });
    }
    const [guestId, guest] = this.guestFrom(req, res);

    if (req.method === 'GET' && p === '/api/state') return this.send(res, 200, this.publicState(guestId));

    if (req.method === 'GET' && p === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Content-Type-Options': 'nosniff' });
      res.write(`retry: 3000\n\n`);
      const stream = { res, guestId, end: () => res.end() };
      stream.write = (d) => res.write(`data: ${JSON.stringify(d)}\n\n`);
      stream.write(this.publicState(guestId));
      this.streams.add(stream);
      const ping = setInterval(() => res.write(': ping\n\n'), 25000);
      req.on('close', () => { clearInterval(ping); this.streams.delete(stream); this.deps.onStatus(this.status()); });
      this.deps.onStatus(this.status());
      return;
    }

    if (req.method === 'GET' && p === '/api/search') {
      const q = String(url.searchParams.get('q') || '').trim().slice(0, 120);
      if (!q) return this.send(res, 200, { items: [] });
      const items = await this.deps.searchSongs(q);
      for (const it of items) this.remember(it);
      return this.send(res, 200, { items });
    }

    if (req.method === 'GET' && p === '/api/suggest') {
      const q = String(url.searchParams.get('q') || '').trim().slice(0, 120);
      return this.send(res, 200, { queries: q ? await this.deps.suggest(q) : [] });
    }

    if (req.method === 'POST' && p === '/api/name') {
      const body = await this.readBody(req).catch(() => null);
      if (!body) return this.send(res, 400, { error: 'Bad request' });
      guest.name = cleanName(body.name);
      return this.send(res, 200, { name: guest.name });
    }

    if (req.method === 'POST' && p === '/api/request') {
      const body = await this.readBody(req).catch(() => null);
      if (!body || !VIDEO_ID.test(String(body.videoId || ''))) return this.send(res, 400, { error: 'Bad request' });
      if (body.name) guest.name = cleanName(body.name);
      const now = Date.now();
      if (now - guest.lastRequestAt < 4000) return this.send(res, 429, { error: 'Slow down a little — try again in a few seconds.' });
      const mine = [...this.requests.values()].filter((r) => r.guestId === guestId && (r.status === 'queued' || r.status === 'pending'));
      const max = Number(this.options.maxPerGuest) || 0;
      if (max > 0 && mine.length >= max) {
        return this.send(res, 429, { error: `You have ${mine.length} song${mine.length === 1 ? '' : 's'} waiting. Add more once one plays.` });
      }
      if (mine.some((r) => r.videoId === body.videoId)) return this.send(res, 409, { error: "You've already requested this song." });
      const song = this.known.get(body.videoId) || (await this.deps.lookup(body.videoId));
      if (!song) return this.send(res, 404, { error: "Couldn't find that song." });
      guest.lastRequestAt = now;
      const requestId = crypto.randomBytes(8).toString('base64url');
      const status = this.options.requireApproval ? 'pending' : 'queued';
      this.requests.set(requestId, { guestId, videoId: song.videoId, status, at: now });
      if (this.requests.size > 500) this.requests.delete(this.requests.keys().next().value);
      this.deps.onRequest({ requestId, status, requestedBy: guest.name, song });
      this.broadcast();
      return this.send(res, 200, { ok: true, status, requestId });
    }

    return this.send(res, 404, { error: 'Not found' });
  }

  remember(it) {
    this.known.set(it.videoId, it);
    if (this.known.size > 2000) this.known.delete(this.known.keys().next().value);
  }

  publicState(guestId) {
    const mine = {};
    for (const [id, r] of this.requests) if (r.guestId === guestId) mine[r.videoId] = { status: r.status, requestId: id };
    const g = this.guests.get(guestId);
    return {
      nowPlaying: this.snapshot.nowPlaying,
      upNext: this.snapshot.upNext,
      party: { hostName: this.options.hostName, requireApproval: !!this.options.requireApproval, maxPerGuest: Number(this.options.maxPerGuest) || 0 },
      me: { name: g?.name || 'Guest', requests: mine },
      guests: this.status().guests,
    };
  }

  broadcast() {
    if (!this.streams.size) return;
    clearTimeout(this._bt);
    this._bt = setTimeout(() => {
      for (const s of this.streams) { try { s.write(this.publicState(s.guestId)); } catch (_) {} }
    }, 150);
  }
}

module.exports = { PartyServer, lanAddresses, isPrivateAddress };
