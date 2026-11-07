'use strict';
// Discord Rich Presence for Kaset for Windows, with synced lyrics.
//
// Ported from kaset-discord-rpc (github.com/panch076/kaset-discord-rpc,
// bridge/main.swift). On macOS that project needs a WebKit extension plus a
// helper process; on Windows Kaset's main process already knows what's
// playing, so it talks to the Discord desktop client directly over its local
// IPC pipe (\\?\pipe\discord-ipc-N) using the same framing and payloads.
const net = require('net');
const crypto = require('crypto');

const log = (...a) => { if (process.env.KASET_DISCORD_DEBUG) console.log('[discord]', ...a); };

// ---------------------------------------------------------------- Discord IPC
class DiscordIPC {
  constructor() {
    this.clientId = null;
    this.sock = null;
    this.inbound = Buffer.alloc(0);
    this.isReady = false;
    this.connecting = false;
    this.onReady = null;
  }

  get isConnected() { return !!this.sock; }

  async connect(clientId) {
    if (this.isConnected || this.connecting) return this.isConnected;
    this.clientId = clientId;
    this.connecting = true;
    try {
      for (let i = 0; i < 10; i++) {
        const sock = await new Promise((resolve) => {
          const s = net.connect(`\\\\?\\pipe\\discord-ipc-${i}`);
          s.once('connect', () => resolve(s));
          s.once('error', () => resolve(null));
        });
        if (!sock) continue;
        this.sock = sock;
        sock.on('data', (d) => { this.inbound = Buffer.concat([this.inbound, d]); this.processInbound(); });
        sock.on('close', () => { log('Discord closed the connection'); this.disconnect(); });
        sock.on('error', () => this.disconnect());
        log('Connected to Discord at pipe', i);
        if (this.send(0, { v: 1, client_id: clientId })) return true;
      }
      return false;
    } finally {
      this.connecting = false;
    }
  }

  processInbound() {
    while (this.inbound.length >= 8) {
      const opcode = this.inbound.readUInt32LE(0);
      const length = this.inbound.readUInt32LE(4);
      if (this.inbound.length < 8 + length) return;
      const body = this.inbound.subarray(8, 8 + length);
      this.inbound = this.inbound.subarray(8 + length);
      let json = {};
      try { json = JSON.parse(body.toString('utf8')); } catch (_) {}
      if (opcode === 1) { // FRAME
        if (json.evt === 'READY') { log('Discord handshake complete'); this.isReady = true; this.onReady && this.onReady(); }
        else if (json.evt === 'ERROR') log('Discord error:', body.toString('utf8'));
      } else if (opcode === 2) { // CLOSE
        log('Discord rejected the connection:', body.toString('utf8'));
        this.lastError = json.message || 'Discord rejected the connection';
        this.disconnect();
        return;
      } else if (opcode === 3) { // PING
        this.sendRaw(4, body);
      }
    }
  }

  disconnect() {
    if (this.sock) { try { this.sock.destroy(); } catch (_) {} }
    this.sock = null;
    this.isReady = false;
    this.inbound = Buffer.alloc(0);
  }

  send(opcode, payload) { return this.sendRaw(opcode, Buffer.from(JSON.stringify(payload), 'utf8')); }

  sendRaw(opcode, data) {
    if (!this.sock) return false;
    const head = Buffer.alloc(8);
    head.writeUInt32LE(opcode, 0);
    head.writeUInt32LE(data.length, 4);
    try { this.sock.write(Buffer.concat([head, data])); return true; } catch (_) { log('Write to Discord failed'); this.disconnect(); return false; }
  }

  setActivity(activity) {
    return this.send(1, { cmd: 'SET_ACTIVITY', args: { pid: process.pid, activity: activity || null }, nonce: crypto.randomUUID() });
  }
}

// ---------------------------------------------------------------- Lyrics
// Time-synced lyrics from LRCLIB (https://lrclib.net), falling back to NetEase
// Cloud Music when it is down or has no synced lyrics; cached per track.
const UA = { 'User-Agent': 'KasetDiscordPresence/1.0 (https://github.com/sozercan/kaset)' };
const BRACKET_NOISE = /\s*[([][^)\]]*\b(feat|ft|from|official|video|audio|lyrics?|remaster(ed)?|visualizer|explicit)\b[^)\]]*[)\]]/gi;
const VERSION_KEYWORDS = 'feat|ft\\.|with|remaster|version|edit|mix|live|mono|stereo|deluxe|bonus|explicit|official|video|audio|lyrics|visualizer';
const RETRY_INTERVAL = 30e3; // a failed lookup says nothing about whether a song has lyrics, so it isn't cached
const MIN_CHUNK = 4;         // seconds each displayed chunk stays up; Discord allows ~5 updates per 20s
const FAST_SONG = 0.25;      // share of lines that would be skipped one-at-a-time before lines get grouped

