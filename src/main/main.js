'use strict';
const path = require('path');
const fs = require('fs');
const {
  app, BrowserWindow, ipcMain, session, Tray, Menu, nativeImage, nativeTheme, Notification, shell, net,
} = require('electron');
const innertube = require('./innertube');
const ytInnertube = require('./youtube-innertube');
const P = require('./parse');
const YP = require('./parse-youtube');
const { Presence, bigArtwork } = require('./discord');
const { PartyServer } = require('./party');

const PARTITION = 'persist:kaset';
const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const LOGIN_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0) Gecko/20100101 Firefox/144.0';
const ROOT = path.join(__dirname, '..', '..');
const ICON = path.join(ROOT, 'build', 'icon.png');
const TRAY_ICON = path.join(ROOT, 'build', 'tray.png');
const IS_WIN11 = process.platform === 'win32' && Number((require('os').release().split('.')[2]) || 0) >= 22000;

app.setAppUserModelId('com.sertacozercan.kaset.windows');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

if (!app.requestSingleInstanceLock()) {
  app.quit();
  return;
}

// kaset:// URL scheme (same as Kaset for macOS: kaset://play?v=VIDEO_ID)
if (process.defaultApp && process.argv.length >= 2) {
  app.setAsDefaultProtocolClient('kaset', process.execPath, [path.resolve(process.argv[1])]);
} else {
  app.setAsDefaultProtocolClient('kaset');
}

// ---------- settings ----------
const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');
const DEFAULTS = {
  closeToTray: true, notifications: false, volume: 80, language: 'en', appearance: 'system', launchAtLogin: false,
  autoplay: true, resumeOnLaunch: true, smartShuffleEvery: 3, smartShuffleAhead: 3,
  eq: { enabled: false, preset: 'Flat', gains: [0, 0, 0, 0, 0, 0] },
  discord: { enabled: false, clientId: '', lyrics: true, clearOnPause: true, statusDisplay: 'name' },
  party: { enabled: false, port: 8338, key: null, requireApproval: false, maxPerGuest: 3 },
  windowBounds: null, miniBounds: null, lastQueue: null,
};
let settings = { ...DEFAULTS };
function loadSettings() {
  try { settings = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(settingsPath(), 'utf8')) }; } catch (_) {}
}
let saveTimer = null;
function saveSettings() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2)); } catch (_) {}
  }, 300);
}

// ---------- state ----------
let mainWin = null;
let playerWin = null;
let loginWin = null;
let miniWin = null;
let tray = null;
let quitting = false;
let ses = null;
let nowPlaying = null;
let isPlaying = false;
let party = null; // Listening Party web server (src/main/party.js)
let presence = null; // Discord Rich Presence (src/main/discord.js)
const sourcePlaying = { music: false, youtube: false };
let rendererReady = false;
const pendingUrls = [];

function send(channel, payload) {
  if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send(channel, payload);
}
function sendMini(channel, payload) {
  if (miniWin && !miniWin.isDestroyed()) miniWin.webContents.send(channel, payload);
}

function isDark() {
  return settings.appearance === 'dark' || (settings.appearance !== 'light' && nativeTheme.shouldUseDarkColors);
}
function overlayColors() {
  return { color: '#00000000', symbolColor: isDark() ? '#f5f5f7' : '#1d1d1f', height: 52 };
}

// ---------- windows ----------
function glassWindowOptions() {
  // Windows 11: real Acrylic material behind translucent surfaces (the Windows
  // counterpart of Liquid Glass). Older Windows falls back to an opaque window.
  return IS_WIN11
    ? { backgroundMaterial: 'acrylic', backgroundColor: '#00000000' }
    : { backgroundColor: isDark() ? '#1c1c1f' : '#f4f4f6' };
}

