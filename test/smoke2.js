const { app, BrowserWindow, nativeImage } = require('electron');
const fs = require('fs'); const path = require('path');
const out = process.argv[process.argv.length - 1]; fs.mkdirSync(out, { recursive: true });
const log = (...a) => fs.appendFileSync(path.join(out, 'log.txt'), a.map((x) => typeof x === 'string' ? x : JSON.stringify(x)).join(' ') + '\n');
fs.writeFileSync(path.join(out, 'log.txt'), '');
app.setPath('userData', path.join(out, 'userdata'));
require('../src/main/main.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const main = () => BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().startsWith('file:'));
app.whenReady().then(async () => {
  try {
    await sleep(8000);
    fs.writeFileSync(path.join(out, 'home.png'), (await main().webContents.capturePage()).toPNG());
    await main().webContents.executeJavaScript(`document.querySelector('#btn-settings').click()`); await sleep(800);
    fs.writeFileSync(path.join(out, 'settings.png'), (await main().webContents.capturePage()).toPNG());
    await main().webContents.executeJavaScript(`document.querySelector('[data-action="login"]').click()`); await sleep(9000);
    const lw = BrowserWindow.getAllWindows().find((w) => /accounts\.google/.test(w.webContents.getURL()));
    log('login url', lw && lw.webContents.getURL());
    if (lw) { fs.writeFileSync(path.join(out, 'login.png'), (await lw.webContents.capturePage()).toPNG()); log('login text', await lw.webContents.executeJavaScript('document.body.innerText.slice(0,300)')); }
  } catch (e) { log('ERROR', e.stack); }
  app.exit(0);
});