const cleanTitle = (t) => t.replace(BRACKET_NOISE, '').trim();
function primaryArtist(artist) {
  let r = artist || '';
  for (const sep of [', ', ' & ', ' x ', ' feat', ' ft.', ' ・ ']) {
    const i = r.toLowerCase().indexOf(sep.toLowerCase());
    if (i >= 0) r = r.slice(0, i);
  }
  return r.trim();
}
function baseTitle(title) {
  return cleanTitle(title)
    .replace(new RegExp(`\\s*[([][^)\\]]*(${VERSION_KEYWORDS})[^)\\]]*[)\\]]`, 'gi'), '')
    .replace(new RegExp(`\\s+-\\s+.*(${VERSION_KEYWORDS}).*$`, 'i'), '')
    .trim();
}
const normalized = (s) => (s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const isDistinctVersion = (t) => /\b(remix|live|acoustic|instrumental|karaoke|cover|demo)\b/i.test(t);

function timedLines(lrc) {
  const lines = [];
  for (const raw of lrc.split(/\r?\n/)) {
    const tags = [...raw.matchAll(/\[(\d+):(\d+(?:[.:]\d+)?)\]/g)];
    if (!tags.length) continue;
    const last = tags[tags.length - 1];
    let text = raw.slice(last.index + last[0].length).trim();
    if ([...text].every((c) => '♪♫♬'.includes(c))) text = ''; // LRCLIB marks instrumental breaks with "♪"
    for (const t of tags) lines.push({ time: Number(t[1]) * 60 + Number(t[2].replace(':', '.')), text });
  }
  return lines.sort((a, b) => a.time - b.time);
}

// Simulates showing one line per update under Discord's rate limit and returns
// the share of lines that would never be shown (the next line starts first).
function skippedFraction(lines) {
  let lastShown = -Infinity, total = 0, skipped = 0;
  lines.forEach((line, i) => {
    const next = i + 1 < lines.length ? lines[i + 1].time : Infinity;
    const shownAt = Math.max(line.time, lastShown + MIN_CHUNK);
    const shown = shownAt < next;
    if (shown) lastShown = shownAt;
    if (!line.text) return;
    total++;
    if (!shown) skipped++;
  });
  return total ? skipped / total : 0;
}

// Groups lines that come in quick succession so none has to be skipped to stay
// under the rate limit. A chunk is shown when its newest line starts, with the
// lines sung since the previous update before it, so text never appears early.
function chunked(lines) {
  const chunks = [];
  let pending = [];
  let lastShown = -Infinity;
  const emit = (group, at) => {
    const texts = group.map((l) => l.text).filter(Boolean);
    while (texts.length > 1 && texts.join(' / ').length > 124) texts.shift(); // room for "♪ " in 128 chars
    chunks.push({ time: at, text: texts.join(' / ') });
    lastShown = at;
  };
  for (const line of lines) {
    if (line.time - lastShown < MIN_CHUNK) { pending.push(line); continue; }
    if (pending.length && line.time - lastShown >= 2 * MIN_CHUNK) { emit(pending, lastShown + MIN_CHUNK); pending = []; }
    emit([...pending, line], line.time);
    pending = [];
  }
  if (pending.length) emit(pending, lastShown + MIN_CHUNK);
  return chunks;
}

function parseLrc(lrc) {
  const sorted = timedLines(lrc);
  const skipped = skippedFraction(sorted);
  log(`Lyrics: ${Math.round(skipped * 100)}% of lines would be skipped — ${skipped > FAST_SONG ? 'grouping lines' : 'one line at a time'}`);
  return skipped > FAST_SONG ? chunked(sorted) : sorted;
}

async function getJson(url, { allowNon200 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10e3);
  try {
    // Node's fetch keeps no cookies (NetEase search goes wrong once it sets one).
    const r = await fetch(url, { headers: UA, signal: ctrl.signal });
    if (r.status !== 200) return { json: null, failed: allowNon200 ? false : (r.status >= 500 || r.status === 429), status: r.status };
    return { json: await r.json().catch(() => null), failed: false, status: 200 };
  } catch (_) {
    return { json: null, failed: true };
  } finally {
    clearTimeout(timer);
  }
}

async function lrclib(path, query) {
  const r = await getJson(`https://lrclib.net/api/${path}?${new URLSearchParams(query)}`);
  return { json: r.json, failed: r.status ? (r.status >= 500 || r.status === 429) : r.failed };
}

// NetEase mixes credits in with the lyrics, e.g. "[00:00.00] 作词 : Someone".
function strippingCredits(lrc) {
  const credit = new RegExp('^\\s*(\\p{Script=Han}{1,10}\\s*[:：]\\s|(作词|作曲|编曲|词|曲|制作人|监制)\\s*[:：]'
    + '|(artist|song|title|album|lyrics?|lyricist|composer|producer|arranger|written by)\\s*[:：]\\s'
    + '|[\\p{L}&/ ]{1,30} [:：] )', 'iu');
  return lrc.split(/\r?\n/).filter((line) => !credit.test(line.replace(/^(\[[^\]]*\])+/, ''))).join('\n');
}