function createMainWindow({ hidden = false } = {}) {
  const b = settings.windowBounds || {};
  mainWin = new BrowserWindow({
    width: b.width || 1320,
    height: b.height || 860,
    x: b.x,
    y: b.y,
    minWidth: 940,
    minHeight: 620,
    title: 'Kaset',
    icon: ICON,
    titleBarStyle: 'hidden',
    titleBarOverlay: overlayColors(),
    show: false,
    ...glassWindowOptions(),
    webPreferences: {
      preload: path.join(__dirname, 'app-preload.js'),
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  if (b.maximized) mainWin.maximize();
  mainWin.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  mainWin.once('ready-to-show', () => { if (!hidden) mainWin.show(); });
  mainWin.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWin.webContents.on('will-navigate', (e) => e.preventDefault());
  const persistBounds = () => {
    if (!mainWin || mainWin.isDestroyed() || mainWin.isFullScreen()) return;
    settings.windowBounds = { ...mainWin.getNormalBounds(), maximized: mainWin.isMaximized() };
    saveSettings();
  };
  mainWin.on('resize', persistBounds);
  mainWin.on('move', persistBounds);
  mainWin.on('close', (e) => {
    if (!quitting && settings.closeToTray) {
      e.preventDefault();
      mainWin.hide();
    }
  });
  mainWin.on('closed', () => {
    mainWin = null;
    rendererReady = false;
    if (!settings.closeToTray) { quitting = true; app.quit(); }
  });
  mainWin.on('show', updateThumbar);
}

const VIDEO_CSS = `
  html, body { overflow: hidden !important; background: #000 !important; }
  ytmusic-player-page, ytmusic-player, #player, #song-video, #song-media-window {
    position: fixed !important; inset: 0 !important; width: 100vw !important; height: 100vh !important;
    transform: none !important; visibility: visible !important; display: block !important; z-index: 99998 !important;
    max-width: none !important; max-height: none !important; padding: 0 !important; margin: 0 !important; background: #000 !important;
  }
  #movie_player { position: fixed !important; inset: 0 !important; width: 100vw !important; height: 100vh !important; z-index: 99999 !important; }
  #movie_player video { width: 100vw !important; height: 100vh !important; left: 0 !important; top: 0 !important; object-fit: contain !important; }
  ytmusic-nav-bar, ytmusic-player-bar, #side-panel, .song-media-controls, tp-yt-paper-dialog { display: none !important; }`;
let videoCssKey = null;

function createPlayerWindow() {
  playerWin = new BrowserWindow({
    show: false,
    width: 960,
    height: 560,
    title: 'Kaset — Video',
    icon: ICON,
    autoHideMenuBar: true,
    backgroundColor: '#000000',
    webPreferences: {
      session: ses,
      preload: path.join(__dirname, 'player-preload.js'),
      contextIsolation: true,
      sandbox: false,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });
  playerWin.loadURL('https://music.youtube.com/');
  playerWin.on('close', (e) => {
    if (!quitting) { e.preventDefault(); showVideo(false); }
  });
  playerWin.webContents.on('did-finish-load', () => {
    videoCssKey = null;
    if (settings.eq?.enabled) playerExec(`window.__kaset && window.__kaset.eq(${JSON.stringify(settings.eq)})`);
  });
  playerWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
}

async function showVideo(show) {
  if (!playerWin || playerWin.isDestroyed()) return;
  if (show) {
    if (!videoCssKey) videoCssKey = await playerWin.webContents.insertCSS(VIDEO_CSS);
    playerWin.setTitle(nowPlaying ? `${nowPlaying.title} — ${nowPlaying.artist}` : 'Kaset — Video');
    playerWin.show();
    playerWin.focus();
  } else {
    playerWin.hide();
    if (videoCssKey) { playerWin.webContents.removeInsertedCSS(videoCssKey).catch(() => {}); videoCssKey = null; }
  }
  send('video:visible', show);
}

// ---------- YouTube mode video window ----------
// Regular YouTube videos play in their own www.youtube.com watch page (DRM,
// captions and quality come from YouTube's own player), shown as Kaset's
// video window with everything but the video stripped away and Kaset's own
// hover controls drawn on top by player-preload.js. Created on first use.
const YT_VIDEO_CSS = `
  html, body, ytd-app { overflow: hidden !important; background: #000 !important; }
  #masthead-container, ytd-masthead, tp-yt-app-drawer, #guide, #secondary, #below, #chat, #chat-container,
  ytd-popup-container tp-yt-paper-dialog, ytd-miniplayer, #panels, ytd-engagement-panel-section-list-renderer,
  .ytp-chrome-top, .ytp-chrome-bottom, .ytp-gradient-top, .ytp-gradient-bottom, .ytp-pause-overlay, .ytp-ce-element,
  .ytp-endscreen-content, .ytp-watermark, .ytp-paid-content-overlay, .ytp-cards-teaser, .ytp-suggested-action,
  .ytp-autonav-endscreen-countdown-overlay, .ytp-fullerscreen-edu-button, .ytp-contextmenu, .ytp-tooltip { display: none !important; }
  #movie_player { position: fixed !important; inset: 0 !important; width: 100vw !important; height: 100vh !important; z-index: 2147483000 !important; background: #000 !important; }
  #movie_player .html5-video-container { width: 100% !important; height: 100% !important; }
  #movie_player video.html5-main-video { width: 100vw !important; height: 100vh !important; left: 0 !important; top: 0 !important; object-fit: contain !important; }
  .ytp-caption-window-bottom { margin-bottom: 56px !important; }
  /* Kaset hover controls (built by player-preload.js) */
  #kaset-ov { position: fixed; left: 50%; bottom: 14px; transform: translateX(-50%); width: min(760px, calc(100vw - 28px)); z-index: 2147483647;
    display: flex; align-items: center; gap: 6px; padding: 7px 12px; border-radius: 22px; color: #f5f5f7;
    font: 12px/1 "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif; font-variant-numeric: tabular-nums;
    background: rgba(28, 28, 32, .62); backdrop-filter: blur(24px) saturate(180%); -webkit-backdrop-filter: blur(24px) saturate(180%);
    border: 1px solid rgba(255,255,255,.14); box-shadow: 0 10px 34px rgba(0,0,0,.45), inset 0 1px 0 rgba(255,255,255,.12);
    transition: opacity .25s ease, transform .25s ease; }
  html.kaset-idle #kaset-ov { opacity: 0; transform: translate(-50%, 8px); pointer-events: none; }
  html.kaset-idle, html.kaset-idle * { cursor: none !important; }
  #kaset-ov button { all: unset; width: 30px; height: 30px; display: grid; place-items: center; border-radius: 50%; cursor: pointer; color: inherit; flex: none; }
  #kaset-ov button:hover { background: rgba(255,255,255,.14); }
  #kaset-ov button.on { color: #ff375f; }
  #kaset-ov button.big { width: 36px; height: 36px; }
  #kaset-ov svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
  #kaset-ov svg.kf { fill: currentColor; stroke: none; }
  #kaset-ov .big svg { width: 22px; height: 22px; }
  #kaset-ov .time { opacity: .8; min-width: 42px; text-align: center; }
  #kaset-ov .lane { flex: 1; height: 18px; display: flex; align-items: center; cursor: pointer; position: relative; }
  #kaset-ov .lane::before { content: ""; position: absolute; left: 0; right: 0; height: 4px; border-radius: 2px; background: rgba(255,255,255,.22); }
  #kaset-ov .fill { position: absolute; left: 0; height: 4px; border-radius: 2px; background: #fff; }
  #kaset-ov .knob { position: absolute; width: 12px; height: 12px; margin-left: -6px; border-radius: 50%; background: #fff; box-shadow: 0 1px 4px rgba(0,0,0,.4); opacity: 0; transition: opacity .15s; }
  #kaset-ov .lane:hover .knob { opacity: 1; }
  #kaset-ov.ad .lane { pointer-events: none; opacity: .5; }
  #kaset-ov .adtag { display: none; background: #f5c400; color: #000; border-radius: 4px; padding: 3px 5px; font-weight: 600; }
  #kaset-ov.ad .adtag { display: inline-block; }`;

let ytWin = null;
let ytCurrent = null;   // { videoId, title, channel } of the loaded video

function ytExec(code) {
  if (!ytWin || ytWin.isDestroyed()) return Promise.resolve(null);
  return ytWin.webContents.executeJavaScript(code, true).catch(() => null);
}

async function waitYtReady(timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await ytExec('window.__kaset && window.__kaset.ready()')) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

function ytTitle() {
  return ytCurrent ? `${ytCurrent.title}${ytCurrent.channel ? ' — ' + ytCurrent.channel : ''}` : 'Kaset — Video';
}

function ensureYtWindow() {
  if (ytWin && !ytWin.isDestroyed()) return ytWin;
  ytWin = new BrowserWindow({
    show: false,
    width: 960,
    height: 540,
    useContentSize: true,
    minWidth: 400,
    minHeight: 225,
    title: 'Kaset — Video',
    icon: ICON,
    autoHideMenuBar: true,
    backgroundColor: '#000000',
    webPreferences: {
      session: ses,
      preload: path.join(__dirname, 'player-preload.js'),
      contextIsolation: true,
      sandbox: false,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });
  ytWin.on('page-title-updated', (e) => { e.preventDefault(); ytWin.setTitle(ytTitle()); });
  ytWin.webContents.on('dom-ready', () => { ytWin.webContents.insertCSS(YT_VIDEO_CSS).catch(() => {}); });
  // Closing the video window stops playback (as Kaset's YouTube pop-out does).
  ytWin.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    if (ytWin.isFullScreen()) ytWin.setFullScreen(false);
    ytWin.hide();
    ytExec('window.__kaset.pause()');
    send('yt:visible', false);
  });
  ytWin.on('enter-full-screen', () => send('yt:fullscreen', true));
  ytWin.on('leave-full-screen', () => send('yt:fullscreen', false));
  ytWin.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  // Stay on watch pages; anything else (channel links, end screens) opens in the app instead.
  ytWin.webContents.on('will-navigate', (e, url) => {
    if (!/^https:\/\/www\.youtube\.com\/watch\?/.test(url)) e.preventDefault();
  });
  return ytWin;
}

function showYtWindow(show) {
  if (!show) {
    if (ytWin && !ytWin.isDestroyed()) { if (ytWin.isFullScreen()) ytWin.setFullScreen(false); ytWin.hide(); }
    send('yt:visible', false);
    return false;
  }
  ensureYtWindow();
  ytWin.setTitle(ytTitle());
  ytWin.show();
  send('yt:visible', true);
  return true;
}

async function ytLoad({ videoId, start = 0, title, channel, show }) {
  ensureYtWindow();
  ytCurrent = { videoId, title: title || '', channel: channel || '' };
  ytWin.setTitle(ytTitle());
  // Only one audio source at a time: starting a video pauses music.
  playerExec('window.__kaset && window.__kaset.pause()');
  const url = ytWin.webContents.getURL();
  let r = null;
  if (/^https:\/\/www\.youtube\.com\/watch/.test(url) && await waitYtReady(3000)) {
    r = await ytExec(`window.__kaset.load(${JSON.stringify(videoId)}, ${Number(start) || 0})`);
  }
  if (r !== 'loaded') {
    await ytWin.loadURL(`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}${start ? `&t=${Math.floor(start)}s` : ''}`).catch(() => {});
    await waitYtReady();
    r = await ytExec(`window.__kaset.adopt(${JSON.stringify(videoId)}, ${Number(start) || 0})`);
  }
  await ytExec(`window.__kaset.volume(${Number(settings.volume)})`);
  if (show) showYtWindow(true);
  return r;
}

function createMiniWindow() {
  if (miniWin && !miniWin.isDestroyed()) { miniWin.show(); miniWin.focus(); return; }
  const b = settings.miniBounds || {};
  miniWin = new BrowserWindow({
    width: b.width || 320,
    height: b.height || 320,
    x: b.x,
    y: b.y,
    minWidth: 240,
    minHeight: 240,
    frame: false,
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: false,
    title: 'Kaset Mini Player',
    icon: ICON,
    roundedCorners: true,
    show: false,
    ...(IS_WIN11 ? { backgroundMaterial: 'acrylic', backgroundColor: '#00000000' } : { backgroundColor: '#1c1c1f' }),
    webPreferences: { preload: path.join(__dirname, 'app-preload.js'), contextIsolation: true, sandbox: true, backgroundThrottling: false },
  });
  miniWin.setAspectRatio(1);
  miniWin.loadFile(path.join(__dirname, '..', 'renderer', 'mini.html'));
  miniWin.once('ready-to-show', () => {
    miniWin.show();
    if (nowPlaying) sendMini('meta', nowPlaying);
    send('command', 'syncMini');
  });
  const persist = () => { if (miniWin && !miniWin.isDestroyed()) { settings.miniBounds = miniWin.getBounds(); saveSettings(); } };
  miniWin.on('resize', persist);
  miniWin.on('move', persist);
  miniWin.on('closed', () => { miniWin = null; });
  if (mainWin && settings.miniHidesMain !== false) mainWin.hide();
}

async function playerExec(code) {
  if (!playerWin || playerWin.isDestroyed()) return null;
  try {
    return await playerWin.webContents.executeJavaScript(code, true);
  } catch (e) {
    return null;
  }
}

async function waitPlayerReady(timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ok = await playerExec('window.__kaset && window.__kaset.ready()');
    if (ok) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

// ---------- tray / taskbar ----------
const glyphCache = {};
function updateThumbar() {
  if (!mainWin || mainWin.isDestroyed() || process.platform !== 'win32' || !glyphCache.play) return;
  try {
    mainWin.setThumbarButtons([
      { tooltip: 'Previous', icon: glyphCache.prev, click: () => send('command', 'previous') },
      { tooltip: isPlaying ? 'Pause' : 'Play', icon: isPlaying ? glyphCache.pause : glyphCache.play, click: () => send('command', 'playPause') },
      { tooltip: 'Next', icon: glyphCache.next, click: () => send('command', 'next') },
    ]);
  } catch (_) {}
}

function renderGlyphs() {
  // Monochrome 20px glyphs for taskbar thumbnail buttons, drawn directly into a bitmap.
  const S = 20;
  const shapes = {
    play: (x, y) => x >= 5 && x <= 16 && Math.abs(y - 10) <= (x - 5) * -0.58 + 7.2,
    pause: (x, y) => y >= 3 && y <= 17 && ((x >= 4 && x <= 8) || (x >= 12 && x <= 16)),
    next: (x, y) => (y >= 3 && y <= 17 && x >= 14 && x <= 16) || (x >= 3 && x <= 13 && Math.abs(y - 10) <= (x - 3) * -0.65 + 7),
    prev: (x, y) => (y >= 3 && y <= 17 && x >= 4 && x <= 6) || (x >= 7 && x <= 17 && Math.abs(y - 10) <= (17 - x) * -0.65 + 7),
  };
  for (const [k, fn] of Object.entries(shapes)) {
    const buf = Buffer.alloc(S * S * 4);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      let n = 0;
      for (const [dx, dy] of [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]]) if (fn(x + dx, y + dy)) n++;
      const a = Math.round((n / 4) * 255);
      const i = (y * S + x) * 4;
      buf[i] = a; buf[i + 1] = a; buf[i + 2] = a; buf[i + 3] = a; // premultiplied white (BGRA)
    }
    glyphCache[k] = nativeImage.createFromBitmap(buf, { width: S, height: S });
  }
  updateThumbar();
}

function buildTray() {
  tray = new Tray(nativeImage.createFromPath(TRAY_ICON).resize({ width: 16, height: 16, quality: 'best' }));
  tray.setToolTip('Kaset');
  tray.on('click', showMain);
  refreshTrayMenu();
}

function refreshTrayMenu() {
  if (!tray) return;
  const np = nowPlaying ? `${nowPlaying.title} — ${nowPlaying.artist}` : 'Not Playing';
  tray.setToolTip(nowPlaying ? `${np}`.slice(0, 127) : 'Kaset');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: np.length > 60 ? np.slice(0, 57) + '…' : np, enabled: false },
    { type: 'separator' },
    { label: isPlaying ? 'Pause' : 'Play', click: () => send('command', 'playPause') },
    { label: 'Next', click: () => send('command', 'next') },
    { label: 'Previous', click: () => send('command', 'previous') },
    { type: 'separator' },
    { label: nowPlaying?.like === 'LIKE' ? 'Unlike' : 'Like', enabled: !!nowPlaying, click: () => send('command', 'like') },
    { label: 'Mini Player', click: createMiniWindow },
    { label: 'Show Kaset', click: showMain },
    { type: 'separator' },
    { label: 'Quit Kaset', click: () => { quitting = true; app.quit(); } },
  ]));
}

