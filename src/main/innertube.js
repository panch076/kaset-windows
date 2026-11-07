'use strict';
// InnerTube transport. Requests run inside a hidden window on the client's
// origin so the signed-in session's cookies are attached by Chromium itself;
// the SAPISIDHASH header is computed in-page from that same origin.
//
// Two transports exist (as in Kaset for macOS):
//   - YouTube Music: WEB_REMIX on https://music.youtube.com (this module's default export)
//   - YouTube:       WEB       on https://www.youtube.com    (see youtube-innertube.js)
const { BrowserWindow } = require('electron');

// Runs in the page. Must be self-contained.
async function pageRequest({ endpoint, body, clientName, clientNameId, clientVersion, hl, gl }) {
  const cookie = document.cookie.split('; ').reduce((m, kv) => {
    const i = kv.indexOf('=');
    m[kv.slice(0, i)] = kv.slice(i + 1);
    return m;
  }, {});
  const sapisid = cookie.SAPISID || cookie['__Secure-3PAPISID'];
  const headers = {
    'Content-Type': 'application/json',
    'X-Goog-AuthUser': '0',
    'X-Origin': location.origin,
    'X-YouTube-Client-Name': String(clientNameId),
    'X-YouTube-Client-Version': clientVersion,
  };
  if (sapisid) {
    const ts = Math.floor(Date.now() / 1000);
    const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(`${ts} ${sapisid} ${location.origin}`));
    const hex = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
    headers.Authorization = `SAPISIDHASH ${ts}_${hex}`;
  }
  const client = {
    clientName,
    clientVersion,
    hl: hl || 'en',
    platform: 'DESKTOP',
    utcOffsetMinutes: -new Date().getTimezoneOffset(),
  };
  if (gl) client.gl = gl;
  const context = { client, user: { lockedSafetyMode: false } };
  const res = await fetch(`/youtubei/v1/${endpoint}?prettyPrint=false`, {
    method: 'POST',
    credentials: 'include',
    headers,
    body: JSON.stringify({ context, ...body }),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) {}
  return { status: res.status, json, signedIn: !!sapisid };
}

function createTransport({ origin, clientName, clientNameId, clientVersion, label }) {
  let win = null;
  let readyPromise = null;

  function ensureWindow(session) {
    if (win && !win.isDestroyed()) return readyPromise;
    win = new BrowserWindow({
      show: false,
      webPreferences: { session, contextIsolation: true, sandbox: true, backgroundThrottling: false },
    });
    win.webContents.setAudioMuted(true);
    readyPromise = win.loadURL(`${origin}/robots.txt`).catch(() => {});
    return readyPromise;
  }

  function reset() {
    if (win && !win.isDestroyed()) win.destroy();
    win = null;
    readyPromise = null;
  }

  async function request(session, endpoint, body = {}, opts = {}) {
    await ensureWindow(session);
    const arg = JSON.stringify({ endpoint, body, clientName, clientNameId, clientVersion, hl: opts.hl, gl: opts.gl });
    const r = await win.webContents.executeJavaScript(`(${pageRequest.toString()})(${arg})`, true);
    if (r.status === 401 || r.status === 403) {
      const err = new Error('Not signed in or session expired');
      err.code = 'AUTH';
      throw err;
    }
    if (r.status >= 400 || !r.json) {
      const err = new Error(`${label} request failed (${r.status}) ${r.json?.error?.message || ''}`.trim());
      err.code = 'HTTP';
      throw err;
    }
    return r.json;
  }

  return { request, reset, CLIENT_VERSION: clientVersion };
}

const music = createTransport({
  origin: 'https://music.youtube.com',
  clientName: 'WEB_REMIX',
  clientNameId: 67,
  clientVersion: '1.20251020.01.00',
  label: 'YouTube Music',
});

module.exports = { ...music, createTransport };
