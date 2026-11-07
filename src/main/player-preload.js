'use strict';
// Preload for the hidden music.youtube.com playback window.
// Injects a small controller into the page's main world (before page scripts run)
// and relays its messages to the main process.
const { ipcRenderer, webFrame } = require('electron');

const PAGE_SCRIPT = `(() => {
  if (window.__kaset) return;
  const post = (msg) => window.postMessage({ __kaset: true, ...msg }, '*');

  // Take ownership of the OS media session (Windows SMTC / media keys):
  // ignore what the page sets, route actions to the app's own queue.
  const MS = window.MediaSession && MediaSession.prototype;
  let realSetHandler = null, metaDesc = null;
  if (MS) {
    realSetHandler = MS.setActionHandler;
    MS.setActionHandler = function () {};
    metaDesc = Object.getOwnPropertyDescriptor(MS, 'metadata');
    if (metaDesc) Object.defineProperty(MS, 'metadata', { configurable: true, get() { return metaDesc.get.call(this); }, set() {} });
    const actions = ['play', 'pause', 'nexttrack', 'previoustrack', 'seekto', 'stop'];
    const install = () => {
      for (const a of actions) {
        try { realSetHandler.call(navigator.mediaSession, a, (d) => post({ type: 'media', action: a, seekTime: d && d.seekTime })); } catch (_) {}
      }
    };
    install();
    setInterval(install, 5000);
  }

  let expected = null;       // videoId we asked to play
  let endedFor = null;       // videoId we already reported 'ended' for
  let wantPlaying = false;

  const player = () => document.getElementById('movie_player');
  const video = () => document.querySelector('video');

  window.__kaset = {
    load(videoId, startSeconds) {
      expected = videoId; endedFor = null; wantPlaying = true;
      const p = player();
      if (p && typeof p.loadVideoById === 'function') {
        p.loadVideoById({ videoId, startSeconds: startSeconds || 0 });
        return 'loaded';
      }
      return 'no-player';
    },
    play() { wantPlaying = true; const p = player(); if (p && p.playVideo) p.playVideo(); else video() && video().play(); },
    pause() { wantPlaying = false; const p = player(); if (p && p.pauseVideo) p.pauseVideo(); else video() && video().pause(); },
    stop() { wantPlaying = false; expected = null; const p = player(); if (p && p.stopVideo) p.stopVideo(); },
    seek(t) { const p = player(); if (p && p.seekTo) p.seekTo(t, true); else if (video()) video().currentTime = t; },
    volume(v) { const p = player(); if (p && p.setVolume) { p.setVolume(v); if (v > 0 && p.unMute) p.unMute(); } const el = video(); if (el) el.volume = v / 100; },
    meta(m) {
      try {
        if (!metaDesc) return;
        const md = m ? new MediaMetadata({ title: m.title, artist: m.artist, album: m.album || '', artwork: m.thumb ? [{ src: m.thumb, sizes: '544x544', type: 'image/jpeg' }] : [] }) : null;
        metaDesc.set.call(navigator.mediaSession, md);
      } catch (_) {}
    },
    // Take over a video the page itself is already loading (fresh watch-page load).
    adopt(videoId, startSeconds) {
      expected = videoId; endedFor = null; wantPlaying = true;
      const p = player();
      if (!p || !p.getVideoData) return 'no-player';
      if (p.getVideoData().video_id !== videoId) return window.__kaset.load(videoId, startSeconds);
      if (p.playVideo) p.playVideo();
      return 'loaded';
    },
    ready() { const p = player(); return !!(p && typeof p.loadVideoById === 'function'); },
    // Captions / quality through the player API (as Kaset's YouTube player does).
    captions() {
      const p = player();
      if (!p || !p.getOption) return { tracks: [], current: '' };
      try { p.loadModule && p.loadModule('captions'); } catch (_) {}
      let tracks = [], cur = null;
      try { tracks = p.getOption('captions', 'tracklist') || []; } catch (_) {}
      try { cur = p.getOption('captions', 'track'); } catch (_) {}
      return {
        tracks: tracks.map((t) => ({ code: t.languageCode, name: (t.displayName || t.languageName || t.languageCode) + (t.kind === 'asr' && !/auto/i.test(t.displayName || '') ? ' (auto-generated)' : '') })),
        current: cur && cur.languageCode ? cur.languageCode : '',
      };
    },
    setCaptions(code) {
      const p = player();
      if (!p) return false;
      try {
        if (!code) { p.setOption('captions', 'track', {}); if (p.unloadModule) p.unloadModule('captions'); return true; }
        if (p.loadModule) p.loadModule('captions');
        const t = (p.getOption('captions', 'tracklist') || []).find((x) => x.languageCode === code);
        p.setOption('captions', 'track', t || { languageCode: code });
        return true;
      } catch (_) { return false; }
    },
    qualities() {
      const p = player();
      if (!p || !p.getAvailableQualityLevels) return { levels: [], current: '' };
      return { levels: p.getAvailableQualityLevels() || [], current: p.getPlaybackQuality ? p.getPlaybackQuality() : '' };
    },
    setQuality(q) {
      const p = player();
      if (!p || !p.setPlaybackQualityRange) return false;
      try { p.setPlaybackQualityRange(q === 'auto' ? 'auto' : q, q === 'auto' ? 'auto' : q); return true; } catch (_) { return false; }
    },
    eq(cfg) { eqConfig = cfg; applyEq(); },
  };

  // ---- 6-band equalizer (Kaset's bands: 60/150/400/1k/2.4k/15k Hz, shelves at the edges) ----
  const BANDS = [[60, 0.71, 'lowshelf'], [150, 0.55, 'peaking'], [400, 0.5, 'peaking'], [1000, 0.5, 'peaking'], [2400, 0.55, 'peaking'], [15000, 0.71, 'highshelf']];
  let eqConfig = null, eqCtx = null, eqFilters = null, eqPre = null, eqVideo = null;
  function applyEq() {
    const el = video();
    if (!el || !eqConfig) return;
    if (!eqCtx && !eqConfig.enabled) return; // never touch the audio path unless the EQ is used
    try {
      if (!eqCtx) eqCtx = new AudioContext({ latencyHint: 'playback' });
      if (eqVideo !== el) {
        const src = eqCtx.createMediaElementSource(el);
        eqPre = eqCtx.createGain();
        eqFilters = BANDS.map(([f, q, type]) => { const b = eqCtx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; });
        src.connect(eqPre);
        eqFilters.reduce((prev, b) => { prev.connect(b); return b; }, eqPre).connect(eqCtx.destination);
        eqVideo = el;
      }
      const gains = eqConfig.enabled ? eqConfig.gains : [0, 0, 0, 0, 0, 0];
      const t = eqCtx.currentTime;
      eqFilters.forEach((b, i) => b.gain.setTargetAtTime(Number(gains[i]) || 0, t, 0.05));
      const peak = Math.max(0, ...gains.map(Number));
      eqPre.gain.setTargetAtTime(Math.pow(10, -peak * 0.6 / 20), t, 0.05); // headroom so boosts don't clip
      if (eqCtx.state === 'suspended') eqCtx.resume();
    } catch (_) {}
  }
  document.addEventListener('play', (e) => { if (e.target.tagName === 'VIDEO') { if (eqCtx && eqCtx.state === 'suspended') eqCtx.resume(); if (eqConfig && eqVideo !== e.target) applyEq(); } }, true);

  // Commands from Kaset's hover controls (isolated world) in the YouTube video window.
  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || !e.data.__kasetCmd) return;
    const k = window.__kaset, c = e.data.__kasetCmd;
    if (c === 'play') k.play(); else if (c === 'pause') k.pause(); else if (c === 'seek') k.seek(e.data.arg);
  });

  let errorHooked = null;
  setInterval(() => {
    const p = player();
    const el = video();
    if (!p || !p.getPlayerState) { post({ type: 'state', ready: false }); return; }
    if (errorHooked !== p && p.addEventListener) {
      errorHooked = p;
      p.addEventListener('onError', () => { if (expected) post({ type: 'error', videoId: expected }); });
    }
    const data = p.getVideoData ? p.getVideoData() : {};
    const state = p.getPlayerState(); // -1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering, 5 cued
    const ad = p.classList.contains('ad-showing') || p.classList.contains('ad-interrupting');
    const msg = {
      type: 'state', ready: true, videoId: data.video_id, expected, state, ad,
      time: el ? el.currentTime : (p.getCurrentTime ? p.getCurrentTime() : 0),
      duration: el && isFinite(el.duration) ? el.duration : (p.getDuration ? p.getDuration() : 0),
      paused: el ? el.paused : state !== 1,
      title: data.title || '', author: data.author || '',
      captions: (() => { try { const t = location.hostname === 'www.youtube.com' && p.getOption && p.getOption('captions', 'track'); return !!(t && t.languageCode); } catch (_) { return false; } })(),
      volume: p.getVolume ? p.getVolume() : 100,
    };
    post(msg);
    if (!ad && expected && data.video_id === expected && state === 0 && endedFor !== expected) {
      endedFor = expected;
      post({ type: 'ended', videoId: expected });
    }
    // YouTube Music sometimes queues its own autoplay; keep playback on our track.
    if (!ad && expected && data.video_id && data.video_id !== expected && state === 1 && endedFor === expected) {
      p.pauseVideo && p.pauseVideo();
    }
    // Dismiss "Are you still listening?"
    const yt = document.querySelector('ytmusic-you-there-renderer button, tp-yt-paper-dialog ytmusic-you-there-renderer #button, yt-confirm-dialog-renderer #confirm-button button');
    if (yt) yt.click();
    // Skip button on skippable ads
    const skip = document.querySelector('.ytp-ad-skip-button, .ytp-ad-skip-button-modern, .ytp-skip-ad-button');
    if (skip) skip.click();
  }, 500);

  document.addEventListener('ended', (e) => {
    if (e.target && e.target.tagName === 'VIDEO' && expected && endedFor !== expected) {
      const p = player();
      const ad = p && p.classList.contains('ad-showing');
      if (!ad) { endedFor = expected; post({ type: 'ended', videoId: expected }); }
    }
  }, true);
})();`;