function showMain() {
  if (!mainWin) createMainWindow();
  if (mainWin.isMinimized()) mainWin.restore();
  mainWin.show();
  mainWin.focus();
}

function setJumpList() {
  if (process.platform !== 'win32') return;
  const task = (title, arg) => ({ program: process.execPath, arguments: (process.defaultApp ? `"${path.resolve(process.argv[1])}" ` : '') + arg, iconPath: process.execPath, iconIndex: 0, title, description: title });
  try {
    app.setUserTasks([
      task('Play / Pause', '--command=playPause'),
      task('Next Track', '--command=next'),
      task('Previous Track', '--command=previous'),
      task('Mini Player', '--command=mini'),
    ]);
  } catch (_) {}
}

function handleArgv(argv) {
  for (const a of argv) {
    if (a.startsWith('--command=')) {
      const cmd = a.slice(10);
      if (cmd === 'mini') createMiniWindow();
      else send('command', cmd);
    } else if (/^kaset:\/\//i.test(a) || /^https:\/\/(music\.youtube\.com|www\.youtube\.com|youtu\.be)\//i.test(a)) {
      openUrl(a);
    }
  }
}
function openUrl(url) {
  if (rendererReady) { send('open-url', url); showMain(); } else pendingUrls.push(url);
}

// ---------- login ----------
function openLogin() {
  if (loginWin && !loginWin.isDestroyed()) { loginWin.focus(); return; }
  loginWin = new BrowserWindow({
    width: 480,
    height: 720,
    parent: mainWin || undefined,
    title: 'Sign in to YouTube Music',
    icon: ICON,
    autoHideMenuBar: true,
    webPreferences: { session: ses, contextIsolation: true, sandbox: true },
  });
  loginWin.webContents.setUserAgent(LOGIN_UA);
  loginWin.loadURL('https://accounts.google.com/ServiceLogin?ltmpl=music&service=youtube&passive=true&continue=' +
    encodeURIComponent('https://www.youtube.com/signin?action_handle_signin=true&next=https%3A%2F%2Fmusic.youtube.com%2F'));
  const check = async (_e, url) => {
    if (!url.startsWith('https://music.youtube.com')) return;
    const cookies = await ses.cookies.get({ url: 'https://music.youtube.com', name: 'SAPISID' });
    if (cookies.length) {
      loginWin.close();
      onAuthChanged();
    }
  };
  loginWin.webContents.on('did-navigate', check);
  loginWin.on('closed', () => { loginWin = null; });
}