// Candidates that are really this recording, best first. A wrong song is worse
// than none, so title, artist and length must all agree.
function netEaseMatches(track, songs) {
  const exactTitle = normalized(track.title);
  const title = normalized(baseTitle(track.title));
  const artist = normalized(primaryArtist(track.artist));
  if (!title || !artist) return [];
  const isVersion = isDistinctVersion(track.title);
  const isExact = (s) => normalized(s.name) === exactTitle;
  const distance = (s) => (track.duration > 0 ? Math.abs(track.duration - s.seconds) : 0);
  return songs
    .filter((s) => s.artists.some((a) => normalized(a) === artist) && distance(s) < 15
      && (isExact(s) || (normalized(baseTitle(s.name)) === title && (isVersion || !isDistinctVersion(s.name)))))
    .sort((a, b) => (isExact(a) !== isExact(b) ? (isExact(a) ? -1 : 1) : distance(a) - distance(b)));
}

async function netEase(track) {
  const q = new URLSearchParams({ s: `${baseTitle(track.title)} ${primaryArtist(track.artist)}`, type: '1', limit: '20' });
  const found = await getJson(`https://music.163.com/api/search/get?${q}`);
  if (found.failed || !found.json || found.json.code !== 200) return { lrc: null, failed: true };
  const songs = (found.json.result?.songs || []).map((s) => (s && typeof s.id === 'number' && typeof s.name === 'string' && typeof s.duration === 'number' && Array.isArray(s.artists)
    ? { id: s.id, name: s.name, seconds: s.duration / 1000, artists: s.artists.map((a) => a.name).filter(Boolean) } : null)).filter(Boolean);
  // The closest match can have no lyrics while a re-release of it does.
  for (const song of netEaseMatches(track, songs).slice(0, 3)) {
    const r = await getJson(`https://music.163.com/api/song/lyric?${new URLSearchParams({ id: String(song.id), lv: '1' })}`);
    if (r.failed) return { lrc: null, failed: true };
    const raw = r.json?.lrc?.lyric;
    if (typeof raw !== 'string') continue;
    const lrc = strippingCredits(raw);
    // Unsynced lyrics come back with one placeholder timestamp, if any.
    if (new Set(timedLines(lrc).map((l) => l.time)).size >= 3) return { lrc, failed: false };
  }
  return { lrc: null, failed: false };
}

async function fetchLyrics(track) {
  const title = cleanTitle(track.title);
  const artist = primaryArtist(track.artist);
  const query = { track_name: title, artist_name: artist };
  if (track.duration > 0) query.duration = String(Math.round(track.duration));
  const exact = await lrclib('get', query);
  if (exact.json?.syncedLyrics) return { lines: parseLrc(exact.json.syncedLyrics), failed: false };
  let failed = exact.failed;
  let results = [];
  if (!failed) {
    // Fall back to a search, preferring a result whose length matches.
    const search = await lrclib('search', { track_name: title, artist_name: artist });
    failed = search.failed;
    results = Array.isArray(search.json) ? search.json : [];
    const synced = results.filter((r) => r.syncedLyrics);
    const match = synced.find((r) => track.duration > 0 && typeof r.duration === 'number' && Math.abs(r.duration - track.duration) <= 3) || synced[0];
    if (match) return { lines: parseLrc(match.syncedLyrics), failed: false };
  }
  if ((exact.json || results[0])?.instrumental === true) return { lines: [], failed: false };
  const fb = await netEase(track);
  if (fb.lrc) { log('Using NetEase lyrics for', track.title); return { lines: parseLrc(fb.lrc), failed: false }; }
  return { lines: [], failed: failed || fb.failed };
}