webFrame.executeJavaScript(PAGE_SCRIPT).catch(() => {});

// The same controller serves both playback windows; events are routed by origin.
const IS_YOUTUBE = location.hostname === 'www.youtube.com';
const CHANNEL = IS_YOUTUBE ? 'yt:event' : 'player:event';

// ---- Kaset hover controls for the YouTube video window ----
// Built with DOM APIs (no innerHTML: www.youtube.com enforces Trusted Types).
// Styles come from main.js (YT_VIDEO_CSS, inserted with webContents.insertCSS).
const overlay = (() => {
  if (!IS_YOUTUBE) return { update() {} };
  const NS = 'http://www.w3.org/2000/svg';
  const fmt = (t) => {
    t = Math.max(0, Math.floor(t || 0));
    const h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, s = t % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0');
  };
  const icon = (d, fill) => {
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    if (fill) svg.setAttribute('class', 'kf');
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', d);
    svg.appendChild(p);
    return svg;
  };
  const PATH = {
    play: 'M7 4.5v15l12.5-7.5z',
    pause: 'M6.5 4.5h3.8v15H6.5zM13.7 4.5h3.8v15h-3.8z',
    back: 'M11.5 6.2v11.6L3 12zM21 6.2v11.6L12.5 12z',
    fwd: 'M12.5 6.2v11.6L21 12zM3 6.2v11.6L11.5 12z',
    cc: 'M4.5 5.5h15A1.5 1.5 0 0 1 21 7v10a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17V7a1.5 1.5 0 0 1 1.5-1.5zM10.5 10.2a2.2 2.2 0 1 0 0 3.6M17 10.2a2.2 2.2 0 1 0 0 3.6',
    full: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
    main: 'M4 5h16v14H4zM9 5v14',
  };
  let root = null, ppPath, fillEl, knob, cur, dur, ccBtn, last = null, idleTimer = null, dragging = false;
  const cmd = (c, arg) => window.postMessage({ __kasetCmd: c, arg }, '*');
  const toggle = () => cmd(last && !last.paused ? 'pause' : 'play');
  const seekBy = (d) => last && cmd('seek', Math.max(0, Math.min(last.duration || 0, last.time + d)));
  const btn = (d, title, fn, opts = {}) => {
    const b = document.createElement('button');
    b.title = title;
    if (opts.big) b.className = 'big';
    b.appendChild(icon(d, opts.fill));
    b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
    return b;
  };
  const wake = () => {
    document.documentElement.classList.remove('kaset-idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (last && !last.paused && root && !root.matches(':hover') && !dragging) document.documentElement.classList.add('kaset-idle');
    }, 3000);
  };
  function build() {
    if (root || !document.body) return;
    root = document.createElement('div');
    root.id = 'kaset-ov';
    const pp = btn(PATH.pause, 'Play / Pause (Space)', toggle, { fill: true, big: true });
    ppPath = pp.querySelector('path');
    cur = document.createElement('span'); cur.className = 'time';
    dur = document.createElement('span'); dur.className = 'time';
    const ad = document.createElement('span'); ad.className = 'adtag'; ad.textContent = 'Ad';
    const lane = document.createElement('div'); lane.className = 'lane';
    fillEl = document.createElement('div'); fillEl.className = 'fill';
    knob = document.createElement('div'); knob.className = 'knob';
    lane.append(fillEl, knob);
    const frac = (e) => { const r = lane.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); };
    const paint = (f) => { fillEl.style.width = f * 100 + '%'; knob.style.left = f * 100 + '%'; };
    lane.addEventListener('pointerdown', (e) => {
      if (!last || !last.duration) return;
      dragging = true;
      lane.setPointerCapture(e.pointerId);
      paint(frac(e));
      const move = (ev) => { paint(frac(ev)); cur.textContent = fmt(frac(ev) * last.duration); };
      const up = (ev) => {
        lane.removeEventListener('pointermove', move);
        lane.removeEventListener('pointerup', up);
        dragging = false;
        cmd('seek', frac(ev) * last.duration);
      };
      lane.addEventListener('pointermove', move);
      lane.addEventListener('pointerup', up);
    });
    ccBtn = btn(PATH.cc, 'Captions (C)', () => ipcRenderer.send('yt:overlay', 'captions'));
    root.append(
      btn(PATH.back, 'Back 10 seconds (J)', () => seekBy(-10), { fill: true }),
      pp,
      btn(PATH.fwd, 'Forward 10 seconds (L)', () => seekBy(10), { fill: true }),
      ad, cur, lane, dur, ccBtn,
      btn(PATH.full, 'Full Screen (F)', () => ipcRenderer.send('yt:overlay', 'fullscreen')),
      btn(PATH.main, 'Show Kaset', () => ipcRenderer.send('yt:overlay', 'showMain')),
    );
    document.body.appendChild(root);
    document.addEventListener('mousemove', wake, true);
    // Click on the video toggles playback; double-click toggles full screen.
    const onVideo = (t) => t.closest && t.closest('#movie_player') && !t.closest('#kaset-ov, [class*="ytp-ad-"], .ytp-skip-ad-button');
    document.addEventListener('click', (e) => { if (onVideo(e.target)) { e.stopPropagation(); e.preventDefault(); toggle(); } }, true);
    document.addEventListener('dblclick', (e) => { if (onVideo(e.target)) { e.stopPropagation(); e.preventDefault(); ipcRenderer.send('yt:overlay', 'fullscreen'); } }, true);
    document.addEventListener('keydown', (e) => {
      wake();
      if (/INPUT|TEXTAREA/.test(document.activeElement && document.activeElement.tagName)) return;
      const k = e.key.toLowerCase();
      const handled = { ' ': toggle, k: toggle, j: () => seekBy(-10), l: () => seekBy(10), arrowleft: () => seekBy(-5), arrowright: () => seekBy(5), f: () => ipcRenderer.send('yt:overlay', 'fullscreen'), c: () => ipcRenderer.send('yt:overlay', 'captions') }[k];
      if (handled) { e.preventDefault(); e.stopPropagation(); handled(); }
    }, true);
    wake();
  }
  document.addEventListener('DOMContentLoaded', build);
  return {
    update(msg) {
      build();
      if (!root || !msg.ready) return;
      last = msg;
      ppPath.setAttribute('d', msg.paused ? PATH.play : PATH.pause);
      root.classList.toggle('ad', !!msg.ad);
      if (!dragging) {
        const f = msg.duration ? Math.min(1, msg.time / msg.duration) : 0;
        fillEl.style.width = f * 100 + '%';
        knob.style.left = f * 100 + '%';
        cur.textContent = fmt(msg.time);
      }
      dur.textContent = fmt(msg.duration);
      if (msg.paused) document.documentElement.classList.remove('kaset-idle');
      ccBtn.classList.toggle('on', !!msg.captions);
    },
  };
})();

window.addEventListener('message', (e) => {
  if (e.source !== window || !e.data || !e.data.__kaset) return;
  const { __kaset, ...msg } = e.data;
  ipcRenderer.send(CHANNEL, msg);
  if (msg.type === 'state') overlay.update(msg);
});