async function signOut() {
  await ses.clearStorageData({ storages: ['cookies', 'localstorage', 'indexdb', 'serviceworkers', 'cachestorage'] });
  onAuthChanged();
}

function onAuthChanged() {
  innertube.reset();
  ytInnertube.reset();
  if (playerWin && !playerWin.isDestroyed()) playerWin.loadURL('https://music.youtube.com/');
  send('auth:changed', true);
}

// ---------- updates ----------
let updater = null;
function initUpdater() {
  if (!app.isPackaged) return;
  try {
    updater = require('electron-updater').autoUpdater;
    updater.autoDownload = true;
    updater.autoInstallOnAppQuit = true;
    updater.on('update-downloaded', (info) => {
      if (Notification.isSupported()) new Notification({ title: 'Kaset update ready', body: `Version ${info.version} will be installed when you quit Kaset.`, icon: ICON }).show();
    });
    updater.on('error', () => {});
    setTimeout(() => updater.checkForUpdates().catch(() => {}), 15000);
    setInterval(() => updater.checkForUpdates().catch(() => {}), 6 * 3600e3);
  } catch (_) { updater = null; }
}
async function checkUpdatesNow() {
  if (!updater) return app.isPackaged ? 'Updates are unavailable.' : 'Updates are only checked in installed builds.';
  try {
    const r = await updater.checkForUpdates();
    const v = r?.updateInfo?.version;
    if (v && v !== app.getVersion()) return `Downloading Kaset ${v}… it will install when you quit.`;
    return `You're up to date (${app.getVersion()}).`;
  } catch (e) {
    return "Couldn't check for updates right now.";
  }
}