class LyricsStore {
  constructor() { this.cache = new Map(); this.inFlight = new Set(); this.retryAfter = new Map(); this.onLoaded = null; }
  // Synced lyrics for the track, or null if unavailable or still loading.
  lines(track) {
    const key = `${track.title}\u001f${track.artist || ''}`;
    if (this.cache.has(key)) { const l = this.cache.get(key); return l.length ? l : null; }
    if (!this.inFlight.has(key) && (this.retryAfter.get(key) || 0) <= Date.now()) {
      this.inFlight.add(key);
      fetchLyrics(track).then(({ lines, failed }) => {
        this.inFlight.delete(key);
        if (failed) { this.retryAfter.set(key, Date.now() + RETRY_INTERVAL); return; }
        this.retryAfter.delete(key);
        this.cache.set(key, lines);
        if (this.cache.size > 200) this.cache.delete(this.cache.keys().next().value);
        log(lines.length ? `Loaded ${lines.length} lyric lines for ${track.title}` : `No synced lyrics for ${track.title}`);
        if (lines.length && this.onLoaded) this.onLoaded();
      });
    }
    return null;
  }
}

// ---------------------------------------------------------------- Presence
const STALE_AFTER = 30e3;
const LYRIC_INTERVAL = 3.5e3; // chunks are already >=4s apart; slightly lower so timer jitter doesn't delay them
const LYRIC_LEAD = 0.5;       // show each lyric slightly early to make up for Discord's display latency

function field(value) {
  let text = (value || '').trim();
  if (!text) return undefined;
  if ([...text].length > 128) text = [...text].slice(0, 127).join('') + '…';
  if ([...text].length < 2) text += '​';
  return text;
}

class Presence {
  constructor(getSettings) {
    this.getSettings = getSettings; // () => settings.discord
    this.ipc = new DiscordIPC();
    this.lyrics = new LyricsStore();
    this.latest = new Map(); // source -> { track, receivedAt }
    this.lastSignature = null;
    this.lastLyric = undefined;
    this.lastStart = null;
    this.lastSentAt = 0;
    this.lastConnectAttempt = 0;
    this.connectedClientId = null;
    this.ipc.onReady = () => { this.lastSignature = null; this.update(); };
    this.lyrics.onLoaded = () => this.update();
    this.timer = setInterval(() => this.update(), 1000);
  }

  get config() { return this.getSettings() || {}; }

  /** track: { source: 'music'|'youtube', title, artist, album, artwork, videoId, playing, position, duration } */
  receive(track) {
    if (!track || !track.title) return;
    this.latest.set(track.source, { track, receivedAt: Date.now() });
  }

  clearSource(source) { this.latest.delete(source); }

  status() {
    return { connected: this.ipc.isReady, error: this.ipc.lastError || null, enabled: !!(this.config.enabled && this.config.clientId) };
  }

  current() {
    const now = Date.now();
    const fresh = [...this.latest.values()].filter((e) => now - e.receivedAt < STALE_AFTER).sort((a, b) => b.receivedAt - a.receivedAt);
    const playing = fresh.find((e) => e.track.playing);
    if (playing) return playing;
    if (this.config.clearOnPause === false && fresh[0]) return fresh[0];
    return null;
  }

  // The lyric at `position`: null without synced lyrics, '' before the first line.
  lyric(track, position) {
    if (this.config.lyrics === false || track.source !== 'music' || !track.playing) return null;
    const lines = this.lyrics.lines(track);
    if (!lines) return null;
    let text = '';
    for (const l of lines) { if (l.time <= position + LYRIC_LEAD) text = l.text; else break; }
    return text;
  }

