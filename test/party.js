// End-to-end check of Listening Party: starts the real app, turns the party on,
// then behaves like a guest over HTTP and checks the host's queue.
// Usage: npx electron test/party.js <outDir>
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const out = process.argv[process.argv.length - 1];
fs.mkdirSync(out, { recursive: true });
const logFile = path.join(out, 'log.txt');
fs.writeFileSync(logFile, '');
const log = (...a) => fs.appendFileSync(logFile, a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ') + '\n');
let failures = 0;
const check = (name, ok, detail = '') => { if (!ok) failures++; log(ok ? 'PASS' : 'FAIL', name, detail); };
app.setPath('userData', path.join(out, 'userdata'));
require('../src/main/main.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const main = () => BrowserWindow.getAllWindows().find((w) => /index\.html$/.test(w.webContents.getURL()));
const js = (code, w = main()) => w.webContents.executeJavaScript(code, true);
const shot = async (name, w = main()) => fs.writeFileSync(path.join(out, name + '.png'), (await w.webContents.capturePage()).toPNG());

const PORT = 8349;
const base = `http://127.0.0.1:${PORT}`;
function guest(key) {
  let cookie = '';
  return async (p, opts = {}) => {
    const r = await fetch(base + p, { ...opts, headers: { 'X-Kaset-Key': key, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) } });
    const sc = r.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    return { status: r.status, body: await r.json().catch(() => null) };
  };
}

app.whenReady().then(async () => {
  try {
    await sleep(8000);
    let st = await js(`window.kaset.party('set', { enabled: true, port: ${PORT}, maxPerGuest: 2 })`);
    check('party starts', st.running && st.port === PORT, JSON.stringify({ urls: st.urls.map((u) => u.url), error: st.error }));
    check('QR code generated', !st.urls.length || /^data:image\/png/.test(st.urls[0].qr));
    const key = (await js(`window.kaset.getSettings()`)).party.key;

    const page = await fetch(base + '/');
    check('guest page served with CSP', page.status === 200 && /script-src 'self'/.test(page.headers.get('content-security-policy') || ''));
    check('wrong key rejected', (await guest('nope-nope')('/api/state')).status === 401);
    check('no key rejected', (await fetch(base + '/api/state')).status === 401);

    const alice = guest(key);
    const s0 = await alice('/api/state');
    check('state readable with key', s0.status === 200 && Array.isArray(s0.body.upNext));
    await alice('/api/name', { method: 'POST', body: JSON.stringify({ name: 'Alice<script>' }) });
    const found = await alice('/api/search?q=' + encodeURIComponent('daft punk get lucky'));
    check('search returns songs', found.status === 200 && found.body.items.length > 3, `${found.body.items.length} songs, first: ${found.body.items[0]?.title} — ${found.body.items[0]?.artist}`);
    const sug = await alice('/api/suggest?q=daft');
    check('suggestions work', sug.body.queries.length > 0);

    const [a, b, c, d, e] = found.body.items;
    const r1 = await alice('/api/request', { method: 'POST', body: JSON.stringify({ videoId: a.videoId, name: 'Alice' }) });
    check('request accepted', r1.status === 200 && r1.body.status === 'queued', JSON.stringify(r1.body));
    check('too-fast second request throttled', (await alice('/api/request', { method: 'POST', body: JSON.stringify({ videoId: b.videoId }) })).status === 429);
    await sleep(6000);
    const hostState = (await alice('/api/state')).body;
    check('empty queue: request starts playing', hostState.nowPlaying && hostState.nowPlaying.videoId === a.videoId && hostState.nowPlaying.requestedBy === 'Alice', JSON.stringify(hostState.nowPlaying));

    const r2 = await alice('/api/request', { method: 'POST', body: JSON.stringify({ videoId: b.videoId }) });
    check('second request queued', r2.status === 200, JSON.stringify(r2.body));
    await sleep(1500);
    const s2 = (await alice('/api/state')).body;
    check('second request is first in Up Next', s2.upNext[0]?.videoId === b.videoId && s2.upNext[0]?.requestedBy === 'Alice', JSON.stringify(s2.upNext.slice(0, 2)));
    check('guest name sanitised', !/[<>]/.test(s2.me.name), s2.me.name);
    await sleep(4500);
    const r3 = await alice('/api/request', { method: 'POST', body: JSON.stringify({ videoId: c.videoId }) });
    check('playing song does not count against the limit', r3.status === 200, JSON.stringify(r3.body));
    await sleep(4500);
    const r3b = await alice('/api/request', { method: 'POST', body: JSON.stringify({ videoId: d.videoId }) });
    check('per-guest limit enforced', r3b.status === 429, JSON.stringify(r3b.body));
    check('junk video id rejected', (await alice('/api/request', { method: 'POST', body: JSON.stringify({ videoId: '../../etc' }) })).status === 400);

    // Approval mode with a second guest
    await js(`window.kaset.party('set', { requireApproval: true })`);
    const bob = guest(key);
    const r4 = await bob('/api/request', { method: 'POST', body: JSON.stringify({ videoId: e.videoId, name: 'Bob' }) });
    check('approval mode: request is pending', r4.status === 200 && r4.body.status === 'pending', JSON.stringify(r4.body));
    await sleep(800);
    await js(`document.querySelector('#btn-queue').click()`); await sleep(1200);
    check('host sees pending request', await js(`document.querySelectorAll('#panel-body .q-item.pending').length === 1`));
    await shot('host-queue-pending');
    await js(`document.querySelector('[data-party-ok]').click()`); await sleep(1500);
    const s3 = (await bob('/api/state')).body;
    check('approved request queued after earlier requests', s3.upNext[2]?.videoId === e.videoId && s3.upNext[2]?.requestedBy === 'Bob' && s3.me.requests[e.videoId]?.status === 'queued', JSON.stringify(s3.upNext.slice(0, 4).map((x) => [x.title, x.requestedBy])));
    await shot('host-queue');

    // Screens
    await js(`document.querySelector('#panel-close').click(); document.dispatchEvent(new KeyboardEvent('keydown',{key:',',ctrlKey:true}))`); await sleep(800);
    await js(`document.querySelector('[data-stab="party"]').click()`); await sleep(1500);
    await shot('host-settings');
    const phone = new BrowserWindow({ show: false, width: 390, height: 844, webPreferences: { partition: 'guest-test' } });
    await phone.loadURL(`${base}/?k=${key}`); await sleep(1500);
    await phone.webContents.executeJavaScript(`document.querySelector('#name-input').value='Maya'; document.querySelector('#name-save').click()`); await sleep(600);
    await phone.webContents.executeJavaScript(`const i=document.querySelector('#q'); i.value='around the world daft punk'; i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter'}))`); await sleep(4000);
    await shot('guest-phone', phone);
    check('guest page shows results and queue', await phone.webContents.executeJavaScript(`document.querySelectorAll('#results .row').length > 3 && document.querySelectorAll('#queue .row').length >= 2`));

    // Rotating the link locks out old guests
    await js(`window.kaset.party('rotate')`);
    check('old link stops working after New Link', (await alice('/api/state')).status === 401);
    st = await js(`window.kaset.party('set', { enabled: false })`);
    await sleep(500);
    let closed = false;
    try { await fetch(base + '/', { signal: AbortSignal.timeout(1500) }); } catch (_) { closed = true; }
    check('server stops when turned off', !st.running && closed);
  } catch (e) { failures++; log('ERROR', e.stack); }
  log(failures ? `${failures} FAILED` : 'ALL PASSED');
  app.exit(failures ? 1 : 0);
});