// ---------- API ----------
const hl = () => settings.language;
const api = {
  async browse({ browseId, params }) {
    const res = await innertube.request(ses, 'browse', params ? { browseId, params } : { browseId }, { hl: hl() });
    return P.parseBrowse(res);
  },
  async continuation({ token, endpoint = 'browse' }) {
    const res = await innertube.request(ses, endpoint, { continuation: token }, { hl: hl() });
    return P.parseContinuation(res);
  },
  async search({ query, params }) {
    const body = { query };
    if (params) body.params = params;
    return P.parseSearch(await innertube.request(ses, 'search', body, { hl: hl() }));
  },
  async suggestions({ input }) {
    return P.parseSuggestions(await innertube.request(ses, 'music/get_search_suggestions', { input }, { hl: hl() }));
  },
  async next({ videoId, playlistId, params, continuation }) {
    const body = { enablePersistentPlaylistPanel: true, isAudioOnly: true, tunerSettingValue: 'AUTOMIX_SETTING_NORMAL' };
    if (continuation) body.continuation = continuation;
    if (videoId) body.videoId = videoId;
    if (playlistId) body.playlistId = playlistId;
    if (params) body.params = params;
    return P.parseNext(await innertube.request(ses, 'next', body, { hl: hl() }));
  },
  async lyrics({ videoId, title, artist, album, duration }) {
    const out = { synced: null, plain: null, source: '' };
    // Same provider order as Kaset: LRCLIB synced lyrics, then YouTube Music's own lyrics.
    const UA = { 'User-Agent': `Kaset-Windows/${app.getVersion()} (https://github.com/sozercan/kaset)` };
    try {
      const q = new URLSearchParams({ track_name: title || '', artist_name: artist || '' });
      if (album) q.set('album_name', album);
      if (duration) q.set('duration', String(Math.round(duration)));
      let r = await net.fetch('https://lrclib.net/api/get?' + q, { headers: UA });
      let j = r.ok ? await r.json() : null;
      if (!j || (!j.syncedLyrics && !j.plainLyrics)) {
        r = await net.fetch('https://lrclib.net/api/search?' + new URLSearchParams({ track_name: title || '', artist_name: artist || '' }), { headers: UA });
        const list = r.ok ? await r.json() : [];
        j = (list || []).find((x) => x.syncedLyrics && (!duration || Math.abs(x.duration - duration) < 4)) || (list || []).find((x) => x.syncedLyrics) || (list || [])[0] || null;
      }
      if (j?.syncedLyrics) { out.synced = j.syncedLyrics; out.source = 'LRCLIB'; }
      if (j?.plainLyrics) { out.plain = j.plainLyrics; out.source = 'LRCLIB'; }
    } catch (_) {}
    if (!out.synced && videoId) {
      try {
        const n = await api.next({ videoId });
        if (n.lyricsBrowseId) {
          const l = P.parseLyrics(await innertube.request(ses, 'browse', { browseId: n.lyricsBrowseId }, { hl: hl() }));
          if (l) { out.plain = l.text; out.source = l.source || 'YouTube Music'; }
        }
      } catch (_) {}
    }
    return out;
  },
  async rate({ videoId, playlistId, status }) {
    const ep = status === 'LIKE' ? 'like/like' : status === 'DISLIKE' ? 'like/dislike' : 'like/removelike';
    await innertube.request(ses, ep, { target: videoId ? { videoId } : { playlistId } });
    return true;
  },
  async likeStatus({ videoId }) {
    return (await api.next({ videoId })).likeStatus || 'INDIFFERENT';
  },
  async account() {
    const cookies = await ses.cookies.get({ url: 'https://music.youtube.com', name: 'SAPISID' });
    if (!cookies.length) return null;
    try {
      return P.parseAccount(await innertube.request(ses, 'account/account_menu', {})) || { name: 'Signed in' };
    } catch (_) {
      return { name: 'Signed in' };
    }
  },
  async subscribe({ channelId, subscribe }) {
    await innertube.request(ses, subscribe ? 'subscription/subscribe' : 'subscription/unsubscribe', { channelIds: [channelId] });
    return true;
  },
  async addToPlaylist({ playlistId, videoIds, videoId }) {
    const ids = videoIds || [videoId];
    await innertube.request(ses, 'browse/edit_playlist', {
      playlistId: playlistId.replace(/^VL/, ''),
      actions: ids.map((id) => ({ action: 'ACTION_ADD_VIDEO', addedVideoId: id, dedupeOption: 'DEDUPE_OPTION_SKIP' })),
    });
    return true;
  },
  async removeFromPlaylist({ playlistId, videoId, setVideoId }) {
    await innertube.request(ses, 'browse/edit_playlist', {
      playlistId: playlistId.replace(/^VL/, ''),
      actions: [{ action: 'ACTION_REMOVE_VIDEO', removedVideoId: videoId, setVideoId }],
    });
    return true;
  },
  async createPlaylist({ title, description, privacyStatus, videoIds }) {
    const body = { title, description: description || '', privacyStatus: privacyStatus || 'PRIVATE' };
    if (videoIds?.length) body.videoIds = videoIds;
    const res = await innertube.request(ses, 'playlist/create', body);
    return res.playlistId;
  },
  async deletePlaylist({ playlistId }) {
    await innertube.request(ses, 'playlist/delete', { playlistId: playlistId.replace(/^VL/, '') });
    return true;
  },
  async libraryPlaylists() {
    const b = await api.browse({ browseId: 'FEmusic_liked_playlists' });
    return b.sections.flatMap((s) => s.items).filter((i) => i.kind === 'playlist' && i.browseId && !['VLLM', 'VLSE'].includes(i.browseId));
  },

  // ---------- YouTube mode (WEB client on www.youtube.com) ----------
  async ytHome() {
    const feed = YP.parseFeed(await yt('browse', { browseId: 'FEwhat_to_watch' }));
    // Topic rails from the home chip bar (as Kaset does), loaded alongside.
    const rails = await Promise.all(feed.chips.slice(0, 4).map(async (c) => {
      try {
        const r = YP.parseContinuation(await yt('browse', { continuation: c.token }));
        const items = r.items.concat(...r.sections.map((s) => s.items)).filter((i) => i.kind === 'ytvideo' && !i.short);
        return items.length ? { title: c.title, items: items.slice(0, 16) } : null;
      } catch (_) { return null; }
    }));
    feed.sections = [...feed.sections, ...rails.filter(Boolean)];
    if (feed.items.length || feed.sections.length) return { ...feed, personalized: true };
    // Signed out (or no watch history) the home feed is only a "Try searching"
    // nudge. Build Home from YouTube's public destination feeds instead.
    const DEST = [['Live', 'FElive_destination'], ['Gaming', 'FEgaming_destination'], ['News', 'FEnews_destination'], ['Sports', 'FEsports_destination'], ['Learning', 'FElearning_destination']];
    const sections = await Promise.all(DEST.map(async ([title, browseId]) => {
      try {
        const f = YP.parseFeed(await yt('browse', { browseId }));
        const seen = new Set();
        const items = f.items.concat(...f.sections.map((s) => s.items))
          .filter((i) => i.kind === 'ytvideo' && !i.short && !seen.has(i.videoId) && seen.add(i.videoId));
        return items.length ? { title, items: items.slice(0, 16), explore: browseId } : null;
      } catch (_) { return null; }
    }));
    return { sections: sections.filter(Boolean), items: [], continuation: null, message: feed.message, personalized: false };
  },
  async ytBrowse({ browseId, params }) {
    return YP.parseFeed(await yt('browse', params ? { browseId, params } : { browseId }));
  },
  async ytContinuation({ token, kind }) {
    if (kind === 'search') return YP.parseSearchContinuation(await yt('search', { continuation: token }));
    if (kind === 'related') return YP.parseContinuation(await yt('next', { continuation: token }));
    return YP.parseContinuation(await yt('browse', { continuation: token }));
  },
  async ytSearch({ query, params }) {
    return YP.parseSearch(await yt('search', params ? { query, params } : { query }));
  },
  async ytSuggestions({ input }) {
    // YouTube's public suggestion endpoint (same one www.youtube.com's search box uses).
    const r = await net.fetch('https://suggestqueries-clients6.youtube.com/complete/search?' + new URLSearchParams({ client: 'youtube', ds: 'yt', hl: hl(), q: input }));
    const t = await r.text();
    const m = t.match(/\(([\s\S]*)\)\s*$/);
    const j = m ? JSON.parse(m[1]) : [];
    return (j[1] || []).map((x) => x[0]).filter(Boolean).slice(0, 8);
  },
  async ytChannel({ channelId, params }) {
    return YP.parseChannel(await yt('browse', params ? { browseId: channelId, params } : { browseId: channelId }), channelId);
  },
  async ytPlaylist({ playlistId }) {
    const id = playlistId.startsWith('VL') ? playlistId : 'VL' + playlistId;
    return YP.parsePlaylist(await yt('browse', { browseId: id }));
  },
  async ytPlaylists() {
    const f = YP.parseFeed(await yt('browse', { browseId: 'FEplaylist_aggregation' }));
    return { items: f.items.concat(...f.sections.map((s) => s.items)).filter((i) => i.kind === 'ytplaylist'), message: f.message };
  },
  async ytSubscriptions() {
    const [feed, guide] = await Promise.all([
      api.ytBrowse({ browseId: 'FEsubscriptions' }),
      yt('guide', {}).then(YP.parseGuideSubscriptions).catch(() => []),
    ]);
    return { ...feed, channels: guide };
  },
  async ytGuideSubscriptions() {
    return YP.parseGuideSubscriptions(await yt('guide', {}));
  },
  async ytWatch({ videoId }) {
    return YP.parseWatch(await yt('next', { videoId }));
  },
  async ytRate({ videoId, status }) {
    const ep = status === 'LIKE' ? 'like/like' : status === 'DISLIKE' ? 'like/dislike' : 'like/removelike';
    await yt(ep, { target: { videoId } });
    return true;
  },
  async ytSubscribe({ channelId, subscribe }) {
    await yt(subscribe ? 'subscription/subscribe' : 'subscription/unsubscribe', { channelIds: [channelId] });
    return true;
  },
  async ytWatchLater({ videoId, add }) {
    await yt('browse/edit_playlist', {
      playlistId: 'WL',
      actions: [add ? { action: 'ACTION_ADD_VIDEO', addedVideoId: videoId } : { action: 'ACTION_REMOVE_VIDEO_BY_VIDEO_ID', removedVideoId: videoId }],
    });
    return true;
  },
};
const yt = (endpoint, body) => ytInnertube.request(ses, endpoint, body, { hl: hl() });

