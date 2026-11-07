// Launches the real app, drives the main flows, and writes screenshots + a log.
// Usage: npx electron test/smoke.js <outDir>
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const out = process.argv[process.argv.length - 1];
fs.mkdirSync(out, { recursive: true });
const log = (...a) => fs.appendFileSync(path.join(out, 'log.txt'), a.map((x) => typeof x === 'string' ? x : JSON.stringify(x)).join(' ') + '\n');
fs.writeFileSync(path.join(out, 'log.txt'), '');
app.setPath('userData', path.join(out, 'userdata'));
require('../src/main/main.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastState = null;
ipcMain.on('player:event', (_e, m) => { if (m.type === 'state') lastState = m; else log('EVENT', m); });
const wins = () => BrowserWindow.getAllWindows();
const main = () => wins().find((w) => /index\.html$/.test(w.webContents.getURL()));
const byUrl = (re) => wins().find((w) => re.test(w.webContents.getURL()));
async function shot(name, w = main()) { const img = await w.webContents.capturePage(); fs.writeFileSync(path.join(out, name + '.png'), img.toPNG()); log('shot', name); }
const js = (code, w = main()) => w.webContents.executeJavaScript('{' + code + '}', true);
app.on('web-contents-created', (_e, wc) => wc.on('console-message', (ev) => { const m = ev.message || ev; if (ev.level === 'error' || ev.level === 3) log('CONSOLE', String(m).slice(0, 300)); }));
const waitPlaying = async (n = 20) => { for (let i = 0; i < n; i++) { await sleep(1000); if (lastState && lastState.state === 1 && lastState.time > 1 && !lastState.ad) return true; } return false; };
app.whenReady().then(async () => {
  try {
    await sleep(9000);
    await shot('01-home');
    { const { desktopCapturer } = require('electron'); main().show(); main().focus(); await sleep(1500); const src = (await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 1400, height: 900 } })).find((s) => /Kaset/.test(s.name) && !/Video|Mini/.test(s.name)); if (src) fs.writeFileSync(path.join(out, '00-window.png'), src.thumbnail.toPNG()); log('window capture', src ? src.name : 'none'); }
    log('errors in page?', await js(`document.querySelectorAll('.section').length + ' sections'`));
    if (!process.env.SMOKE_QUICK) {
    await js(`document.querySelector('.grid-list .track').click()`);
    log('playing', await waitPlaying(30), lastState);
    await shot('02-playing');
    await js(`document.querySelector('#btn-queue').click()`); await sleep(2500); await shot('03-queue');
    await js(`document.querySelector('#shuffle').click(); document.querySelector('#shuffle').click()`); await sleep(4000);
    log('smart shuffle suggested in queue', await js(`document.querySelectorAll('#panel-body .sugg').length`));
    await shot('04-smart-shuffle');
    await js(`document.querySelector('#btn-lyrics').click()`); await sleep(5000); await shot('05-lyrics');
    const before = lastState && lastState.videoId;
    await js(`document.querySelector('#next').click()`); await sleep(7000);
    log('next: before', before, 'after', lastState && lastState.videoId, 'state', lastState && lastState.state);
    await js(`document.querySelector('#panel-close').click()`);
    }
    await js(`document.querySelector('[data-route="search"]').click()`); await sleep(1500);
    await js(`const i=document.querySelector('#search'); i.value='daft punk'; i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter'}))`); await sleep(5000); await shot('06-search');
    await js(`document.querySelector('.top-card').click()`); await sleep(6000); await shot('07-artist');
    await js(`(() => { const sec=[...document.querySelectorAll('.section')].find(s=>/Albums/.test(s.querySelector('h2')?.innerText||'')); sec.querySelector('.card').click(); })()`); await sleep(5000); await shot('08-album');
    await js(`document.querySelector('[data-hero="play"]').click()`); log('album playing', await waitPlaying(20), lastState && lastState.videoId);
    // EQ on (Bass Booster) and confirm playback continues
    await js(`window.kaset.player('eq', {enabled:true, preset:'Bass Booster', gains:[5,4,3,0,0,0]})`); await sleep(3000);
    const t1 = lastState.time; await sleep(2000);
    log('eq applied; still advancing', lastState.time > t1, 'paused', lastState.paused);
    await js(`document.querySelector('#np-art').click()`); await sleep(4000); await shot('09-nowplaying');
    await js(`document.querySelector('#fs-close').click()`);
    await js(`document.querySelector('[data-route="charts"]').click()`); await sleep(5000); await shot('10-charts');
    await js(`document.querySelector('[data-route="moods"]').click()`); await sleep(5000); await shot('11-moods');
    await js(`document.querySelector('#cmd-btn').click()`); await sleep(500); await js(`const i=document.querySelector('#cmd-q'); i.value='go to'; i.dispatchEvent(new Event('input'))`); await sleep(800); await shot('12-command-bar');
    await js(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))`);
    await js(`document.querySelector('#btn-eq').click()`); await sleep(800); await shot('13-equalizer');
    await js(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))`);
    await js(`window.kaset.setSettings({appearance:'light'}).then(()=>{document.documentElement.dataset.theme='light'})`); await sleep(800); await shot('14-light');
    await js(`window.kaset.setSettings({appearance:'system'}).then(()=>{document.documentElement.dataset.theme='dark'})`);
    await js(`document.querySelector('#btn-mini').click()`); await sleep(3000);
    const mini = byUrl(/mini\.html$/); log('mini open', !!mini); if (mini) await shot('15-mini', mini);
    await js(`document.querySelector('#close').click()`, mini).catch(() => {}); await sleep(1500);
    await js(`document.querySelector('#btn-video').click()`); await sleep(3000);
    const vid = byUrl(/music\.youtube\.com/); if (vid && vid.isVisible()) await shot('16-video', vid);
    await js(`document.querySelector('#btn-video').click()`);
    await js(`document.querySelector('#playpause').click()`); await sleep(1500); log('after pause', lastState && lastState.paused);

    // ---------------- YouTube mode ----------------
    log('toggle click', await js(`const b = document.querySelector('.source-toggle [data-source="youtube"]'); b.click(); document.body.className + ' ' + typeof b.onclick`)); await sleep(9000);
    log('yt mode', await js(`document.body.classList.contains('yt-mode') + ' / sections ' + document.querySelectorAll('#content .section').length + ' / videos ' + document.querySelectorAll('#content .vcard').length`));
    await shot('17-yt-home');
    await js(`document.querySelector('[data-route="yt-explore"]').click()`); await sleep(5000);
    log('yt explore videos', await js(`document.querySelectorAll('#content .vcard').length`));
    await shot('18-yt-explore');
    await js(`document.querySelector('[data-route="yt-subs"]').click()`); await sleep(2500);
    log('yt subscriptions', await js(`document.querySelector('#content .empty h2')?.innerText || (document.querySelectorAll('#content .vcard').length + ' videos')`));
    await shot('19-yt-subscriptions');
    await js(`document.querySelector('[data-route="yt-search"]').click()`); await sleep(1200);
    await js(`const i=document.querySelector('#yt-search'); i.value='veritasium'; i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter'}))`); await sleep(5000);
    log('yt search rows', await js(`document.querySelectorAll('#search-results .vlist-row').length + ' rows, ' + document.querySelectorAll('#search-results .vlist-row.chan').length + ' channels'`));
    await shot('20-yt-search');
    await js(`(document.querySelector('#search-results .vlist-row.chan') || document.querySelector('#search-results [data-ytchannel]')).click()`); await sleep(6000);
    log('yt channel', await js(`(document.querySelector('.yt-channel-head h1')?.innerText || '?') + ' / rails ' + document.querySelectorAll('#content .section').length`));
    await shot('21-yt-channel');
    // play the first video on the channel page
    let ytState = null;
    ipcMain.on('yt:event', (_e, m) => { if (m.type === 'state') ytState = m; });
    const waitYt = async (fn, n = 30) => { for (let i = 0; i < n; i++) { await sleep(1000); if (ytState && fn(ytState)) return true; } return false; };
    await js(`document.querySelector('#content .vcard').click()`);
    log('yt playing', await waitYt((s) => s.state === 1 && !s.ad && s.time > 2, 45), ytState && { videoId: ytState.videoId, time: ytState.time, ad: ytState.ad });
    await sleep(2500);
    await shot('22-yt-watch');
    const ytv = byUrl(/www\.youtube\.com\/watch/);
    log('yt video window visible', !!(ytv && ytv.isVisible()));
    if (ytv) { ytv.webContents.sendInputEvent({ type: 'mouseMove', x: 300, y: 200 }); await sleep(600); await shot('23-yt-video', ytv); }
    // the player bar controls the video
    await js(`document.querySelector('#yt-play').click()`);
    log('yt bar pause -> paused', await waitYt((s) => s.paused, 5));
    const tBefore = ytState.time;
    await js(`document.querySelector('#yt-fwd').click()`); await sleep(1500);
    log('yt bar +10s', Math.round(tBefore), '->', Math.round(ytState.time));
    await js(`document.querySelector('#yt-play').click()`);
    log('yt bar play -> playing', await waitYt((s) => !s.paused, 5));
    log('yt bar', await js(`document.querySelector('#yt-np-title').innerText + ' | ' + document.querySelector('#yt-cur').innerText + ' / ' + document.querySelector('#yt-dur').innerText`));
    await shot('24-yt-playerbar');
    // switch back to Music: video keeps state, music UI returns
    await js(`document.querySelector('.source-toggle [data-source="music"]').click()`); await sleep(2500);
    log('back to music', await js(`!document.body.classList.contains('yt-mode') && getComputedStyle(document.querySelector('#nav')).display !== 'none'`));
    await shot('25-music-again');
    await js(`document.querySelector('.source-toggle [data-source="youtube"]').click()`); await sleep(1500);
    log('youtube history restored', await js(`location.hash || (document.querySelector('.yt-watch') ? 'watch page' : 'other')`));
    await js(`document.querySelector('#yt-play').click()`); await sleep(1000);
  } catch (e) { log('ERROR', e.stack); }
  app.exit(0);
});