  update() {
    const cfg = this.config;
    if (!cfg.enabled || !/^\d{15,22}$/.test(cfg.clientId || '')) {
      if (this.ipc.isConnected) { this.ipc.setActivity(null); this.ipc.disconnect(); }
      this.lastSignature = null;
      return;
    }
    if (this.ipc.isConnected && this.connectedClientId !== cfg.clientId) { this.ipc.disconnect(); this.lastSignature = null; }
    if (!this.ipc.isConnected) {
      if (Date.now() - this.lastConnectAttempt < 5e3) return;
      this.lastConnectAttempt = Date.now();
      this.connectedClientId = cfg.clientId;
      this.ipc.lastError = null;
      this.ipc.connect(cfg.clientId);
      return;
    }
    if (!this.ipc.isReady) return;

    const cur = this.current();
    if (!cur) {
      if (this.lastSignature !== 'none' && this.ipc.setActivity(null)) { this.lastSignature = 'none'; this.lastStart = null; log('Cleared presence'); }
      return;
    }
    const { track, receivedAt } = cur;
    // Start time derived from the latest report; small drift is ignored so we
    // don't hit Discord's rate limit every heartbeat.
    const position = (track.position || 0) + (track.playing ? (Date.now() - receivedAt) / 1000 : 0);
    const start = Date.now() / 1000 - position;
    const lyric = this.lyric(track, position);
    const signature = [track.source, track.title, track.artist || '', track.album || '', track.artwork || '',
      String(track.playing), String(Math.trunc(track.duration || 0)), String(lyric !== null), cfg.statusDisplay || ''].join('\u001f');
    const trackChanged = signature !== this.lastSignature;
    const seeked = this.lastStart == null || Math.abs(this.lastStart - start) >= 2;
    const lyricChanged = lyric !== this.lastLyric;
    if (!trackChanged && !seeked && !(lyricChanged && Date.now() - this.lastSentAt >= LYRIC_INTERVAL)) return;

    if (this.ipc.setActivity(this.activity(track, start, lyric))) {
      if (trackChanged) log('Presence:', track.playing ? '▶' : '⏸', track.title, '—', track.artist);
      this.lastSignature = signature;
      this.lastLyric = lyric;
      this.lastStart = start;
      this.lastSentAt = Date.now();
    }
  }

  activity(track, start, lyric) {
    const isMusic = track.source === 'music';
    const a = {
      type: isMusic ? 2 : 3, // 2 = Listening, 3 = Watching
      status_display_type: { artist: 1, title: 2 }[this.config.statusDisplay] || 0,
      instance: false,
    };
    if (lyric !== null) {
      // Lyrics take the second line, so the artist moves up next to the title.
      a.details = field(track.title + (track.artist ? ` — ${track.artist}` : ''));
      a.state = field(lyric ? `♪ ${lyric}` : '♪');
    } else {
      a.details = field(track.title);
      const artist = field(track.artist);
      if (artist) a.state = track.playing ? artist : field(`Paused · ${artist}`);
      else if (!track.playing) a.state = 'Paused';
    }
    const assets = {};
    if (track.artwork && track.artwork.startsWith('https://') && track.artwork.length <= 256) assets.large_image = track.artwork;
    else if (track.videoId) assets.large_image = `https://i.ytimg.com/vi/${track.videoId}/hqdefault.jpg`;
    const largeText = field(track.album) || field(track.title);
    if (largeText) assets.large_text = largeText;
    if (Object.keys(assets).length) a.assets = assets;
    if (track.playing && track.duration > 0) {
      const startMs = Math.round(start * 1000);
      a.timestamps = { start: startMs, end: startMs + Math.round(track.duration * 1000) };
    }
    if (track.videoId) {
      a.buttons = [{
        label: isMusic ? 'Listen on YouTube Music' : 'Watch on YouTube',
        url: isMusic ? `https://music.youtube.com/watch?v=${track.videoId}` : `https://www.youtube.com/watch?v=${track.videoId}`,
      }];
    }
    return a;
  }

  shutdown() {
    clearInterval(this.timer);
    if (this.ipc.isConnected) { this.ipc.setActivity(null); this.ipc.disconnect(); }
  }
}

// Bigger square artwork for Google image URLs (as the extension does).
const bigArtwork = (url) => (url ? url.replace(/=w\d+-h\d+[^&]*$/, '=w512-h512-l90-rj').replace(/=s\d+[^&]*$/, '=s512') : '');

module.exports = { Presence, fetchLyrics, bigArtwork, _test: { timedLines, chunked, skippedFraction, baseTitle, primaryArtist, cleanTitle, normalized, strippingCredits } };