// ---------- Listening Party (guests add songs from their phones) ----------
const SONGS_FILTER = 'EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D';
const smallThumb = (u) => (u || '').replace(/=w\d+-h\d+[^&]*$/, '=w226-h226-l90-rj');
const partySong = (it) => ({
  kind: 'song', videoId: it.videoId, title: it.title, artist: (it.artists || []).map((a) => a.name).filter(Boolean).join(', ') || (it.subtitle || '').split(' • ')[0],
  artists: it.artists || [], album: it.album || null, thumb: smallThumb(it.thumb), duration: it.duration || 0, durationText: it.durationText || '', subtitle: it.subtitle || '',
});
function createParty() {
  party = new PartyServer({
    searchSongs: async (q) => {
      const r = await api.search({ query: q, params: SONGS_FILTER });
      const seen = new Set();
      return r.sections.flatMap((s) => s.items).filter((i) => i.videoId && !i.unavailable && !seen.has(i.videoId) && seen.add(i.videoId)).slice(0, 25).map(partySong);
    },
    suggest: async (q) => (await api.suggestions({ input: q })).queries,
    lookup: async (videoId) => {
      const n = await api.next({ videoId });
      const it = n.items.find((x) => x.videoId === videoId);
      return it ? partySong(it) : null;
    },
    onRequest: (req) => send('party:request', req),
    onStatus: () => { partyStatus().then((s) => send('party:status', s)).catch(() => {}); },
  });
}
async function partyStatus() {
  const s = party.status();
  const QR = require('qrcode');
  s.urls = await Promise.all(s.urls.map(async (u) => ({ ...u, qr: await QR.toDataURL(u.url, { margin: 1, width: 360, color: { dark: '#111111', light: '#ffffff' } }) })));
  s.settings = settings.party;
  return s;
}
async function applyParty() {
  const p = settings.party;
  party.configure({ requireApproval: !!p.requireApproval, maxPerGuest: Number(p.maxPerGuest) || 0 });
  if (p.enabled) {
    await party.start({ port: Math.min(65535, Math.max(1024, Number(p.port) || 8338)), key: p.key });
    if (party.key !== p.key) { settings.party = { ...p, key: party.key }; saveSettings(); }
  } else {
    await party.stop();
  }
  return partyStatus();
}

// ---------- IPC ----------
function registerIpc() {
  ipcMain.handle('party', async (_e, cmd, arg) => {
    switch (cmd) {
      case 'status': return partyStatus();
      case 'set':
        settings.party = { ...settings.party, ...arg };
        saveSettings();
        return applyParty();
      case 'rotate':
        settings.party = { ...settings.party, key: party.rotateKey() };
        saveSettings();
        return partyStatus();
      case 'snapshot':
        party.options.hostName = String(arg.hostName || '').slice(0, 40);
        return party.setSnapshot({ nowPlaying: arg.nowPlaying, upNext: arg.upNext });
      case 'resolve': return party.resolveRequest(arg.requestId, !!arg.approved);
      default: return null;
    }
  });
  ipcMain.handle('api', async (_e, method, args) => {
    if (!Object.prototype.hasOwnProperty.call(api, method)) throw new Error('Unknown API method ' + method);
    try {
      return { ok: true, data: await api[method](args || {}) };
    } catch (e) {
      return { ok: false, error: e.message, code: e.code };
    }
  });

  ipcMain.handle('player', async (e, cmd, arg) => {
    switch (cmd) {
      case 'load': {
        ytExec('window.__kaset && window.__kaset.pause()'); // one audio source at a time
        await waitPlayerReady();
        let r = await playerExec(`window.__kaset.load(${JSON.stringify(arg.videoId)}, ${Number(arg.start) || 0})`);
        if (r !== 'loaded') {
          await playerWin.loadURL('https://music.youtube.com/watch?v=' + encodeURIComponent(arg.videoId));
          await waitPlayerReady();
          r = await playerExec(`window.__kaset.load(${JSON.stringify(arg.videoId)}, ${Number(arg.start) || 0})`);
        }
        await playerExec(`window.__kaset.volume(${Number(settings.volume)})`);
        return r;
      }
      case 'play': ytExec('window.__kaset && window.__kaset.pause()'); return playerExec('window.__kaset.play()');
      case 'pause': return playerExec('window.__kaset.pause()');
      case 'stop': return playerExec('window.__kaset.stop()');
      case 'seek': return playerExec(`window.__kaset.seek(${Number(arg) || 0})`);
      case 'volume':
        settings.volume = Math.max(0, Math.min(100, Number(arg) || 0));
        saveSettings();
        ytExec(`window.__kaset && window.__kaset.volume(${settings.volume})`);
        return playerExec(`window.__kaset.volume(${settings.volume})`);
      case 'eq':
        settings.eq = arg;
        saveSettings();
        return playerExec(`window.__kaset.eq(${JSON.stringify(arg)})`);
      case 'meta': {
        const changedTrack = !nowPlaying || !arg || nowPlaying.videoId !== arg.videoId;
        nowPlaying = arg;
        refreshTrayMenu();
        sendMini('meta', arg);
        if (mainWin) mainWin.setTitle(arg ? `${arg.title} — ${arg.artist}` : 'Kaset');
        if (playerWin && playerWin.isVisible() && arg) playerWin.setTitle(`${arg.title} — ${arg.artist}`);
        if (changedTrack && arg && settings.notifications && Notification.isSupported() && !(mainWin && mainWin.isFocused())) {
          let icon = ICON;
          try {
            if (arg.thumb) {
              const r = await net.fetch(arg.thumb.replace(/=w\d+-h\d+[^&]*$/, '=w120-h120-l90-rj'));
              if (r.ok) icon = nativeImage.createFromBuffer(Buffer.from(await r.arrayBuffer()));
            }
          } catch (_) {}
          new Notification({ title: arg.title, body: arg.album ? `${arg.artist} — ${arg.album}` : arg.artist, silent: true, icon }).show();
        }
        return playerExec(`window.__kaset.meta(${JSON.stringify(arg)})`);
      }
      case 'showVideo': return showVideo(!!arg);
      case 'mini':
        if (arg) createMiniWindow();
        else if (miniWin) { miniWin.close(); showMain(); }
        return true;
      default:
        return null;
    }
  });

  // YouTube mode video window
  ipcMain.handle('yt', async (_e, cmd, arg) => {
    switch (cmd) {
      case 'load': return ytLoad(arg || {});
      case 'play': playerExec('window.__kaset && window.__kaset.pause()'); return ytExec('window.__kaset.play()');
      case 'pause': return ytExec('window.__kaset.pause()');
      case 'stop':
        ytCurrent = null;
        if (presence) presence.clearSource('youtube');
        showYtWindow(false);
        return ytExec('window.__kaset.stop()');
      case 'seek': return ytExec(`window.__kaset.seek(${Number(arg) || 0})`);
      case 'show': return showYtWindow(!!arg);
      case 'fullscreen':
        showYtWindow(true);
        ytWin.setFullScreen(arg == null ? !ytWin.isFullScreen() : !!arg);
        return ytWin.isFullScreen();
      case 'captions': return ytExec('window.__kaset.captions()');
      case 'setCaptions': return ytExec(`window.__kaset.setCaptions(${JSON.stringify(arg || '')})`);
      case 'qualities': return ytExec('window.__kaset.qualities()');
      case 'setQuality': return ytExec(`window.__kaset.setQuality(${JSON.stringify(arg || 'auto')})`);
      case 'meta':
        if (arg && ytCurrent && arg.videoId === ytCurrent.videoId) Object.assign(ytCurrent, { title: arg.title, channel: arg.artist });
        if (ytWin && !ytWin.isDestroyed()) ytWin.setTitle(ytTitle());
        return ytExec(`window.__kaset.meta(${JSON.stringify(arg)})`);
      default: return null;
    }
  });
  // Taskbar/tray show "playing" when either source is playing.
  const setPlaying = (source, playing) => {
    sourcePlaying[source] = playing;
    const any = sourcePlaying.music || sourcePlaying.youtube;
    if (any !== isPlaying) { isPlaying = any; updateThumbar(); refreshTrayMenu(); }
  };
  ipcMain.on('yt:event', (_e, msg) => {
    if (msg.type === 'state') {
      const playing = !!(msg.ready && !msg.paused && ytCurrent);
      setPlaying('youtube', playing);
      if (presence && ytCurrent && msg.ready && !msg.ad && msg.videoId === ytCurrent.videoId) {
        presence.receive({ source: 'youtube', title: ytCurrent.title || msg.title, artist: ytCurrent.channel || msg.author, videoId: ytCurrent.videoId,
          playing: !msg.paused, position: msg.time, duration: msg.duration });
      }
      if (mainWin && playing && msg.duration > 0 && !msg.ad) mainWin.setProgressBar(Math.min(1, msg.time / msg.duration));
    }
    send('yt:event', msg);
  });
  ipcMain.on('yt:overlay', (_e, cmd) => {
    if (cmd === 'fullscreen' && ytWin && !ytWin.isDestroyed()) ytWin.setFullScreen(!ytWin.isFullScreen());
    else if (cmd === 'showMain') showMain();
    else send('command', { cmd: 'yt:' + cmd });
  });

  ipcMain.on('player:event', (_e, msg) => {
    if (msg.type === 'state') {
      const playing = msg.ready && !msg.paused;
      setPlaying('music', playing);
      if (presence && nowPlaying && msg.ready && !msg.ad && msg.videoId === nowPlaying.videoId) {
        presence.receive({ source: 'music', title: nowPlaying.title, artist: nowPlaying.artist, album: nowPlaying.album, artwork: bigArtwork(nowPlaying.thumb),
          videoId: nowPlaying.videoId, playing: !msg.paused, position: msg.time, duration: msg.duration });
      }
      if (mainWin && msg.duration > 0 && !msg.ad && !sourcePlaying.youtube) {
        mainWin.setProgressBar(Math.min(1, msg.time / msg.duration), { mode: playing ? 'normal' : 'paused' });
      }
    }
    send('player:event', msg);
    sendMini('player:event', msg);
  });

  ipcMain.on('command', (_e, cmd, arg) => {
    if (cmd === 'showMain') { if (miniWin) miniWin.close(); return showMain(); }
    if (cmd === 'closeMini') { if (miniWin) miniWin.close(); return showMain(); }
    send('command', arg ? { cmd, ...arg } : cmd);
  });

  ipcMain.handle('settings:get', () => settings);
  ipcMain.handle('settings:set', (_e, patch) => {
    settings = { ...settings, ...patch };
    if ('launchAtLogin' in patch) {
      app.setLoginItemSettings({ openAtLogin: !!patch.launchAtLogin, args: ['--hidden'] });
    }
    saveSettings();
    return settings;
  });
  ipcMain.handle('theme:set', (_e, appearance) => {
    nativeTheme.themeSource = appearance === 'light' || appearance === 'dark' ? appearance : 'system';
    for (const w of [mainWin]) if (w && !w.isDestroyed()) { try { w.setTitleBarOverlay(overlayColors()); } catch (_) {} }
  });
  ipcMain.handle('app:version', () => app.getVersion());
  ipcMain.handle('app:ready', () => {
    rendererReady = true;
    while (pendingUrls.length) send('open-url', pendingUrls.shift());
  });
  ipcMain.handle('app:fullscreen', (e) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    if (w) w.setFullScreen(!w.isFullScreen());
  });
  ipcMain.handle('app:checkUpdates', () => checkUpdatesNow());
  ipcMain.handle('auth:login', () => openLogin());
  ipcMain.handle('auth:logout', () => signOut());
  ipcMain.handle('discord:status', () => (presence ? presence.status() : { connected: false, enabled: false }));
  ipcMain.handle('open:external', (_e, url) => {
    if (url === 'https://discord.com/developers/applications') return shell.openExternal(url);
    if (/^https:\/\/((music|www)\.)?youtube\.com\//.test(url) || /^https:\/\/github\.com\//.test(url)) shell.openExternal(url);
  });
}

// ---------- lifecycle ----------
app.on('second-instance', (_e, argv) => {
  const handled = argv.some((a) => a.startsWith('--command=') || /^kaset:/i.test(a));
  handleArgv(argv);
  if (!handled) showMain();
});

app.whenReady().then(async () => {
  loadSettings();
  nativeTheme.themeSource = ['light', 'dark'].includes(settings.appearance) ? settings.appearance : 'system';
  ses = session.fromPartition(PARTITION);
  ses.setUserAgent(CHROME_UA);
  // Never advertise Electron upstream; Google rejects embedded browsers at sign-in.
  ses.webRequest.onBeforeSendHeaders({ urls: ['https://*.google.com/*', 'https://*.youtube.com/*'] }, (d, cb) => {
    const h = d.requestHeaders;
    if (h['User-Agent'] && /Electron|kaset/i.test(h['User-Agent'])) h['User-Agent'] = CHROME_UA;
    cb({ requestHeaders: h });
  });
  ses.setPermissionRequestHandler((_wc, perm, cb) => cb(['media', 'mediaKeySystem', 'fullscreen'].includes(perm)));

  presence = new Presence(() => settings.discord);
  createParty();
  registerIpc();
  if (settings.party && settings.party.enabled) applyParty().catch(() => {});
  createPlayerWindow();
  createMainWindow({ hidden: process.argv.includes('--hidden') });
  buildTray();
  renderGlyphs();
  setJumpList();
  initUpdater();
  nativeTheme.on('updated', () => { try { mainWin && mainWin.setTitleBarOverlay(overlayColors()); } catch (_) {} });
  handleArgv(process.argv.slice(1));
});

app.on('before-quit', () => { quitting = true; if (presence) presence.shutdown(); if (party) party.stop(); });
app.on('window-all-closed', () => {
  if (!settings.closeToTray) app.quit();
});
