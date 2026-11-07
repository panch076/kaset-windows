// Kaset for Windows — renderer
const K = window.kaset;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (t) => {
  t = Math.max(0, Math.floor(t || 0));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
};
const ICON = {
  play: '<svg viewBox="0 0 24 24" class="fill"><path d="M7 4.5v15l12.5-7.5z"/></svg>',
  shuffle: '<svg viewBox="0 0 24 24"><path d="M3.5 7h3.6c2 0 3 1 4.4 3.5S14.4 17 16.4 17h4M3.5 17h3.6c1.2 0 2-.4 2.8-1.2M13.6 8.2c.7-.8 1.6-1.2 2.8-1.2h4M18 4.5L20.5 7 18 9.5M18 14.5l2.5 2.5-2.5 2.5"/></svg>',
  radio: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="2"/><path d="M8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7M5.6 5.6a9 9 0 0 0 0 12.8M18.4 5.6a9 9 0 0 1 0 12.8"/></svg>',
  more: '<svg viewBox="0 0 24 24" class="fill"><circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/></svg>',
  x: '<svg viewBox="0 0 24 24"><path d="M7 7l10 10M17 7L7 17"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  left: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
  right: '<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>',
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>',
  sparkle: '<svg viewBox="0 0 24 24"><path d="M12 3.5l1.6 4.9L18.5 10l-4.9 1.6L12 16.5l-1.6-4.9L5.5 10l4.9-1.6z"/></svg>',
  user: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8.5" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/></svg>',
};

// ---------------------------------------------------------------- state
const state = { signedIn: false, account: null, settings: {}, libraryPlaylists: [], version: '' };
const registry = new Map();
let regSeq = 0;
const reg = (item) => { const id = 'i' + (++regSeq); registry.set(id, item); return id; };
const lists = new Map();
let listSeq = 0;
const newList = (items) => { const id = 'l' + (++listSeq); lists.set(id, items); return id; };

function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  t.style.animation = 'none'; void t.offsetWidth; t.style.animation = '';
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add('hidden'), ms);
}
const api = (method, args) => K.api(method, args);
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (_) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} },
};
const imgTag = (src, cls = '', extra = '') => `<img class="fade ${cls}" loading="lazy" src="${esc(src || '')}" alt="" ${extra}>`;
document.addEventListener('load', (e) => { if (e.target.tagName === 'IMG' && e.target.classList.contains('fade')) e.target.classList.add('loaded'); }, true);
document.addEventListener('error', (e) => { if (e.target.tagName === 'IMG') e.target.classList.add('loaded'); }, true);

// ---------------------------------------------------------------- router
let history_ = { stack: [], index: -1 }; // swapped per source by setMode()
const ROUTES = {
  home: { browseId: 'FEmusic_home', title: 'Home' },
  explore: { browseId: 'FEmusic_explore', title: 'Explore' },
  charts: { browseId: 'FEmusic_charts', title: 'Charts' },
  moods: { browseId: 'FEmusic_moods_and_genres', title: 'Moods & Genres' },
  newReleases: { browseId: 'FEmusic_new_releases', title: 'New Releases' },
  podcasts: { browseId: 'FEmusic_podcasts', title: 'Podcasts' },
  liked: { browseId: 'VLLM', auth: true, title: 'Liked Music' },
  history: { browseId: 'FEmusic_history', auth: true, title: 'History' },
};
const LIBRARY_TABS = [
  ['FEmusic_liked_playlists', 'Playlists'],
  ['FEmusic_liked_videos', 'Songs'],
  ['FEmusic_liked_albums', 'Albums'],
  ['FEmusic_library_corpus_track_artists', 'Artists'],
  ['FEmusic_library_corpus_artists', 'Subscriptions'],
  ['FEmusic_library_non_music_audio_list', 'Podcasts'],
];

function navigate(route, replace = false) {
  if (replace && history_.index >= 0) history_.stack[history_.index] = route;
  else {
    history_.stack = history_.stack.slice(0, history_.index + 1);
    history_.stack.push(route);
    history_.index++;
  }
  closeNowPlaying();
  render();
}
function back() { if (history_.index > 0) { history_.index--; render(); } }
function forward() { if (history_.index < history_.stack.length - 1) { history_.index++; render(); } }
const currentRoute = () => history_.stack[history_.index];

const skeleton = () => `<div class="sk-title"></div><div class="sk-row">${'<div class="sk-card"></div>'.repeat(8)}</div><div class="sk-title"></div><div class="sk-row">${'<div class="sk-card"></div>'.repeat(8)}</div>`;

let renderToken = 0;
const pageCache = new Map();
async function render() {
  const route = currentRoute();
  const token = ++renderToken;
  const content = $('#content');
  $('#back').disabled = history_.index <= 0;
  $('#forward').disabled = history_.index >= history_.stack.length - 1;
  $$('.nav-item').forEach((a) => a.classList.toggle('active',
    (!!a.dataset.route && a.dataset.route === route.name) || (!!a.dataset.browse && a.dataset.browse === route.browseId)));
  setTitle(route.name === 'browse' ? '' : (ROUTES[route.name]?.title || (route.name === 'library' ? 'Library' : route.name === 'search' ? 'Search' : '')));
  $('#topbar').classList.remove('scrolled');
  const alive = () => token === renderToken;
  const key = JSON.stringify(route);
  const cached = pageCache.get(key);
  const isYt = route.name.startsWith('yt-');
  if (!cached) content.innerHTML = isYt ? ytSkeleton() : skeleton();
  content.scrollTop = 0;
  try {
    if (isYt) return await renderYt(route, content, alive);
    if (route.name === 'search') return renderSearchPage(route, content, alive);
    if (route.name === 'library') return await renderLibrary(route, content, alive);
    const def = ROUTES[route.name];
    const browseId = route.browseId || def?.browseId;
    if (def?.auth && !state.signedIn) { content.innerHTML = signInPrompt(def.title); return; }
    let data = cached && Date.now() - cached.at < 5 * 60e3 ? cached.data : null;
    if (!data) {
      data = await api('browse', { browseId, params: route.params });
      pageCache.set(key, { data, at: Date.now() });
    }
    if (!alive()) return;
    renderBrowse(content, data, { title: def?.title, browseId, route });
  } catch (e) {
    if (!alive()) return;
    if (e.code === 'AUTH') content.innerHTML = isYt ? ytSignIn(YT_TITLES[route.name] || 'this page') : signInPrompt(ROUTES[route.name]?.title || 'this page');
    else content.innerHTML = `<div class="empty"><h2>Couldn't load this page</h2><div>${esc(e.message)}</div><button class="btn" data-action="retry">Try Again</button></div>`;
  }
}

function setTitle(t) { $('#page-title').textContent = t || ''; }

function signInPrompt(what) {
  return `<div class="empty">${ICON.user.replace('<svg', '<svg class="big-icon"')}<h2>Sign in to see ${esc(what)}</h2><div>Your library, liked music and history come from your YouTube Music account.</div><button class="btn primary" data-action="login">Sign In</button></div>`;
}

// ---------------------------------------------------------------- rendering helpers
function subtitleHtml(item) {
  if (item.artists?.length && item.artists[0].name) {
    return item.artists.map((x) => x.id ? `<span class="lnk" data-artist="${esc(x.id)}">${esc(x.name)}</span>` : esc(x.name)).join(', ');
  }
  return esc(item.subtitle || '');
}

function cardHtml(item, rank) {
  const id = reg(item);
  const playable = item.videoId || item.playlistId;
  const cls = ['card', item.round ? 'round' : '', item.wide ? 'wide' : ''].join(' ');
  return `<div class="${cls}" data-item="${id}" tabindex="0">
    <div class="art">${item.thumb ? imgTag(item.thumb) : ''}${rank ? `<div class="rank">${rank}</div>` : ''}${playable ? `<button class="hover-play" data-play="${id}" title="Play">${ICON.play}</button>` : ''}</div>
    <div class="t" title="${esc(item.title)}">${esc(item.title)}</div>
    <div class="s">${esc(item.subtitle || '')}</div>
  </div>`;
}

function trackHtml(item, i, listId, opts = {}) {
  const id = reg(item);
  const playing = player.current()?.videoId === item.videoId;
  const album = item.album ? `<span class="lnk" data-browse="${esc(item.album.id)}">${esc(item.album.name)}</span>` : '';
  if (opts.compact) {
    return `<div class="track compact ${playing ? 'playing' : ''}" data-item="${id}" data-list="${listId}" data-index="${i}">
      ${imgTag(item.thumb, 'thumb')}
      <div class="meta"><div class="tt">${esc(item.title)}</div><div class="ta">${subtitleHtml(item)}</div></div>
      <button class="icon-btn small more" data-menu="${id}" title="More">${ICON.more}</button></div>`;
  }
  return `<div class="track ${playing ? 'playing' : ''} ${item.unavailable ? 'unavailable' : ''}" data-item="${id}" data-list="${listId}" data-index="${i}">
    <div class="idx"><span class="num">${i + 1}</span><span class="pbtn">${ICON.play}</span></div>
    ${imgTag(item.thumb, 'thumb')}
    <div class="meta"><div class="tt">${esc(item.title)}</div><div class="ta">${['song', 'video', 'episode'].includes(item.kind) ? subtitleHtml(item) : esc(item.subtitle)}</div></div>
    <div class="alb">${album}</div>
    <div class="dur">${esc(item.durationText || '')}</div>
    <button class="icon-btn small more" data-menu="${id}" title="More">${ICON.more}</button>
  </div>`;
}

function listRowHtml(item, i, listId) {
  if (item.videoId) return trackHtml(item, i, listId);
  const id = reg(item);
  return `<div class="track" data-item="${id}">
    <div class="idx"></div>
    ${imgTag(item.thumb, 'thumb', item.kind === 'artist' ? 'style="border-radius:50%"' : '')}
    <div class="meta"><div class="tt">${esc(item.title)}</div><div class="ta">${esc(item.subtitle)}</div></div>
    <div class="alb"></div><div class="dur"></div>
    <button class="icon-btn small more" data-menu="${id}" title="More">${ICON.more}</button></div>`;
}

const RANKED = /chart|top \d|trending|top songs|top albums|top artists|top music|weekly|daily/i;
const arrows = `<button class="glass-circle arrow l" data-scroll="-1">${ICON.left}</button><button class="glass-circle arrow r" data-scroll="1">${ICON.right}</button>`;

function sectionHtml(sec, opts = {}) {
  const titleAttr = sec.browse ? ` class="lnk-h" data-browse="${esc(sec.browse.browseId)}" data-params="${esc(sec.browse.params || '')}"` : '';
  const head = (extra = '') => sec.title || extra ? `<div class="section-head"><div>${sec.strapline ? `<div class="strap">${esc(sec.strapline)}</div>` : ''}<h2${titleAttr}>${esc(sec.title || '')}</h2></div><div class="actions">${extra}</div></div>` : '';
  const more = sec.search ? `<a class="link-more" data-search="${esc(sec.search.query)}" data-sparams="${esc(sec.search.params || '')}">See All</a>` : sec.browse ? `<a class="link-more" data-browse="${esc(sec.browse.browseId)}" data-params="${esc(sec.browse.params || '')}">See All</a>` : '';
  const ranked = RANKED.test(sec.title || '') && !opts.grid;
  if (sec.style === 'cards') {
    const wide = sec.items.every((i) => i.wide);
    if (opts.grid) return `<section class="section">${head(more)}<div class="grid-cards">${sec.items.map((it) => cardHtml(it)).join('')}</div></section>`;
    return `<section class="section">${head(more)}<div class="carousel"><div class="row-scroll ${wide ? 'wide' : ''}">${sec.items.map((it, i) => cardHtml(it, ranked && !it.round ? i + 1 : 0)).join('')}</div>${arrows}</div></section>`;
  }
  if (sec.style === 'moods') {
    return `<section class="section">${head(more)}<div class="moods">${sec.items.map((m) => `<div class="mood" style="--c:${esc(m.color || '#ff0056')}" data-browse="${esc(m.browseId)}" data-params="${esc(m.params || '')}">${esc(m.title)}</div>`).join('')}</div></section>`;
  }
  if (sec.style === 'grid-list') {
    const lid = newList(sec.items.filter((i) => i.videoId));
    return `<section class="section">${head(more)}<div class="carousel"><div class="grid-list">${sec.items.map((it, i) => trackHtml(it, i, lid, { compact: true })).join('')}</div>${arrows}</div></section>`;
  }
  if (sec.style === 'top') {
    const [top, ...rest] = sec.items;
    const tid = reg(top);
    const lid = newList(rest.filter((i) => i.videoId));
    return `<section class="section">${head()}<div class="top-wrap">
      <div class="top-card" data-item="${tid}">${imgTag(top.thumb, top.kind === 'artist' ? 'round' : '')}<div><div class="t">${esc(top.title)}</div><div class="s">${esc(top.subtitle)}</div></div>
      <div>${top.videoId || top.playlistId || top.kind === 'artist' ? `<button class="btn primary" data-play="${tid}">${ICON.play} Play</button>` : ''}</div></div>
      <div class="tracks">${rest.map((it, i) => it.videoId ? trackHtml(it, i, lid, { compact: true }) : listRowHtml(it, i, lid)).join('')}</div></div></section>`;
  }
  if (sec.style === 'text') {
    return `<section class="section"><div class="section-head"><h2>${esc(sec.title || 'About')}</h2></div><div class="about">${esc(sec.text)}</div></section>`;
  }
  const tracks = sec.items.filter((i) => i.videoId);
  const lid = newList(tracks);
  const hasAlbum = sec.items.some((i) => i.album);
  const sameThumb = tracks.length > 1 && tracks.every((t) => t.thumb === tracks[0].thumb) && opts.collection;
  const cls = ['tracks', hasAlbum ? '' : 'no-album', sameThumb ? 'no-thumb' : ''].join(' ');
  return `<section class="section">${head(more)}<div class="${cls}" data-listid="${lid}">${sec.items.map((it, i) => listRowHtml(it, tracks.indexOf(it) >= 0 ? tracks.indexOf(it) : i, lid)).join('')}</div>${sec.continuation ? `<div class="sentinel" data-cont="${esc(sec.continuation)}" data-listid="${lid}"></div>` : ''}</section>`;
}

let currentHeader = null;
function heroHtml(h, sections, browseId) {
  if (h.type === 'artist') {
    const hid = reg({ kind: 'artist-header', ...h, browseId });
    currentHeader = registry.get(hid);
    return `<div class="artist-hero" style="background-image:url('${esc(h.thumb)}')"><div>
      <h1>${esc(h.title)}</h1><div class="meta2">${h.subscribers ? esc(h.subscribers) + ' subscribers' : ''}</div>
      <div class="actions">
        ${h.shuffle ? `<button class="btn primary" data-hero="shuffle" data-id="${hid}">${ICON.shuffle} Shuffle</button>` : ''}
        ${h.radio ? `<button class="btn" data-hero="radio" data-id="${hid}">${ICON.radio} Radio</button>` : ''}
        ${state.signedIn && h.channelId ? `<button class="btn" data-hero="subscribe" data-id="${hid}">${h.subscribed ? ICON.check + ' Subscribed' : 'Subscribe'}</button>` : ''}
        <button class="btn round-icon" data-hero="menu" data-id="${hid}" title="More">${ICON.more}</button>
      </div></div></div>`;
  }
  if (h.type === 'collection') {
    const tracks = sections.flatMap((s) => s.style === 'list' ? s.items.filter((i) => i.videoId) : []);
    const hid = reg({ kind: 'collection-header', ...h, tracks, browseId });
    currentHeader = registry.get(hid);
    const by = h.artists.length ? h.artists.map((a) => `<span class="lnk" data-artist="${esc(a.id)}">${esc(a.name)}</span>`).join(', ') : esc(h.strapline);
    return `<div class="hero"><div class="hero-glow" style="background-image:url('${esc(h.thumb)}')"></div>
      ${imgTag(h.thumb, 'cover')}
      <div class="info">
        <div class="kind">${esc(h.subtitle)}</div>
        <h1>${esc(h.title)}</h1>
        <div class="by">${by}</div>
        <div class="meta2">${esc(h.secondSubtitle)}</div>
        ${h.description ? `<div class="desc" data-toggle-desc title="Click to expand">${esc(h.description)}</div>` : ''}
        <div class="actions">
          <button class="btn primary" data-hero="play" data-id="${hid}">${ICON.play} Play</button>
          <button class="btn" data-hero="shuffle" data-id="${hid}">${ICON.shuffle} Shuffle</button>
          ${state.signedIn && h.playlistId && !h.editable && browseId !== 'VLLM' ? `<button class="btn" data-hero="save" data-id="${hid}">${h.saved ? ICON.check + ' In Library' : ICON.plus + ' Add to Library'}</button>` : ''}
          <button class="btn round-icon" data-hero="menu" data-id="${hid}" title="More">${ICON.more}</button>
        </div>
      </div></div>`;
  }
  return '';
}

function renderBrowse(content, data, ctx) {
  currentHeader = null;
  let html = '';
  if (data.header?.type === 'artist' || data.header?.type === 'collection') html += heroHtml(data.header, data.sections, ctx.browseId);
  else html += `<h1 class="page-title">${esc(data.header?.title || ctx.title || data.title || '')}</h1>`;
  setTitle(data.header?.title || ctx.title || data.title || '');
  if (data.chips?.length) {
    const base = ctx.route?.chipOf || ctx.browseId;
    html += `<div class="chips">${data.chips.map((c) => `<button class="chip ${ctx.route?.params && ctx.route.params === c.params ? 'on' : ''}" data-browse="${esc(base)}" data-params="${esc(c.params || '')}" data-chip="1">${esc(c.title)}</button>`).join('')}</div>`;
  }
  const isGrid = /^FEmusic_(liked_playlists|liked_albums|library_corpus|moods_and_genres_category|new_releases|podcasts|library_non_music)/.test(ctx.browseId) || (data.sections.length === 1 && data.sections[0].style === 'cards');
  const collection = data.header?.type === 'collection';
  html += data.sections.map((s) => sectionHtml(s, { grid: isGrid && s.style === 'cards', collection })).join('');
  if (!data.sections.length && !data.header) html += '<div class="empty"><h2>Nothing here yet</h2></div>';
  if (data.sectionContinuation) html += `<div class="sentinel" data-sections="${esc(data.sectionContinuation)}"></div>`;
  content.innerHTML = html;
  content.classList.remove('fade-in'); void content.offsetWidth; content.classList.add('fade-in');
  content.scrollTop = 0;
  observeSentinels(content);
  updateArrows();
}

const io = new IntersectionObserver(async (entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    const el = e.target;
    if (el.dataset.loading) continue;
    el.dataset.loading = '1';
    el.innerHTML = '<div class="spinner sm"></div>';
    try {
      if (el.dataset.sections) {
        const r = await api('continuation', { token: el.dataset.sections });
        const frag = document.createElement('div');
        frag.innerHTML = (r.sections || []).map((s) => sectionHtml(s)).join('') + (r.sectionContinuation ? `<div class="sentinel" data-sections="${esc(r.sectionContinuation)}"></div>` : '');
        el.replaceWith(...frag.childNodes);
        updateArrows();
      } else if (el.dataset.ytcont) {
        const next = await loadYtContinuation(el);
        if (next) { el.dataset.ytcont = next; delete el.dataset.loading; el.innerHTML = ''; io.unobserve(el); io.observe(el); }
        else el.remove();
      } else if (el.dataset.cont) {
        const lid = el.dataset.listid;
        const list = lists.get(lid) || [];
        const r = await api('continuation', { token: el.dataset.cont });
        const container = $(`.tracks[data-listid="${lid}"]`);
        const start = list.length;
        for (const it of r.items) {
          if (currentHeader?.kind === 'collection-header' && !it.thumb) it.thumb = currentHeader.thumb;
          if (it.videoId) list.push(it);
        }
        if (currentHeader?.tracks) currentHeader.tracks.push(...r.items.filter((i) => i.videoId));
        container?.insertAdjacentHTML('beforeend', r.items.map((it, i) => listRowHtml(it, start + i, lid)).join(''));
        if (r.continuation) { el.dataset.cont = r.continuation; delete el.dataset.loading; el.innerHTML = ''; io.unobserve(el); io.observe(el); }
        else el.remove();
      }
    } catch (err) {
      el.innerHTML = '';
    }
    observeSentinels($('#content'));
  }
}, { root: null, rootMargin: '700px' });
function observeSentinels(root) { $$('.sentinel:not([data-observed])', root).forEach((s) => { s.dataset.observed = '1'; io.observe(s); }); }

function updateArrows() {
  $$('.carousel').forEach((c) => {
    const row = c.querySelector('.row-scroll, .grid-list');
    const l = c.querySelector('.arrow.l'), r = c.querySelector('.arrow.r');
    if (!row || !l) return;
    l.classList.toggle('off', row.scrollLeft < 8);
    r.classList.toggle('off', row.scrollLeft + row.clientWidth >= row.scrollWidth - 8);
  });
}
document.addEventListener('scroll', (e) => { if (e.target.classList?.contains('row-scroll') || e.target.classList?.contains('grid-list')) updateArrows(); }, true);
window.addEventListener('resize', updateArrows);

// ---------------------------------------------------------------- library
async function renderLibrary(route, content, alive) {
  if (!state.signedIn) { content.innerHTML = signInPrompt('your library'); return; }
  const tab = route.tab || store.get('libraryTab', LIBRARY_TABS[0][0]);
  const tabs = `<h1 class="page-title">Library</h1><div class="tabs-row">${LIBRARY_TABS.map(([id, t]) => `<button class="${id === tab ? 'on' : ''}" data-libtab="${id}">${t}</button>`).join('')}</div>`;
  content.innerHTML = tabs + '<div class="spinner"></div>';
  const data = await api('browse', { browseId: tab });
  if (!alive()) return;
  const body = data.sections.map((s) => sectionHtml(s, { grid: s.style === 'cards' })).join('') || '<div class="empty"><h2>Nothing here yet</h2></div>';
  content.innerHTML = tabs + body;
  observeSentinels(content);
}

// ---------------------------------------------------------------- search page
function renderSearchPage(route, content, alive) {
  const recent = store.get('recentSearches', []);
  content.innerHTML = `<div class="search-page"><h1 class="page-title">Search</h1><div class="search-box">${ICON.search}<input id="search" type="search" placeholder="Artists, songs, albums, podcasts" autocomplete="off" spellcheck="false" value="${esc(route.query || '')}"><div id="suggestions" class="suggestions glass-menu hidden"></div></div><div id="search-results"></div></div>`;
  setupSearchInput();
  const input = $('#search');
  if (!route.query) {
    input.focus();
    $('#search-results').innerHTML = (recent.length ? `<div class="section-head"><h2>Recent Searches</h2><div class="actions"><a class="link-more" data-action="clear-recent">Clear</a></div></div><div class="recent">${recent.map((q) => `<button class="chip" data-search="${esc(q)}">${esc(q)}</button>`).join('')}</div>` : '')
      + '<div id="search-browse"></div>';
    api('browse', { browseId: 'FEmusic_moods_and_genres' }).then((d) => {
      if (!alive() || !$('#search-browse')) return;
      $('#search-browse').innerHTML = d.sections.slice(0, 2).map((s) => sectionHtml(s)).join('');
    }).catch(() => {});
    return;
  }
  setTitle(`“${route.query}”`);
  const box = $('#search-results');
  box.innerHTML = '<div class="spinner"></div>';
  api('search', { query: route.query, params: route.params }).then((data) => {
    if (!alive()) return;
    let html = '';
    if (data.chips.length) {
      html += `<div class="chips"><button class="chip ${route.params ? '' : 'on'}" data-search="${esc(route.query)}" data-sparams="">All</button>${data.chips.map((c) => `<button class="chip ${route.params && c.params === route.params ? 'on' : ''}" data-search="${esc(route.query)}" data-sparams="${esc(c.params || '')}">${esc(c.title)}</button>`).join('')}</div>`;
    }
    html += data.sections.map((s) => sectionHtml(s, { grid: s.style === 'cards' && !!route.params })).join('');
    if (!data.sections.length) html += '<div class="empty"><h2>No Results</h2><div>Try a different search.</div></div>';
    box.innerHTML = html;
    observeSentinels(box);
    updateArrows();
  }).catch((e) => { if (alive()) box.innerHTML = `<div class="empty"><h2>Search failed</h2><div>${esc(e.message)}</div></div>`; });
}

function doSearch(q, params) {
  q = (q || '').trim();
  if (!q) return;
  const recent = store.get('recentSearches', []).filter((x) => x.toLowerCase() !== q.toLowerCase());
  recent.unshift(q);
  store.set('recentSearches', recent.slice(0, 12));
  const r = currentRoute();
  navigate({ name: 'search', query: q, params }, r?.name === 'search' && !r.query);
}

let sugTimer = null;
let sugIndex = -1;
function setupSearchInput() {
  const input = $('#search');
  const box = $('#suggestions');
  const close = () => { box.classList.add('hidden'); sugIndex = -1; };
  input.addEventListener('input', () => {
    clearTimeout(sugTimer);
    const q = input.value.trim();
    if (!q) return close();
    sugTimer = setTimeout(async () => {
      try {
        const r = await api('suggestions', { input: q });
        if (input.value.trim() !== q) return;
        let html = r.queries.map((s) => `<div class="sug" data-q="${esc(s)}">${ICON.search}<span>${esc(s)}</span></div>`).join('');
        if (r.items.length) html += '<div class="sep"></div>' + r.items.map((it) => `<div class="sug" data-sitem="${reg(it)}"><img class="${it.kind === 'artist' ? 'round' : ''}" src="${esc(it.thumb)}" alt=""><div><div>${esc(it.title)}</div><div class="sub">${esc(it.subtitle)}</div></div></div>`).join('');
        box.innerHTML = html;
        box.classList.toggle('hidden', !html || document.activeElement !== input);
        sugIndex = -1;
      } catch (_) {}
    }, 140);
  });
  input.addEventListener('keydown', (e) => {
    const opts = $$('.sug', box);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (box.classList.contains('hidden') || !opts.length) return;
      e.preventDefault();
      sugIndex = (sugIndex + (e.key === 'ArrowDown' ? 1 : -1) + opts.length) % opts.length;
      opts.forEach((o, i) => o.classList.toggle('active', i === sugIndex));
      if (opts[sugIndex].dataset.q) input.value = opts[sugIndex].dataset.q;
    } else if (e.key === 'Enter') {
      const sel = opts[sugIndex];
      close();
      if (sel?.dataset.sitem) return openItem(registry.get(sel.dataset.sitem));
      doSearch(input.value);
    } else if (e.key === 'Escape') { close(); input.blur(); }
  });
  input.addEventListener('blur', () => setTimeout(close, 150));
  box.addEventListener('mousedown', (e) => {
    const s = e.target.closest('.sug');
    if (!s) return;
    e.preventDefault();
    close();
    if (s.dataset.sitem) openItem(registry.get(s.dataset.sitem));
    else doSearch(s.dataset.q);
  });
}

// ---------------------------------------------------------------- open / play items
function openItem(item) {
  if (!item) return;
  if (item.videoId) return player.playSingle(item);
  if (item.browseId) return navigate({ name: 'browse', browseId: item.browseId, params: item.params || undefined });
  if (item.playlistId) return player.playPlaylist(item.playlistId);
}

async function playCardItem(item) {
  if (item.videoId) return player.playSingle(item);
  if (item.playlistId) return player.playPlaylist(item.playlistId);
  if (item.kind === 'artist' && item.browseId) return startArtistRadio(item.browseId);
  if (item.browseId) navigate({ name: 'browse', browseId: item.browseId });
}
async function startArtistRadio(browseId) {
  try {
    const d = await api('browse', { browseId });
    const r = d.header?.radio || d.header?.shuffle;
    if (r) return player.playPlaylist(r.playlistId, { videoId: r.videoId, params: r.params });
  } catch (_) {}
  toast('No radio available for this artist');
}

// ---------------------------------------------------------------- player
const player = (() => {
  let queue = [];
  let index = -1;
  let shuffleMode = 'off'; // off | on | smart
  let repeat = 'off';
  let source = null;
  let position = 0;
  let duration = 0;
  let paused = true;
  let loading = false;
  let seeking = false;
  let likeStatus = 'INDIFFERENT';
  let loadSeq = 0;
  let unshuffled = null;
  let ad = false;
  const listeners = new Set();

  const current = () => queue[index] || null;
  const emit = (what) => listeners.forEach((fn) => fn(what));

  function pushMeta() {
    const item = current();
    K.player('meta', item ? { title: item.title, artist: artistName(item), album: item.album?.name || '', thumb: item.thumb, videoId: item.videoId, like: likeStatus } : null);
  }

  async function loadIndex(i, { autoplay = true, start = 0 } = {}) {
    if (i < 0 || i >= queue.length) return;
    if (autoplay) activeSource = 'music';
    index = i;
    const item = queue[i];
    const seq = ++loadSeq;
    loading = true;
    position = start;
    duration = item.duration || 0;
    likeStatus = item.likeStatus || 'INDIFFERENT';
    emit('track');
    if (!autoplay) { loading = false; paused = true; emit('state'); return; }
    pushMeta();
    await K.player('load', { videoId: item.videoId, start });
    if (seq !== loadSeq) return;
    persist();
    maybeExtend();
    if (shuffleMode === 'smart') smartTopUp();
    if (state.signedIn) {
      api('likeStatus', { videoId: item.videoId }).then((s) => { if (seq === loadSeq) { likeStatus = s; item.likeStatus = s; emit('like'); pushMeta(); } }).catch(() => {});
    }
  }

  async function maybeExtend() {
    if (!source?.continuation || index < queue.length - 3) return;
    const tok = source.continuation;
    source.continuation = null;
    try {
      const r = await api('next', { continuation: tok, playlistId: source.playlistId });
      const have = new Set(queue.map((q) => q.videoId));
      queue.push(...r.items.filter((x) => !have.has(x.videoId)));
      source.continuation = r.continuation;
      emit('queue');
    } catch (_) {}
  }

  const shuffleArr = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  function setQueue(items, start = 0, src = null) {
    queue = items.slice();
    unshuffled = null;
    source = src;
    if (shuffleMode !== 'off' && queue.length > 1) {
      unshuffled = items.slice();
      const first = queue.splice(start, 1)[0];
      shuffleArr(queue);
      queue.unshift(first);
      start = 0;
    }
    emit('queue');
    return loadIndex(start);
  }

  async function playSingle(item) {
    await setQueue([item], 0, null);
    try {
      const r = await api('next', { videoId: item.videoId, playlistId: 'RDAMVM' + item.videoId });
      if (current()?.videoId !== item.videoId) return;
      queue.push(...r.items.filter((x) => x.videoId !== item.videoId));
      source = { continuation: r.continuation, playlistId: r.playlistId || 'RDAMVM' + item.videoId };
      emit('queue');
      return r;
    } catch (_) {}
  }

  async function playPlaylist(playlistId, opts = {}) {
    try {
      const r = await api('next', { playlistId, videoId: opts.videoId, params: opts.params });
      if (!r.items.length) return toast('Nothing to play');
      if (opts.shuffle) shuffleArr(r.items);
      await setQueue(r.items, opts.shuffle ? 0 : Math.max(0, r.currentIndex), { continuation: r.continuation, playlistId: r.playlistId || playlistId });
    } catch (e) {
      toast("Couldn't start playback: " + e.message);
    }
  }

  function playList(items, start, src) {
    const ok = items.filter((x) => x.videoId && !x.unavailable);
    return setQueue(ok, Math.max(0, ok.indexOf(items[start])), src);
  }

  async function next(auto = false) {
    if (auto && repeat === 'one') return loadIndex(index);
    if (index < queue.length - 1) return loadIndex(index + 1);
    if (source?.continuation) { await maybeExtend(); if (index < queue.length - 1) return loadIndex(index + 1); }
    if (repeat === 'all' && queue.length) return loadIndex(0);
    if (current() && state.settings.autoplay !== false) {
      const last = current();
      try {
        const r = await api('next', { videoId: last.videoId, playlistId: 'RDAMVM' + last.videoId });
        const have = new Set(queue.map((q) => q.videoId));
        const add = r.items.filter((x) => !have.has(x.videoId));
        if (add.length) { queue.push(...add); source = { continuation: r.continuation, playlistId: r.playlistId }; emit('queue'); return loadIndex(index + 1); }
      } catch (_) {}
    }
  }

  function previous() {
    if (position > 3 || index <= 0) { seekTo(0); return; }
    loadIndex(index - 1);
  }

  function toggle() {
    if (!current()) return;
    activeSource = 'music';
    if (paused) {
      if (loading === 'restored') { loading = false; return loadIndex(index, { start: position }); }
      K.player('play');
    } else K.player('pause');
  }

  function onEvent(msg) {
    if (msg.type === 'state') {
      if (!msg.ready) return;
      const cur = current();
      if (!cur || loading === 'restored' || msg.expected !== cur.videoId) return;
      if (msg.videoId === cur.videoId && !msg.ad) {
        if (!seeking) position = msg.time;
        if (msg.duration > 0) duration = msg.duration;
        if (loading && (msg.state === 1 || msg.state === 2)) loading = false;
      }
      const p = !!msg.paused;
      const changed = p !== paused || !!msg.ad !== ad || (loading && msg.state === 1);
      paused = p;
      ad = !!msg.ad;
      if (changed) emit('state');
      emit('time');
    } else if (msg.type === 'ended') {
      if (msg.videoId === current()?.videoId) next(true);
    } else if (msg.type === 'error') {
      if (msg.videoId === current()?.videoId) { toast(`“${current().title}” isn't available. Skipping.`); next(true); }
    } else if (msg.type === 'media') {
      handleCommand({ play: 'play', pause: 'pause', nexttrack: 'next', previoustrack: 'previous', stop: 'pause' }[msg.action] || msg.action, msg);
    }
  }

  function seekTo(t) { position = Math.max(0, t); K.player('seek', position); emit('time'); }

  function addNext(items) {
    items = [].concat(items).filter((x) => x.videoId);
    if (!queue.length) return setQueue(items, 0);
    queue.splice(index + 1, 0, ...items);
    emit('queue');
    toast(items.length === 1 ? `“${items[0].title}” will play next` : `${items.length} songs will play next`);
  }
  function addEnd(items) {
    items = [].concat(items).filter((x) => x.videoId);
    if (!queue.length) return setQueue(items, 0);
    queue.push(...items);
    emit('queue');
    toast(items.length === 1 ? `Added “${items[0].title}” to queue` : `Added ${items.length} songs to queue`);
  }
  function removeAt(i) { if (i === index) return; queue.splice(i, 1); if (i < index) index--; emit('queue'); }
  function move(from, to) {
    if (from === to) return;
    const [it] = queue.splice(from, 1);
    queue.splice(to, 0, it);
    if (index === from) index = to;
    else if (from < index && to >= index) index--;
    else if (from > index && to <= index) index++;
    emit('queue');
  }
  function clearUpcoming() { queue.splice(index + 1); source = null; emit('queue'); }

  // Smart Shuffle (as in Kaset): shuffle, plus suggestions based on what's playing
  // blended into Up Next every N songs, keeping M suggestions queued ahead.
  let smartPool = [];
  async function smartTopUp() {
    const cur = current();
    if (!cur || shuffleMode !== 'smart') return;
    const every = Number(state.settings.smartShuffleEvery) || 3;
    const ahead = Number(state.settings.smartShuffleAhead) || 3;
    const upcoming = queue.slice(index + 1);
    const have = upcoming.filter((q) => q.suggested).length;
    if (have >= ahead) return;
    if (smartPool.length < ahead - have) {
      try {
        const r = await api('next', { videoId: cur.videoId, playlistId: 'RDAMVM' + cur.videoId });
        const known = new Set(queue.map((q) => q.videoId).concat(smartPool.map((q) => q.videoId)));
        smartPool.push(...shuffleArr(r.items.filter((x) => !known.has(x.videoId)).map((x) => ({ ...x, suggested: true }))));
      } catch (_) { return; }
      if (shuffleMode !== 'smart') return;
    }
    // Walk upcoming tracks; after every `every` regular songs, make sure a suggestion follows.
    let need = ahead - have;
    let run = 0;
    for (let p = index + 1; p <= queue.length && need > 0 && smartPool.length; p++) {
      const it = queue[p];
      if (it?.suggested) { run = 0; continue; }
      if (run >= every || p === queue.length) {
        queue.splice(p, 0, smartPool.shift());
        need--; run = 0;
        continue;
      }
      run++;
    }
    emit('queue');
  }

  function cycleShuffle() {
    const prev = shuffleMode;
    shuffleMode = prev === 'off' ? 'on' : prev === 'on' ? 'smart' : 'off';
    if (prev === 'off') {
      unshuffled = queue.slice();
      queue = [...queue.slice(0, index + 1), ...shuffleArr(queue.slice(index + 1))];
    }
    if (shuffleMode === 'smart') { smartPool = []; smartTopUp(); toast('Smart Shuffle — suggestions blended into Up Next'); }
    if (shuffleMode === 'off') {
      const cur = current();
      queue = queue.filter((q) => !q.suggested || q === cur);
      if (unshuffled) {
        const keep = new Set(queue);
        const restored = unshuffled.filter((q) => keep.has(q));
        if (cur && !restored.includes(cur)) restored.unshift(cur);
        queue = restored;
      }
      index = Math.max(0, queue.indexOf(cur));
      unshuffled = null;
    }
    emit('queue'); emit('modes');
  }
  function cycleRepeat() { repeat = repeat === 'off' ? 'all' : repeat === 'all' ? 'one' : 'off'; emit('modes'); }

  async function rate(target) {
    const cur = current();
    if (!cur) return;
    if (!state.signedIn) return toast('Sign in to rate songs');
    const nextStatus = likeStatus === target ? 'INDIFFERENT' : target;
    likeStatus = nextStatus; cur.likeStatus = nextStatus; emit('like'); pushMeta();
    try {
      await api('rate', { videoId: cur.videoId, status: nextStatus });
      pageCache.delete(JSON.stringify({ name: 'liked' }));
      if (nextStatus === 'LIKE') toast('Added to Liked Music');
      else if (nextStatus === 'DISLIKE') { toast("Got it — you'll hear less like this"); next(); }
    } catch (e) { toast("Couldn't update rating: " + e.message); }
  }

  let persistTimer = null;
  function persist() {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      const slim = queue.slice(Math.max(0, index - 50), index + 200).map((q) => ({ kind: q.kind, videoId: q.videoId, title: q.title, subtitle: q.subtitle, artists: q.artists, album: q.album, thumb: q.thumb, duration: q.duration, durationText: q.durationText }));
      K.setSettings({ lastQueue: { items: slim, index: Math.min(index, 50), position, source } });
    }, 1000);
  }
  setInterval(() => { if (!paused && current()) persist(); }, 15000);

  function restore(saved) {
    if (!saved?.items?.length || state.settings.resumeOnLaunch === false) return;
    queue = saved.items;
    index = Math.min(saved.index || 0, queue.length - 1);
    source = saved.source || null;
    position = saved.position || 0;
    duration = queue[index].duration || 0;
    loading = 'restored';
    paused = true;
    emit('queue'); emit('track'); emit('time');
    pushMeta();
  }

  return {
    current, playSingle, playPlaylist, playList, next, previous, toggle, onEvent, seekTo, addNext, addEnd, removeAt, move, clearUpcoming,
    cycleShuffle, cycleRepeat, rate, restore, loadIndex, pushMeta, emit,
    on: (fn) => listeners.add(fn),
    get queue() { return queue; }, get index() { return index; }, get position() { return position; }, get duration() { return duration; },
    get paused() { return paused; }, get loading() { return !!loading && loading !== 'restored'; }, get shuffle() { return shuffleMode; }, get repeat() { return repeat; },
    get likeStatus() { return likeStatus; }, get ad() { return ad; },
    set seeking(v) { seeking = v; },
  };
})();

function artistName(item) {
  if (item.artists?.length && item.artists[0].name) return item.artists.map((a) => a.name).join(', ');
  return (item.subtitle || '').split(' • ')[0];
}

// ---------------------------------------------------------------- player bar UI
const setRange = (el, v, max) => el.style.setProperty('--p', `${max ? (v / max) * 100 : 0}%`);
function setupPlayerBar() {
  const vol = $('#volume');
  $('#playpause').onclick = () => player.toggle();
  $('#next').onclick = () => player.next();
  $('#prev').onclick = () => player.previous();
  $('#shuffle').onclick = () => player.cycleShuffle();
  $('#repeat').onclick = () => player.cycleRepeat();
  $('#like').onclick = () => player.rate('LIKE');
  $('#dislike').onclick = () => player.rate('DISLIKE');
  $('#btn-queue').onclick = () => togglePanel('queue');
  $('#btn-lyrics').onclick = () => togglePanel('lyrics');
  $('#btn-eq').onclick = () => openSettings('eq');
  $('#btn-mini').onclick = () => K.player('mini', true);
  $('#panel-close').onclick = () => togglePanel(null);
  $('#cmd-btn').onclick = openCommandBar;
  let videoShown = false;
  $('#btn-video').onclick = () => { videoShown = !videoShown; K.player('showVideo', videoShown); $('#btn-video').classList.toggle('on', videoShown); };
  K.onVideoVisible((v) => { videoShown = v; $('#btn-video').classList.toggle('on', v); });
  $('#np-art').onclick = openNowPlaying;
  $('#np-title').onclick = () => { const c = player.current(); if (c?.album?.id) navigate({ name: 'browse', browseId: c.album.id }); else openNowPlaying(); };

  const lane = $('#progress .track-lane'); // the music bar's lane, not the YouTube bar's #yt-lane
  const frac = (e) => { const r = lane.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); };
  const show = (f) => { $('#lane-fill').style.width = f * 100 + '%'; $('#lane-knob').style.left = f * 100 + '%'; };
  lane.addEventListener('pointerdown', (e) => {
    if (!player.duration) return;
    lane.setPointerCapture(e.pointerId);
    lane.classList.add('drag');
    player.seeking = true;
    const move = (ev) => { const f = frac(ev); show(f); $('#time-cur').textContent = fmt(f * player.duration); };
    move(e);
    const up = (ev) => { lane.removeEventListener('pointermove', move); lane.removeEventListener('pointerup', up); lane.classList.remove('drag'); player.seeking = false; player.seekTo(frac(ev) * player.duration); };
    lane.addEventListener('pointermove', move);
    lane.addEventListener('pointerup', up);
  });

  let lastVol = state.settings.volume ?? 80;
  vol.value = lastVol;
  setRange(vol, vol.value, 100);
  const applyVol = (v) => { vol.value = v; setRange(vol, v, 100); K.player('volume', v); $('#vol-waves').style.opacity = v == 0 ? 0 : 1; vol.title = `Volume ${v}%`; };
  vol.addEventListener('input', () => applyVol(Number(vol.value)));
  $('#mute').onclick = () => { if (Number(vol.value) > 0) { lastVol = Number(vol.value); applyVol(0); } else applyVol(lastVol || 60); };
  $('#playerbar').addEventListener('wheel', (e) => { if (e.target.closest('.vol')) { e.preventDefault(); applyVol(Math.max(0, Math.min(100, Number(vol.value) + (e.deltaY < 0 ? 5 : -5)))); } }, { passive: false });
  window.__applyVol = applyVol;

  player.on((what) => {
    const cur = player.current();
    if (what === 'track') {
      $('#np-title').textContent = cur?.title || '';
      $('#np-artist').innerHTML = cur ? subtitleHtml(cur) : '';
      $('#np-art').src = cur?.thumb || '';
      $$('.track').forEach((t) => { const it = registry.get(t.dataset.item); t.classList.toggle('playing', !!(it && cur && it.videoId === cur.videoId)); });
      if (panel === 'lyrics' || (fsOpen && fsTab === 'lyrics')) loadLyrics();
      if (panel === 'queue') renderQueue();
      updateNowPlaying();
    }
    if (what === 'queue') { if (panel === 'queue') renderQueue(); if (fsOpen && fsTab === 'queue') renderFsRight(); }
    if (what === 'state' || what === 'track') {
      const d = player.paused ? 'M7 4.5v15l12.5-7.5z' : 'M6.5 4.5h3.8v15H6.5zM13.7 4.5h3.8v15h-3.8z';
      $('#pp-path').setAttribute('d', d);
      $('#fs-pp').setAttribute('d', d);
      $('#nowplaying').classList.toggle('paused', player.paused);
      $('#playpause').title = player.paused ? 'Play (Space)' : 'Pause (Space)';
      $('#playpause').classList.toggle('loading', player.loading);
      $('#progress .track-lane').classList.toggle('loading', player.loading && !player.ad);
      if (player.ad) $('#np-artist').innerHTML = '<span class="ad">Ad</span> · Your music will continue shortly';
      else if (cur) $('#np-artist').innerHTML = subtitleHtml(cur);
    }
    if (what === 'time' || what === 'track') {
      if (!$('#progress .track-lane').classList.contains('drag')) {
        const f = player.duration ? player.position / player.duration : 0;
        $('#lane-fill').style.width = f * 100 + '%';
        $('#lane-knob').style.left = f * 100 + '%';
        $('#time-cur').textContent = fmt(player.position);
        const fs = $('#fs-seek');
        if (!fs.matches(':active')) { fs.value = Math.round(f * 1000); setRange(fs, fs.value, 1000); $('#fs-cur').textContent = fmt(player.position); }
      }
      $('#time-dur').textContent = fmt(player.duration);
      $('#fs-dur').textContent = fmt(player.duration);
      syncLyrics();
    }
    if (what === 'modes') {
      const sh = player.shuffle;
      $('#shuffle').classList.toggle('on', sh !== 'off');
      $('#shuffle').title = sh === 'off' ? 'Shuffle (Ctrl+S)' : sh === 'on' ? 'Shuffle on — click again for Smart Shuffle' : 'Smart Shuffle on';
      $('#smart-badge').classList.toggle('hidden', sh !== 'smart');
      $('#repeat').classList.toggle('on', player.repeat !== 'off');
      $('#repeat-one').classList.toggle('hidden', player.repeat !== 'one');
      $('[data-cmd="shuffle"]').classList.toggle('on', sh !== 'off');
      $('[data-cmd="repeat"]').classList.toggle('on', player.repeat !== 'off');
    }
    if (what === 'like' || what === 'track') {
      $('#like').classList.toggle('on', player.likeStatus === 'LIKE');
      $('#dislike').classList.toggle('on', player.likeStatus === 'DISLIKE');
    }
  });
}

// ---------------------------------------------------------------- side panel
let panel = null;
function togglePanel(which) {
  panel = panel === which ? null : which;
  $('#sidepanel').classList.toggle('hidden', !panel);
  $$('.panel-tabs .tab').forEach((t) => t.classList.toggle('on', t.dataset.panel === panel));
  $('#btn-queue').classList.toggle('on', panel === 'queue');
  $('#btn-lyrics').classList.toggle('on', panel === 'lyrics');
  if (panel === 'queue') renderQueue();
  if (panel === 'lyrics') loadLyrics();
}

function queueHtml() {
  const q = player.queue;
  if (!q.length || !q[player.index]) return '<div class="empty" style="padding:40px 10px">Nothing in the queue.<br>Play something to get started.</div>';
  const row = (it, i) => `<div class="q-item ${i === player.index ? 'current' : i < player.index ? 'past' : ''}" draggable="${i !== player.index}" data-qi="${i}">
      <img src="${esc(it.thumb || '')}" alt="" loading="lazy"><div style="min-width:0"><div class="tt">${esc(it.title)}${it.suggested ? '<span class="sugg" title="Smart Shuffle suggestion">✦</span>' : ''}</div><div class="ta">${esc(artistName(it))}</div></div>
      ${i === player.index ? `<span class="ta">${esc(it.durationText || '')}</span>` : `<button class="icon-btn small rm" data-qrm="${i}" title="Remove">${ICON.x}</button>`}</div>`;
  const start = Math.max(0, player.index - 3);
  const past = q.slice(start, player.index).map((it, k) => row(it, start + k)).join('');
  return `${past}<div class="q-head"><span>Now Playing</span></div>${row(q[player.index], player.index)}
    <div class="q-head"><span>Up Next${player.shuffle === 'smart' ? ' · Smart Shuffle' : ''}</span>${q.length > player.index + 1 ? '<button class="link-more" data-qclear>Clear</button>' : ''}</div>
    ${q.slice(player.index + 1).map((it, k) => row(it, player.index + 1 + k)).join('')}`;
}
function renderQueue() {
  const body = $('#panel-body');
  body.innerHTML = queueHtml();
  body.querySelector('.q-item.current')?.scrollIntoView({ block: 'nearest' });
}

function setupQueueInteractions(body) {
  let dragFrom = null;
  body.addEventListener('dragstart', (e) => { const el = e.target.closest('.q-item'); if (!el) return; dragFrom = Number(el.dataset.qi); e.dataTransfer.effectAllowed = 'move'; });
  body.addEventListener('dragover', (e) => { const el = e.target.closest('.q-item'); if (dragFrom == null || !el) return; e.preventDefault(); $$('.q-item.drag-over', body).forEach((x) => x.classList.remove('drag-over')); el.classList.add('drag-over'); });
  body.addEventListener('drop', (e) => { const el = e.target.closest('.q-item'); if (dragFrom == null || !el) return; e.preventDefault(); let to = Number(el.dataset.qi); if (to <= player.index) to = player.index + 1; if (dragFrom < to) to--; player.move(dragFrom, to); dragFrom = null; });
  body.addEventListener('dragend', () => { dragFrom = null; $$('.q-item.drag-over', body).forEach((x) => x.classList.remove('drag-over')); });
  body.addEventListener('click', (e) => {
    if (e.target.closest('[data-qclear]')) return player.clearUpcoming();
    const rm = e.target.closest('[data-qrm]');
    if (rm) return player.removeAt(Number(rm.dataset.qrm));
    const it = e.target.closest('.q-item');
    if (it) return player.loadIndex(Number(it.dataset.qi));
    const ln = e.target.closest('.ln');
    if (ln && ln.dataset.t) player.seekTo(Number(ln.dataset.t));
  });
}

// ---------------------------------------------------------------- lyrics
let lyricState = { videoId: null, lines: null, html: null };
function lyricTargets() {
  const t = [];
  if (panel === 'lyrics') t.push($('#panel-body'));
  if (fsOpen && fsTab === 'lyrics') t.push($('#fs-right'));
  return t;
}
async function loadLyrics() {
  if (!lyricTargets().length) return;
  const cur = player.current();
  const put = (html) => lyricTargets().forEach((t) => { t.innerHTML = html; });
  if (!cur) return put('<div class="empty" style="padding:40px 10px">Play a song to see its lyrics.</div>');
  if (lyricState.videoId === cur.videoId && lyricState.html) { put(lyricState.html); syncLyrics(true); return; }
  const vid = cur.videoId;
  lyricState = { videoId: vid, lines: null, html: null };
  put('<div class="spinner sm"></div>');
  try {
    const l = await api('lyrics', { videoId: vid, title: cur.title, artist: cur.artists?.[0]?.name || artistName(cur), album: cur.album?.name, duration: player.duration || cur.duration });
    if (player.current()?.videoId !== vid) return;
    let html;
    if (l.synced) {
      lyricState.lines = parseLRC(l.synced);
      html = `<div class="lyrics synced">${lyricState.lines.map((x, i) => `<div class="ln" data-i="${i}" data-t="${x.t}">${esc(x.text || '♪')}</div>`).join('')}<div class="src">Lyrics from ${esc(l.source)}</div></div>`;
    } else if (l.plain) {
      html = `<div class="lyrics plain">${esc(l.plain)}<div class="src">${esc(l.source)}</div></div>`;
    } else {
      html = '<div class="empty" style="padding:40px 10px">No lyrics available for this song.</div>';
    }
    lyricState.html = html;
    put(html);
    syncLyrics(true);
  } catch (e) {
    put('<div class="empty" style="padding:40px 10px">Couldn\'t load lyrics.</div>');
  }
}
function parseLRC(text) {
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const tags = [...line.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    if (!tags.length) continue;
    const txt = line.replace(/\[[^\]]*\]/g, '').trim();
    for (const m of tags) out.push({ t: Number(m[1]) * 60 + Number(m[2]), text: txt });
  }
  return out.sort((a, b) => a.t - b.t);
}
let lastLyric = -1;
function syncLyrics(force) {
  if (!lyricState.lines || lyricState.videoId !== player.current()?.videoId) return;
  const t = player.position + 0.25;
  let i = -1;
  for (let k = 0; k < lyricState.lines.length; k++) { if (lyricState.lines[k].t <= t) i = k; else break; }
  if (i === lastLyric && !force) return;
  lastLyric = i;
  for (const root of lyricTargets()) {
    $$('.lyrics .ln', root).forEach((el) => el.classList.toggle('on', Number(el.dataset.i) === i));
    const el = $(`.lyrics .ln[data-i="${i}"]`, root);
    if (el) el.scrollIntoView({ block: 'center', behavior: force ? 'auto' : 'smooth' });
  }
}

// ---------------------------------------------------------------- full-screen Now Playing
let fsOpen = false;
let fsTab = store.get('fsTab', 'lyrics');
function openNowPlaying() {
  if (!player.current()) return;
  fsOpen = true;
  $('#nowplaying').classList.remove('hidden');
  setFsTab(fsTab);
  updateNowPlaying();
}
function closeNowPlaying() { if (!fsOpen) return; fsOpen = false; $('#nowplaying').classList.add('hidden'); }
function setFsTab(t) {
  fsTab = t; store.set('fsTab', t);
  $$('.fs-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.fs === t));
  $('.fs-body').classList.toggle('solo', t === 'none');
  renderFsRight();
}
function renderFsRight() {
  if (!fsOpen) return;
  if (fsTab === 'lyrics') {
    if (lyricState.html && lyricState.videoId === player.current()?.videoId) { $('#fs-right').innerHTML = lyricState.html; syncLyrics(true); }
    else loadLyrics();
  } else if (fsTab === 'queue') { $('#fs-right').innerHTML = `<div style="padding:10vh 0">${queueHtml()}</div>`; }
}
function updateNowPlaying() {
  const c = player.current();
  if (!c) return;
  const big = (c.thumb || '').replace(/=w\d+-h\d+[^&]*$/, '=w1200-h1200-l90-rj').replace(/=s\d+$/, '=s1200');
  $('#fs-art').src = big;
  $('#fs-bg').style.backgroundImage = `url('${big}')`;
  $('#fs-title').textContent = c.title;
  $('#fs-artist').textContent = artistName(c);
  if (fsOpen) renderFsRight();
}
function setupNowPlaying() {
  $('#fs-close').onclick = closeNowPlaying;
  $$('.fs-tabs button').forEach((b) => (b.onclick = () => setFsTab(b.dataset.fs)));
  $('#nowplaying').addEventListener('click', (e) => {
    const c = e.target.closest('[data-cmd]');
    if (!c) return;
    const cmd = c.dataset.cmd;
    if (cmd === 'shuffle') player.cycleShuffle();
    else if (cmd === 'repeat') player.cycleRepeat();
    else handleCommand(cmd);
  });
  const fs = $('#fs-seek');
  fs.addEventListener('input', () => { player.seeking = true; setRange(fs, fs.value, 1000); $('#fs-cur').textContent = fmt((fs.value / 1000) * player.duration); });
  fs.addEventListener('change', () => { player.seeking = false; player.seekTo((fs.value / 1000) * player.duration); });
  setupQueueInteractions($('#fs-right'));
  $('.fs-top').addEventListener('dblclick', (e) => { if (!e.target.closest('button')) K.toggleFullscreen(); });
}

// ---------------------------------------------------------------- context menus
function showMenu(x, y, entries) {
  const m = $('#ctxmenu');
  m.innerHTML = entries.map((e, i) => e === '-' ? '<div class="sep"></div>' : e.header ? `<div class="sub-title">${esc(e.header)}</div>` : `<div class="mi ${e.danger ? 'danger' : ''}" data-mi="${i}">${esc(e.label)}</div>`).join('');
  m.classList.remove('hidden');
  const r = m.getBoundingClientRect();
  m.style.left = Math.max(8, Math.min(x, innerWidth - r.width - 8)) + 'px';
  m.style.top = Math.max(8, Math.min(y, innerHeight - r.height - 8)) + 'px';
  m.onclick = (e) => { const mi = e.target.closest('[data-mi]'); if (!mi) return; hideMenu(); entries[Number(mi.dataset.mi)].fn(); };
}
function hideMenu() { $('#ctxmenu').classList.add('hidden'); }
const copy = (text, msg = 'Link copied') => { navigator.clipboard.writeText(text); toast(msg); };
const linkFor = (item) => item.videoId ? `https://music.youtube.com/watch?v=${item.videoId}`
  : item.kind === 'artist' ? `https://music.youtube.com/channel/${item.browseId}`
  : item.playlistId && item.kind !== 'album' ? `https://music.youtube.com/playlist?list=${item.playlistId}`
  : item.browseId?.startsWith('VL') ? `https://music.youtube.com/playlist?list=${item.browseId.slice(2)}`
  : `https://music.youtube.com/browse/${item.browseId}`;

function addToPlaylistEntries(videoIds) {
  const out = [];
  if (!state.signedIn) return out;
  out.push('-', { header: 'Add to Playlist' }, { label: 'New Playlist…', fn: () => createPlaylistDialog(videoIds) });
  for (const p of state.libraryPlaylists.slice(0, 15)) {
    out.push({ label: p.title, fn: async () => { try { await api('addToPlaylist', { playlistId: p.browseId, videoIds }); toast(`Added to ${p.title}`); pageCache.clear(); } catch (e) { toast("Couldn't add: " + e.message); } } });
  }
  return out;
}

function itemMenu(item, x, y) {
  const entries = [];
  if (item.videoId) {
    entries.push({ label: 'Play', fn: () => player.playSingle(item) });
    entries.push({ label: 'Play Next', fn: () => player.addNext(item) });
    entries.push({ label: 'Add to Queue', fn: () => player.addEnd(item) });
    entries.push({ label: 'Start Radio', fn: () => player.playPlaylist('RDAMVM' + item.videoId, { videoId: item.videoId }) });
    entries.push('-');
    if (item.artists?.[0]?.id) entries.push({ label: 'Go to Artist', fn: () => navigate({ name: 'browse', browseId: item.artists[0].id }) });
    if (item.album?.id) entries.push({ label: 'Go to Album', fn: () => navigate({ name: 'browse', browseId: item.album.id }) });
    if (state.signedIn) {
      entries.push({ label: item.likeStatus === 'LIKE' ? 'Remove from Liked Music' : 'Add to Liked Music', fn: async () => {
        const s = item.likeStatus === 'LIKE' ? 'INDIFFERENT' : 'LIKE';
        try { await api('rate', { videoId: item.videoId, status: s }); item.likeStatus = s; toast(s === 'LIKE' ? 'Added to Liked Music' : 'Removed from Liked Music'); pageCache.clear(); } catch (e) { toast(e.message); }
      } });
      if (currentHeader?.editable && item.playlistSetVideoId) {
        entries.push({ label: 'Remove from This Playlist', danger: true, fn: async () => {
          try { await api('removeFromPlaylist', { playlistId: currentHeader.playlistId || currentHeader.browseId, videoId: item.videoId, setVideoId: item.playlistSetVideoId }); toast('Removed from playlist'); pageCache.clear(); render(); } catch (e) { toast(e.message); }
        } });
      }
    }
    entries.push(...addToPlaylistEntries([item.videoId]));
    entries.push('-', { label: 'Copy Link', fn: () => copy(linkFor(item)) });
  } else {
    if (item.browseId) entries.push({ label: 'Open', fn: () => openItem(item) });
    if (item.playlistId) {
      entries.push({ label: 'Play', fn: () => player.playPlaylist(item.playlistId) });
      entries.push({ label: 'Shuffle', fn: () => player.playPlaylist(item.playlistId, { shuffle: true }) });
      entries.push({ label: 'Play Next', fn: async () => { const r = await api('next', { playlistId: item.playlistId }); player.addNext(r.items); } });
      entries.push({ label: 'Add to Queue', fn: async () => { const r = await api('next', { playlistId: item.playlistId }); player.addEnd(r.items); } });
    }
    if (item.kind === 'artist') entries.push({ label: 'Start Radio', fn: () => startArtistRadio(item.browseId) });
    if (item.browseId) entries.push('-', { label: 'Copy Link', fn: () => copy(linkFor(item)) });
  }
  if (entries.length) showMenu(x, y, entries);
}

function headerMenu(h, x, y) {
  const entries = [];
  if (h.kind === 'artist-header') {
    if (h.radio) entries.push({ label: 'Start Radio', fn: () => heroAction('radio', h) });
    entries.push({ label: 'Copy Link', fn: () => copy(`https://music.youtube.com/channel/${h.browseId}`) });
  } else {
    const tracks = h.tracks.filter((t) => !t.unavailable);
    entries.push({ label: 'Play Next', fn: () => player.addNext(tracks) });
    entries.push({ label: 'Add to Queue', fn: () => player.addEnd(tracks) });
    if (h.radioPlaylistId) entries.push({ label: 'Start Radio', fn: () => player.playPlaylist(h.radioPlaylistId) });
    entries.push(...addToPlaylistEntries(tracks.map((t) => t.videoId)));
    entries.push('-', { label: 'Copy Link', fn: () => copy(h.playlistId && !/^MPRE/.test(h.browseId) ? `https://music.youtube.com/playlist?list=${h.playlistId}` : `https://music.youtube.com/browse/${h.browseId}`) });
    if (h.editable) entries.push('-', { label: 'Delete Playlist…', danger: true, fn: () => deletePlaylistDialog(h) });
  }
  showMenu(x, y, entries);
}

// ---------------------------------------------------------------- dialogs
function closeModal() { $('#modal-root').innerHTML = ''; }
function modal(html, { wide = false } = {}) {
  $('#modal-root').innerHTML = `<div class="modal-backdrop" data-close><div class="modal" role="dialog" ${wide ? 'style="width:620px"' : ''}>${html}</div></div>`;
  const root = $('#modal-root');
  root.querySelector('[data-close]').addEventListener('mousedown', (e) => { if (e.target.matches('[data-close]')) closeModal(); });
  return root.querySelector('.modal');
}
function createPlaylistDialog(videoIds = []) {
  if (!state.signedIn) return toast('Sign in to create playlists');
  const m = modal(`<h2>New Playlist</h2>
    <input class="field" id="pl-title" placeholder="Playlist name" maxlength="150">
    <h3>Description</h3><input class="field" id="pl-desc" placeholder="Optional" maxlength="300">
    <h3>Privacy</h3><select class="field" id="pl-priv"><option value="PRIVATE">Private</option><option value="UNLISTED">Unlisted</option><option value="PUBLIC">Public</option></select>
    <div class="foot"><span></span><div style="display:flex;gap:8px"><button class="btn" data-x>Cancel</button><button class="btn primary" data-ok>Create</button></div></div>`);
  $('#pl-title').focus();
  m.querySelector('[data-x]').onclick = closeModal;
  const ok = async () => {
    const title = $('#pl-title').value.trim();
    if (!title) return $('#pl-title').focus();
    try {
      const id = await api('createPlaylist', { title, description: $('#pl-desc').value.trim(), privacyStatus: $('#pl-priv').value, videoIds });
      closeModal();
      toast(`Created “${title}”`);
      await loadSidebarPlaylists();
      if (!videoIds.length && id) navigate({ name: 'browse', browseId: 'VL' + id });
    } catch (e) { toast("Couldn't create playlist: " + e.message); }
  };
  m.querySelector('[data-ok]').onclick = ok;
  $('#pl-title').addEventListener('keydown', (e) => { if (e.key === 'Enter') ok(); });
}
function deletePlaylistDialog(h) {
  const m = modal(`<h2>Delete “${esc(h.title)}”?</h2><div style="color:var(--text-2)">This playlist will be permanently deleted from your YouTube Music account.</div>
    <div class="foot"><span></span><div style="display:flex;gap:8px"><button class="btn" data-x>Cancel</button><button class="btn primary" data-ok style="background:#ff453a">Delete</button></div></div>`);
  m.querySelector('[data-x]').onclick = closeModal;
  m.querySelector('[data-ok]').onclick = async () => {
    try { await api('deletePlaylist', { playlistId: h.playlistId || h.browseId }); closeModal(); toast('Playlist deleted'); pageCache.clear(); await loadSidebarPlaylists(); navigate({ name: 'library' }, true); }
    catch (e) { toast("Couldn't delete: " + e.message); }
  };
}

// ---------------------------------------------------------------- command bar
function openCommandBar() {
  const commands = [
    { label: 'Play / Pause', k: 'Space', run: () => player.toggle() },
    { label: 'Next Track', k: 'Ctrl+→', run: () => player.next() },
    { label: 'Previous Track', k: 'Ctrl+←', run: () => player.previous() },
    { label: 'Toggle Shuffle', k: 'Ctrl+S', run: () => player.cycleShuffle() },
    { label: 'Cycle Repeat', k: 'Ctrl+R', run: () => player.cycleRepeat() },
    { label: 'Like Current Song', k: 'Ctrl+L', run: () => player.rate('LIKE') },
    { label: 'Show Lyrics', k: 'Ctrl+Shift+L', run: () => togglePanel('lyrics') },
    { label: 'Show Up Next', k: 'Ctrl+Shift+Q', run: () => togglePanel('queue') },
    { label: 'Now Playing', run: openNowPlaying },
    { label: 'Mini Player', k: 'Ctrl+Shift+M', run: () => K.player('mini', true) },
    { label: 'Equalizer', run: () => openSettings('eq') },
    { label: 'Go to Home', k: 'Ctrl+1', run: () => navigate({ name: 'home' }) },
    { label: 'Go to Explore', k: 'Ctrl+2', run: () => navigate({ name: 'explore' }) },
    { label: 'Go to Library', k: 'Ctrl+3', run: () => navigate({ name: 'library' }) },
    { label: 'Go to Charts', run: () => navigate({ name: 'charts' }) },
    { label: 'Go to Moods & Genres', run: () => navigate({ name: 'moods' }) },
    { label: 'Go to New Releases', run: () => navigate({ name: 'newReleases' }) },
    { label: 'Go to Liked Music', run: () => navigate({ name: 'liked' }) },
    { label: 'Go to History', run: () => navigate({ name: 'history' }) },
    { label: 'New Playlist', run: () => createPlaylistDialog() },
    { label: 'Settings', k: 'Ctrl+,', run: () => openSettings() },
    { label: 'Refresh Home', k: 'Ctrl+Shift+R', run: () => { pageCache.clear(); navigate({ name: 'home' }); } },
  ];
  const m = modal(`<div class="cmd-input">${ICON.sparkle}<input id="cmd-q" placeholder="Search music or type a command…" autocomplete="off" spellcheck="false"></div><div class="cmd-list" id="cmd-list"></div>`);
  m.classList.add('cmdbar');
  const input = $('#cmd-q');
  const list = $('#cmd-list');
  let rows = [];
  let active = 0;
  let searchSeq = 0;
  const draw = () => {
    list.innerHTML = rows.map((r, i) => `<div class="cmd ${i === active ? 'active' : ''}" data-ci="${i}">${r.thumb ? `<img src="${esc(r.thumb)}" alt="" style="${r.round ? 'border-radius:50%' : ''}">` : `<span class="ico">${r.icon || ICON.sparkle}</span>`}<div style="min-width:0"><div>${esc(r.label)}</div>${r.sub ? `<div class="sub">${esc(r.sub)}</div>` : ''}</div>${r.k ? `<span class="k">${esc(r.k)}</span>` : ''}</div>`).join('') || '<div class="empty" style="padding:24px">No matches</div>';
    list.querySelector('.cmd.active')?.scrollIntoView({ block: 'nearest' });
  };
  const update = () => {
    const q = input.value.trim().toLowerCase();
    rows = commands.filter((c) => !q || c.label.toLowerCase().includes(q)).slice(0, q ? 6 : 24);
    if (q) rows.push({ label: `Search for “${input.value.trim()}”`, icon: ICON.search, run: () => doSearch(input.value) });
    active = 0;
    draw();
    if (q.length > 1) {
      const seq = ++searchSeq;
      api('suggestions', { input: q }).then((r) => {
        if (seq !== searchSeq) return;
        rows = rows.concat(r.items.map((it) => ({ label: it.title, sub: it.subtitle, thumb: it.thumb, round: it.kind === 'artist', run: () => (it.videoId ? player.playSingle(it) : openItem(it)) })));
        draw();
      }).catch(() => {});
    }
  };
  input.addEventListener('input', update);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(rows.length - 1, active + 1); draw(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); draw(); }
    else if (e.key === 'Enter') { e.preventDefault(); const r = rows[active]; closeModal(); r?.run(); }
  });
  list.addEventListener('click', (e) => { const c = e.target.closest('[data-ci]'); if (!c) return; const r = rows[Number(c.dataset.ci)]; closeModal(); r?.run(); });
  update();
  input.focus();
}

// ---------------------------------------------------------------- settings
// Bands and presets are Kaset's (EQBand.defaultBands / EQPreset.bandGainsDB).
const EQ_BANDS = [60, 150, 400, 1000, 2400, 15000];
const EQ_PRESETS = {
  Flat: [0, 0, 0, 0, 0, 0], Acoustic: [4, 3, 2, 1, 2, 3], 'Bass Booster': [5, 4, 3, 0, 0, 0], 'Bass Reducer': [-5, -4, -3, -1, 0, 0],
  Classical: [4, 3, 0, 0, 2, 4], Dance: [4, 5, 2, -1, 2, 4], Deep: [4, 3, 1, 0, -2, -3], Electronic: [4, 3, -1, 1, 2, 4],
  'Hip-Hop': [5, 3, 1, 0, 1, 3], Jazz: [3, 2, 1, 2, 1, 3], Latin: [4, 1, -1, 0, 1, 4], Loudness: [5, 3, 0, 0, 2, 5],
  Lounge: [-2, 0, 2, 3, 2, -1], Piano: [2, 1, 0, 2, 3, 2], Pop: [-1, 1, 3, 4, 2, -1], 'R&B': [3, 4, 2, -1, 2, 3],
  Rock: [4, 3, -1, -1, 2, 4], 'Small Speakers': [4, 3, 1, 0, -2, -3], 'Spoken Word': [-2, -1, 1, 4, 3, -1],
  'Treble Booster': [0, 0, 0, 1, 3, 5], 'Treble Reducer': [0, 0, 0, -1, -3, -5], 'Vocal Booster': [-1, 0, 3, 5, 3, 0],
};

async function openSettings(tab = 'general') {
  const s = (state.settings = await K.getSettings());
  const langs = [['en', 'English'], ['es', 'Español'], ['fr', 'Français'], ['de', 'Deutsch'], ['it', 'Italiano'], ['pt', 'Português'], ['nl', 'Nederlands'], ['pl', 'Polski'], ['sv', 'Svenska'], ['tr', 'Türkçe'], ['ru', 'Русский'], ['uk', 'Українська'], ['ar', 'العربية'], ['id', 'Bahasa Indonesia'], ['ja', '日本語'], ['ko', '한국어'], ['zh-CN', '简体中文'], ['zh-TW', '繁體中文']];
  const sw = (key, on) => `<label class="switch"><input type="checkbox" data-set="${key}" ${on ? 'checked' : ''}><span></span></label>`;
  const eq = s.eq || { enabled: false, preset: 'Flat', gains: EQ_PRESETS.Flat.slice() };
  const pages = {
    general: `
      <div class="setting"><div><div class="lbl">Account</div><div class="hint">${state.signedIn ? esc(state.account?.name || 'Signed in') + (state.account?.handle ? ' · ' + esc(state.account.handle) : '') : 'Sign in with Google to use your library and YouTube Music Premium.'}</div></div>
        ${state.signedIn ? '<button class="btn" data-action="logout">Sign Out</button>' : '<button class="btn primary" data-action="login">Sign In</button>'}</div>
      <div class="setting"><div><div class="lbl">Appearance</div></div><select data-set="appearance"><option value="system" ${s.appearance === 'system' ? 'selected' : ''}>System</option><option value="light" ${s.appearance === 'light' ? 'selected' : ''}>Light</option><option value="dark" ${s.appearance === 'dark' ? 'selected' : ''}>Dark</option></select></div>
      <div class="setting"><div><div class="lbl">Content language</div><div class="hint">Used for YouTube Music titles, charts and recommendations.</div></div>
        <select data-set="language">${langs.map(([v, n]) => `<option value="${v}" ${s.language === v ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
      <div class="setting"><div><div class="lbl">Keep playing when the window is closed</div><div class="hint">Kaset stays in the notification area. Quit from its menu.</div></div>${sw('closeToTray', s.closeToTray)}</div>
      <div class="setting"><div><div class="lbl">Launch at sign-in</div><div class="hint">Start Kaset in the background when you sign in to Windows.</div></div>${sw('launchAtLogin', s.launchAtLogin)}</div>
      <div class="setting"><div><div class="lbl">Track notifications</div><div class="hint">Show a notification when a new song starts while Kaset is in the background.</div></div>${sw('notifications', s.notifications)}</div>`,
    playback: `
      <div class="setting"><div><div class="lbl">Autoplay</div><div class="hint">When the queue ends, keep playing similar music.</div></div>${sw('autoplay', s.autoplay !== false)}</div>
      <div class="setting"><div><div class="lbl">Resume where you left off</div><div class="hint">Restore your queue and position when Kaset starts.</div></div>${sw('resumeOnLaunch', s.resumeOnLaunch !== false)}</div>
      <div class="setting"><div><div class="lbl">Smart Shuffle cadence</div><div class="hint">Blend in a suggestion after this many songs.</div></div><select data-set="smartShuffleEvery">${[1, 2, 3, 4, 5].map((n) => `<option value="${n}" ${Number(s.smartShuffleEvery || 3) === n ? 'selected' : ''}>Every ${n} song${n > 1 ? 's' : ''}</option>`).join('')}</select></div>
      <div class="setting"><div><div class="lbl">Smart Shuffle suggestions ahead</div><div class="hint">How many suggestions to keep queued.</div></div><select data-set="smartShuffleAhead">${[1, 2, 3, 5, 8].map((n) => `<option value="${n}" ${Number(s.smartShuffleAhead || 3) === n ? 'selected' : ''}>${n}</option>`).join('')}</select></div>`,
    eq: `
      <div class="setting"><div><div class="lbl">Equalizer</div><div class="hint">6-band parametric EQ applied to Kaset's playback.</div></div>${sw('eqEnabled', eq.enabled)}</div>
      <div class="setting"><div class="lbl">Preset</div><select id="eq-preset">${Object.keys(EQ_PRESETS).concat(eq.preset === 'Custom' ? ['Custom'] : []).map((p) => `<option ${p === eq.preset ? 'selected' : ''}>${p}</option>`).join('')}</select></div>
      <div class="eq">${EQ_BANDS.map((f, i) => `<div class="band"><span class="db" id="eq-db-${i}">${eq.gains[i] > 0 ? '+' : ''}${eq.gains[i]}</span><input type="range" min="-12" max="12" step="1" value="${eq.gains[i]}" data-band="${i}"><span>${f >= 1000 ? f / 1000 + 'k' : f}</span></div>`).join('')}</div>`,
    shortcuts: `<table class="kbd-table">
        <tr><td>Play / Pause</td><td><kbd>Space</kbd></td></tr>
        <tr><td>Next / Previous track</td><td><kbd>Ctrl</kbd> <kbd>→</kbd> / <kbd>Ctrl</kbd> <kbd>←</kbd></td></tr>
        <tr><td>Seek ±10 seconds</td><td><kbd>→</kbd> / <kbd>←</kbd></td></tr>
        <tr><td>Volume up / down</td><td><kbd>Ctrl</kbd> <kbd>↑</kbd> / <kbd>Ctrl</kbd> <kbd>↓</kbd></td></tr>
        <tr><td>Shuffle / Repeat</td><td><kbd>Ctrl</kbd> <kbd>S</kbd> / <kbd>Ctrl</kbd> <kbd>R</kbd></td></tr>
        <tr><td>Like current song</td><td><kbd>Ctrl</kbd> <kbd>L</kbd></td></tr>
        <tr><td>Lyrics / Up Next</td><td><kbd>Ctrl</kbd> <kbd>Shift</kbd> <kbd>L</kbd> / <kbd>Q</kbd></td></tr>
        <tr><td>Mini Player</td><td><kbd>Ctrl</kbd> <kbd>Shift</kbd> <kbd>M</kbd></td></tr>
        <tr><td>Home / Explore / Library</td><td><kbd>Ctrl</kbd> <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd></td></tr>
        <tr><td>Search</td><td><kbd>Ctrl</kbd> <kbd>F</kbd></td></tr>
        <tr><td>Command Bar</td><td><kbd>Ctrl</kbd> <kbd>K</kbd></td></tr>
        <tr><td>Refresh Home</td><td><kbd>Ctrl</kbd> <kbd>Shift</kbd> <kbd>R</kbd></td></tr>
        <tr><td>Back / Forward</td><td><kbd>Alt</kbd> <kbd>←</kbd> / <kbd>Alt</kbd> <kbd>→</kbd></td></tr>
        <tr><td>Close Now Playing</td><td><kbd>Esc</kbd></td></tr>
        <tr><td>Media keys and the Windows media flyout</td><td>Play/Pause, Next, Previous</td></tr></table>`,
    about: `<div style="display:flex;gap:16px;align-items:center;margin:8px 0 14px"><img src="../../build/icon.png" style="width:72px;height:72px" alt=""><div><div style="font-size:20px;font-weight:700">Kaset</div><div style="color:var(--text-2)">Version ${esc(state.version)} for Windows</div></div></div>
      <div class="setting"><div><div class="lbl">Updates</div><div class="hint" id="upd-status">Kaset checks for updates automatically.</div></div><button class="btn" data-action="check-updates">Check for Updates</button></div>
      <div class="setting"><div><div class="lbl">Source code</div><div class="hint">github.com/sozercan/kaset · MIT License</div></div><button class="btn" data-action="open-repo">Open</button></div>
      <div class="hint" style="margin-top:12px;color:var(--text-3);font-size:12px">Kaset is an unofficial application and is not affiliated with YouTube or Google Inc. “YouTube”, “YouTube Music” and the “YouTube Logo” are registered trademarks of Google Inc.</div>`,
  };
  const names = { general: 'General', playback: 'Playback', eq: 'Equalizer', shortcuts: 'Shortcuts', about: 'About' };
  const m = modal(`<h2>Settings</h2><div class="settings-tabs">${Object.keys(pages).map((k) => `<button data-stab="${k}" class="${k === tab ? 'on' : ''}">${names[k]}</button>`).join('')}</div><div id="settings-body">${pages[tab]}</div>
    <div class="foot"><span>Kaset for Windows</span><button class="btn" data-x>Done</button></div>`, { wide: true });
  m.querySelector('[data-x]').onclick = closeModal;
  m.querySelectorAll('[data-stab]').forEach((b) => (b.onclick = () => openSettings(b.dataset.stab)));
  const saveEq = async (next) => { Object.assign(eq, next); state.settings = await K.setSettings({ eq }); K.player('eq', eq); };
  m.querySelectorAll('[data-set]').forEach((el) => el.addEventListener('change', async () => {
    const key = el.dataset.set;
    const v = el.type === 'checkbox' ? el.checked : el.value;
    if (key === 'eqEnabled') return saveEq({ enabled: v });
    state.settings = await K.setSettings({ [key]: v });
    if (key === 'language') { pageCache.clear(); render(); loadSidebarPlaylists(); }
    if (key === 'appearance') applyTheme();
  }));
  const preset = $('#eq-preset');
  if (preset) {
    preset.onchange = () => {
      const g = EQ_PRESETS[preset.value];
      if (!g) return;
      m.querySelectorAll('[data-band]').forEach((r, i) => { r.value = g[i]; setRange(r, g[i] + 12, 24); $(`#eq-db-${i}`).textContent = (g[i] > 0 ? '+' : '') + g[i]; });
      m.querySelector('[data-set="eqEnabled"]').checked = true;
      saveEq({ preset: preset.value, gains: g.slice(), enabled: true });
    };
    m.querySelectorAll('[data-band]').forEach((r) => {
      setRange(r, Number(r.value) + 12, 24);
      r.addEventListener('input', () => {
        const i = Number(r.dataset.band);
        const gains = eq.gains.slice(); gains[i] = Number(r.value);
        setRange(r, gains[i] + 12, 24);
        $(`#eq-db-${i}`).textContent = (gains[i] > 0 ? '+' : '') + gains[i];
        if (![...preset.options].some((o) => o.value === 'Custom')) preset.add(new Option('Custom'));
        preset.value = 'Custom';
        m.querySelector('[data-set="eqEnabled"]').checked = true;
        saveEq({ gains, preset: 'Custom', enabled: true });
      });
    });
  }
}

function applyTheme() {
  const a = state.settings.appearance || 'system';
  const dark = a === 'dark' || (a === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  K.setTheme(a);
}

// ---------------------------------------------------------------- global events
function setupDelegation() {
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#ctxmenu')) hideMenu();
    const t = e.target;
    if (handleYtClick(e)) return;
    const nav = t.closest('.nav-item');
    if (nav) {
      if (nav.dataset.route) navigate({ name: nav.dataset.route });
      else if (nav.dataset.browse) navigate({ name: 'browse', browseId: nav.dataset.browse });
      return;
    }
    const act = t.closest('[data-action]');
    if (act) {
      const a = act.dataset.action;
      if (a === 'login') return K.login();
      if (a === 'logout') { closeModal(); return K.logout(); }
      if (a === 'retry') return render();
      if (a === 'clear-recent') { store.set('recentSearches', []); return render(); }
      if (a === 'account') { e.stopPropagation(); return accountMenu(act); }
      if (a === 'check-updates') { $('#upd-status').textContent = 'Checking…'; return K.checkUpdates().then((r) => { const el = $('#upd-status'); if (el) el.textContent = r; }); }
      if (a === 'open-repo') return K.openExternal('https://github.com/sozercan/kaset');
    }
    const lt = t.closest('[data-libtab]');
    if (lt) { store.set('libraryTab', lt.dataset.libtab); return navigate({ name: 'library', tab: lt.dataset.libtab }, true); }
    const menuBtn = t.closest('[data-menu]');
    if (menuBtn) { e.stopPropagation(); const r = menuBtn.getBoundingClientRect(); return itemMenu(registry.get(menuBtn.dataset.menu), r.left - 190, r.bottom + 4); }
    const playBtn = t.closest('[data-play]');
    if (playBtn) { e.stopPropagation(); return playCardItem(registry.get(playBtn.dataset.play)); }
    const hero = t.closest('[data-hero]');
    if (hero) {
      const h = registry.get(hero.dataset.id);
      if (hero.dataset.hero === 'menu') { e.stopPropagation(); const r = hero.getBoundingClientRect(); return headerMenu(h, r.left, r.bottom + 6); }
      return heroAction(hero.dataset.hero, h, hero);
    }
    const scr = t.closest('[data-scroll]');
    if (scr) { const row = scr.closest('.carousel').querySelector('.row-scroll, .grid-list'); row.scrollBy({ left: Number(scr.dataset.scroll) * row.clientWidth * 0.85, behavior: 'smooth' }); return; }
    if (t.closest('[data-toggle-desc]')) return t.closest('[data-toggle-desc]').classList.toggle('open');
    const artist = t.closest('[data-artist]');
    if (artist) { e.stopPropagation(); return navigate({ name: 'browse', browseId: artist.dataset.artist }); }
    const br = t.closest('[data-browse]');
    if (br && (!br.closest('.track[data-list]') || t.closest('.lnk'))) {
      if (br.dataset.chip) {
        const r = currentRoute();
        const on = r.params === br.dataset.params;
        return navigate({ name: r.name, browseId: r.browseId, params: on ? undefined : br.dataset.params, chipOf: r.chipOf || r.browseId }, true);
      }
      return navigate({ name: 'browse', browseId: br.dataset.browse, params: br.dataset.params || undefined });
    }
    const se = t.closest('[data-search]');
    if (se) return doSearch(se.dataset.search, se.dataset.sparams || undefined);
    const track = t.closest('.track');
    if (track) {
      const item = registry.get(track.dataset.item);
      if (!item) return;
      if (!item.videoId) return openItem(item);
      $$('.track.selected').forEach((x) => x.classList.remove('selected'));
      track.classList.add('selected');
      if (t.closest('.pbtn') || e.detail >= 2 || track.classList.contains('compact')) return playFromTrack(track, item);
      return;
    }
    const card = t.closest('.card, .top-card');
    if (card) return openItem(registry.get(card.dataset.item));
    const tab = t.closest('.panel-tabs .tab');
    if (tab) { panel = null; return togglePanel(tab.dataset.panel); }
  });
  document.addEventListener('keydown', (e) => {
    const yv = document.activeElement?.closest?.('[data-yt]');
    if (yv && e.key === 'Enter') { e.preventDefault(); return openYtItem(registry.get(yv.dataset.yt), yv); }
    const card = document.activeElement?.closest?.('.card');
    if (card && e.key === 'Enter') { e.preventDefault(); openItem(registry.get(card.dataset.item)); }
  });
  document.addEventListener('contextmenu', (e) => {
    const yv = e.target.closest('[data-yt]');
    if (yv) { e.preventDefault(); const it = registry.get(yv.dataset.yt); if (it) ytItemMenu(it, e.clientX, e.clientY); return; }
    const el = e.target.closest('[data-item]');
    if (!el) return;
    e.preventDefault();
    const item = registry.get(el.dataset.item);
    if (item) itemMenu(item, e.clientX, e.clientY);
  });
  window.addEventListener('blur', hideMenu);
  $('#back').onclick = back;
  $('#forward').onclick = forward;
  $('#new-playlist').onclick = (e) => { e.stopPropagation(); createPlaylistDialog(); };
  document.addEventListener('mouseup', (e) => { if (e.button === 3) back(); if (e.button === 4) forward(); });
  $('#content').addEventListener('scroll', () => $('#topbar').classList.toggle('scrolled', $('#content').scrollTop > 40), { passive: true });
  setupQueueInteractions($('#panel-body'));
}

function playFromTrack(trackEl, item) {
  const list = lists.get(trackEl.dataset.list);
  if (!list || trackEl.classList.contains('compact')) return player.playSingle(item);
  const start = list.indexOf(item);
  player.playList(list, start < 0 ? 0 : start, null);
}

async function heroAction(kind, h, btn) {
  if (!h) return;
  if (h.kind === 'artist-header') {
    if (kind === 'shuffle') return player.playPlaylist(h.shuffle.playlistId, { videoId: h.shuffle.videoId, params: h.shuffle.params });
    if (kind === 'radio') return player.playPlaylist(h.radio.playlistId, { videoId: h.radio.videoId, params: h.radio.params });
    if (kind === 'subscribe') {
      try { await api('subscribe', { channelId: h.channelId, subscribe: !h.subscribed }); h.subscribed = !h.subscribed; btn.innerHTML = h.subscribed ? ICON.check + ' Subscribed' : 'Subscribe'; toast(h.subscribed ? `Subscribed to ${h.title}` : `Unsubscribed from ${h.title}`); } catch (e) { toast(e.message); }
    }
    return;
  }
  const tracks = h.tracks.filter((t) => !t.unavailable);
  if (kind === 'play') {
    if (tracks.length) return player.playList(tracks, 0, null);
    if (h.playlistId) return player.playPlaylist(h.playlistId);
  }
  if (kind === 'shuffle') {
    if (h.playlistId && tracks.length < 30) return player.playPlaylist(h.playlistId, { shuffle: true });
    const copyT = tracks.slice();
    for (let i = copyT.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [copyT[i], copyT[j]] = [copyT[j], copyT[i]]; }
    return player.playList(copyT, 0, null);
  }
  if (kind === 'radio') return player.playPlaylist(h.radioPlaylistId);
  if (kind === 'save') {
    try {
      await api('rate', { playlistId: h.playlistId, status: h.saved ? 'INDIFFERENT' : 'LIKE' });
      h.saved = !h.saved;
      btn.innerHTML = h.saved ? ICON.check + ' In Library' : ICON.plus + ' Add to Library';
      toast(h.saved ? 'Added to Library' : 'Removed from Library');
      pageCache.clear();
      loadSidebarPlaylists();
    } catch (e) { toast(e.message); }
  }
}

const TRANSPORT = new Set(['playPause', 'play', 'pause', 'next', 'previous', 'like', 'dislike', 'seekto', 'seekFraction']);
function handleCommand(cmd, msg) {
  if (typeof cmd === 'string' && cmd.startsWith('yt:')) return ytCommand(cmd.slice(3), msg);
  // Media keys, tray, taskbar buttons and jump list go to whichever source played last.
  if (TRANSPORT.has(cmd) && activeSource === 'youtube' && ytPlayer.current()) return ytCommand(cmd, msg);
  switch (cmd) {
    case 'playPause': return player.toggle();
    case 'play': return player.paused && player.toggle();
    case 'pause': return !player.paused && player.toggle();
    case 'next': return player.next();
    case 'previous': return player.previous();
    case 'like': return player.rate('LIKE');
    case 'dislike': return player.rate('DISLIKE');
    case 'shuffle': return player.cycleShuffle();
    case 'repeat': return player.cycleRepeat();
    case 'seekto': return msg && player.seekTo(msg.seekTime);
    case 'seekFraction': return msg && player.seekTo(msg.fraction * player.duration);
    case 'showNowPlaying': return openNowPlaying();
    case 'settings': return openSettings();
    case 'syncMini': return player.pushMeta();
    default: return null;
  }
}

// kaset://play?v=ID (Kaset's URL scheme), plus music.youtube.com / youtu.be links
async function handleOpenUrl(url) {
  try {
    const u = new URL(url);
    let v = u.searchParams.get('v');
    if (u.hostname === 'youtu.be') v = u.pathname.slice(1);
    const list = u.searchParams.get('list');
    // Regular YouTube links (www.youtube.com, or youtu.be while in YouTube mode) open in YouTube mode.
    if (v && (/^(www\.)?youtube\.com$/.test(u.hostname) || (u.hostname === 'youtu.be' && mode === 'youtube'))) {
      setMode('youtube');
      openYtItem({ kind: 'ytvideo', videoId: v, title: '', channel: '', thumb: `https://i.ytimg.com/vi/${v}/hqdefault.jpg` });
      return;
    }
    if (v) {
      const stub = { kind: 'song', videoId: v, title: 'Loading…', artists: [] };
      const r = await player.playSingle(stub);
      const me = r?.items?.find((x) => x.videoId === v);
      if (me && player.current() === stub) {
        Object.assign(stub, me);
        player.emit('track');
        player.pushMeta();
      }
      return;
    }
    if (list) return navigate({ name: 'browse', browseId: 'VL' + list });
    const m = u.pathname.match(/^\/(?:channel|browse)\/([\w-]+)/);
    if (m) return navigate({ name: 'browse', browseId: m[1] });
    if (u.protocol === 'kaset:' && u.hostname === 'search') return doSearch(u.searchParams.get('q') || '');
  } catch (_) {}
}

function setupKeyboard() {
  document.addEventListener('keydown', (e) => {
    const el = document.activeElement;
    const typing = /INPUT|TEXTAREA|SELECT/.test(el?.tagName) && !['range', 'checkbox'].includes(el.type);
    const ctrl = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (ctrl && k === 'f') {
      e.preventDefault(); closeModal(); closeNowPlaying();
      const sr = mode === 'youtube' ? 'yt-search' : 'search';
      if (currentRoute()?.name !== sr) navigate({ name: sr }); else $(mode === 'youtube' ? '#yt-search' : '#search')?.focus();
      return;
    }
    if (ctrl && e.shiftKey && k === 'y') { e.preventDefault(); return setMode(mode === 'youtube' ? 'music' : 'youtube'); }
    if (ctrl && k === 'k') { e.preventDefault(); return $('.cmdbar') ? closeModal() : openCommandBar(); }
    if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); return back(); }
    if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); return forward(); }
    if (e.key === 'Escape') { hideMenu(); if ($('#modal-root').innerHTML) return closeModal(); if (fsOpen) return closeNowPlaying(); }
    if (typing) return;
    if ($('#modal-root').innerHTML) return;
    if (ytActive()) {
      // Video controls while in YouTube mode with a video loaded
      if (e.key === ' ' && !ctrl) { e.preventDefault(); return ytPlayer.toggle(); }
      if (!ctrl && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) { e.preventDefault(); return ytPlayer.seekTo(Math.max(0, ytPlayer.position + (e.key === 'ArrowRight' ? 10 : -10))); }
      if (ctrl && e.key === 'ArrowRight') { e.preventDefault(); return ytPlayer.next(); }
      if (ctrl && e.key === 'ArrowLeft') { e.preventDefault(); return ytPlayer.previous(); }
      if (ctrl && k === 'l') { e.preventDefault(); return ytPlayer.rate('LIKE'); }
      if (!ctrl && k === 'c') { e.preventDefault(); return toggleYtCaptions(); }
      if (!ctrl && k === 'f') { e.preventDefault(); return K.yt('fullscreen'); }
    }
    if (mode === 'youtube' && ctrl && ['1', '2', '3'].includes(e.key)) { e.preventDefault(); return navigate({ name: { 1: 'yt-home', 2: 'yt-explore', 3: 'yt-subs' }[e.key] }); }
    if (e.key === ' ' && !ctrl) { e.preventDefault(); return player.toggle(); }
    if (ctrl && e.key === 'ArrowRight') { e.preventDefault(); return player.next(); }
    if (ctrl && e.key === 'ArrowLeft') { e.preventDefault(); return player.previous(); }
    if (ctrl && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); window.__applyVol(Math.max(0, Math.min(100, Number($('#volume').value) + (e.key === 'ArrowUp' ? 5 : -5)))); return; }
    if (!ctrl && e.key === 'ArrowRight' && player.current()) { e.preventDefault(); return player.seekTo(Math.min(player.duration, player.position + 10)); }
    if (!ctrl && e.key === 'ArrowLeft' && player.current()) { e.preventDefault(); return player.seekTo(Math.max(0, player.position - 10)); }
    if (ctrl && e.shiftKey && k === 'l') { e.preventDefault(); return fsOpen ? setFsTab('lyrics') : togglePanel('lyrics'); }
    if (ctrl && e.shiftKey && k === 'q') { e.preventDefault(); return fsOpen ? setFsTab('queue') : togglePanel('queue'); }
    if (ctrl && e.shiftKey && k === 'm') { e.preventDefault(); return K.player('mini', true); }
    if (ctrl && e.shiftKey && k === 'r') { e.preventDefault(); pageCache.clear(); return navigate({ name: 'home' }); }
    if (ctrl && k === 'l') { e.preventDefault(); return player.rate('LIKE'); }
    if (ctrl && k === 's') { e.preventDefault(); return player.cycleShuffle(); }
    if (ctrl && k === 'r') { e.preventDefault(); return player.cycleRepeat(); }
    if (ctrl && e.key === ',') { e.preventDefault(); return openSettings(); }
    if (ctrl && e.key === '1') { e.preventDefault(); return navigate({ name: 'home' }); }
    if (ctrl && e.key === '2') { e.preventDefault(); return navigate({ name: 'explore' }); }
    if (ctrl && e.key === '3') { e.preventDefault(); return navigate({ name: 'library' }); }
  });
}

// ---------------------------------------------------------------- account / sidebar
async function refreshAccount() {
  try { state.account = await api('account'); } catch (_) { state.account = null; }
  state.signedIn = !!state.account;
  const el = $('#account');
  if (state.signedIn) {
    const a = state.account;
    el.innerHTML = `<div class="account-row" data-action="account">${a.photo ? `<img class="avatar" src="${esc(a.photo)}" alt="">` : `<div class="avatar">${esc((a.name || '?')[0].toUpperCase())}</div>`}<div class="who"><div class="name">${esc(a.name)}</div><div class="handle">${esc(a.handle || 'YouTube Music')}</div></div><svg viewBox="0 0 24 24" style="width:14px;height:14px;color:var(--text-3)"><path d="M8 10l4-4 4 4M8 14l4 4 4-4"/></svg></div>`;
  } else {
    el.innerHTML = '<button class="btn primary" style="width:100%;justify-content:center" data-action="login">Sign In</button>';
  }
  renderAccountButton();
  loadSidebarPlaylists();
  if (mode === 'youtube') loadYtSidebarSubs();
}
function renderAccountButton() {
  const b = $('#account [data-action="login"]');
  if (b) b.textContent = mode === 'youtube' ? 'Sign In to YouTube' : 'Sign In to YouTube Music';
  const h = $('#account .handle');
  if (h && !state.account?.handle) h.textContent = mode === 'youtube' ? 'YouTube' : 'YouTube Music';
}
function accountMenu(el) {
  const r = el.getBoundingClientRect();
  showMenu(r.left, r.top - 150, [
    { header: state.account?.name || '' },
    { label: 'Settings…', fn: () => openSettings() },
    { label: mode === 'youtube' ? 'Open YouTube in Browser' : 'Open YouTube Music in Browser', fn: () => K.openExternal(mode === 'youtube' ? 'https://www.youtube.com/' : 'https://music.youtube.com/') },
    '-',
    { label: 'Sign Out', danger: true, fn: () => K.logout() },
  ]);
}

async function loadSidebarPlaylists() {
  const box = $('#sidebar-playlists');
  if (!state.signedIn) { box.innerHTML = '<div class="nav-muted">Sign in to see your playlists</div>'; state.libraryPlaylists = []; return; }
  try {
    const pls = await api('libraryPlaylists');
    state.libraryPlaylists = pls;
    box.innerHTML = pls.map((p) => `<a class="nav-item" data-browse="${esc(p.browseId)}" title="${esc(p.title)}"><img src="${esc(p.thumb)}" alt=""><span>${esc(p.title)}</span></a>`).join('');
    const r = currentRoute();
    if (r) $$('.nav-item', box).forEach((a) => a.classList.toggle('active', a.dataset.browse === r.browseId));
  } catch (_) {
    box.innerHTML = '';
  }
}

// ================================================================ YouTube mode
// Kaset's second source: regular YouTube over the same Google sign-in. The
// sidebar's Music / YouTube toggle swaps navigation (each source keeps its own
// back/forward history), and the player bar switches to video controls.
// Videos play in the video window (see ensureYtWindow in main.js).
let mode = 'music';
let activeSource = 'music'; // which source media keys / tray / thumbar control
const histories = { music: null, youtube: { stack: [], index: -1 } };
const ytActive = () => mode === 'youtube' && !!ytPlayer.current();

const YT_TITLES = {
  'yt-home': 'Home', 'yt-subs': 'Subscriptions', 'yt-explore': 'Explore', 'yt-liked': 'Liked Videos',
  'yt-wl': 'Watch Later', 'yt-playlists': 'Playlists', 'yt-history': 'History', 'yt-search': 'Search',
};
const YT_EXPLORE = [
  ['FElive_destination', 'Live'], ['FEgaming_destination', 'Gaming'], ['FEnews_destination', 'News'],
  ['FEsports_destination', 'Sports'], ['FElearning_destination', 'Learning'], ['FEfashion_destination', 'Fashion & Beauty'],
];
const YICON = {
  list: '<svg viewBox="0 0 24 24"><path d="M4 6h11M4 11h11M4 16h7M15.5 14v6.5l5-3.25z"/></svg>',
  clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
  window: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2.5"/><rect x="12" y="11.5" width="6.5" height="5" rx="1" class="fill"/></svg>',
  like: '<svg viewBox="0 0 24 24"><path d="M7.5 20h-3v-9h3zM7.5 11.5l4-7.5a2 2 0 0 1 2 2.3l-.7 3.7H18a2 2 0 0 1 2 2.3l-1.2 5.5a2 2 0 0 1-2 1.6H7.5"/></svg>',
  dislike: '<svg viewBox="0 0 24 24"><path d="M16.5 4h3v9h-3zM16.5 12.5l-4 7.5a2 2 0 0 1-2-2.3l.7-3.7H6a2 2 0 0 1-2-2.3l1.2-5.5A2 2 0 0 1 7.2 4.6h9.3"/></svg>',
  share: '<svg viewBox="0 0 24 24"><path d="M14 5l6 6-6 6M20 11H10a6 6 0 0 0-6 6v1"/></svg>',
  yt: '<svg viewBox="0 0 24 24"><rect x="2.5" y="5" width="19" height="14" rx="4"/><path class="fill" d="M10 9v6l5-3z"/></svg>',
};
const ytLink = (it) => it.videoId ? `https://www.youtube.com/watch?v=${it.videoId}`
  : it.playlistId ? `https://www.youtube.com/playlist?list=${it.playlistId}`
  : `https://www.youtube.com/channel/${it.channelId}`;

// ---------------------------------------------------------------- mode switch
function setMode(m, { persist = true } = {}) {
  if (m !== 'youtube') m = 'music';
  if (m === mode && histories[m]) return;
  histories[mode] = history_;
  mode = m;
  document.body.classList.toggle('yt-mode', m === 'youtube');
  $$('.source-toggle button').forEach((b) => { b.classList.toggle('on', b.dataset.source === m); b.setAttribute('aria-selected', String(b.dataset.source === m)); });
  if (persist) K.setSettings({ source: m });
  hideMenu();
  closeNowPlaying();
  if (panel) togglePanel(null);
  renderAccountButton();
  if (m === 'youtube') loadYtSidebarSubs();
  history_ = histories[m] || { stack: [], index: -1 };
  if (!history_.stack.length) navigate({ name: m === 'youtube' ? 'yt-home' : 'home' });
  else render();
  updateYtBar('track');
}

// ---------------------------------------------------------------- data + skeletons
const ytSkeleton = () => `<div class="sk-title"></div><div class="sk-row v">${'<div class="sk-card"></div>'.repeat(6)}</div><div class="sk-title"></div><div class="sk-row v">${'<div class="sk-card"></div>'.repeat(6)}</div>`;

async function ytData(route, method, args, ttl = 5 * 60e3) {
  const key = 'yt:' + JSON.stringify(route);
  const c = pageCache.get(key);
  if (c && Date.now() - c.at < ttl) return c.data;
  const data = await api(method, args);
  pageCache.set(key, { data, at: Date.now() });
  return data;
}

// ---------------------------------------------------------------- item html
const ytSub = (v) => [v.views, v.published].filter(Boolean).join(' · ');
const chanLink = (name, id) => (id ? `<span class="lnk" data-ytchannel="${esc(id)}">${esc(name)}</span>` : esc(name));
const isPlayingVideo = (v) => !!(v.videoId && ytPlayer.current()?.videoId === v.videoId);

function ytThumb(v, opts = {}) {
  let badge = '';
  if (v.kind === 'ytplaylist') badge = `<span class="vbadge">${YICON.list}${esc(v.countText || '')}</span>`;
  else if (v.live) badge = '<span class="vbadge live">LIVE</span>';
  else if (v.lengthText) badge = `<span class="vbadge">${esc(v.lengthText)}</span>`;
  const prog = v.watched && !opts.noProgress ? `<div class="vprog"><i style="width:${Number(v.watched)}%"></i></div>` : '';
  return `<div class="vthumb">${imgTag(v.thumb)}${badge}${prog}</div>`;
}

function ytCard(it) {
  const id = reg(it);
  if (it.kind === 'ytchannel') {
    return `<div class="card round" data-yt="${id}" tabindex="0"><div class="art">${imgTag(it.thumb)}</div><div class="t">${esc(it.title)}</div><div class="s">${esc(it.subscribers || it.handle || '')}</div></div>`;
  }
  if (it.kind === 'ytplaylist') {
    return `<div class="vcard" data-yt="${id}" tabindex="0">${ytThumb(it)}<div class="t" title="${esc(it.title)}">${esc(it.title)}</div><div class="s">${esc(it.channel || 'Playlist')}</div></div>`;
  }
  return `<div class="vcard ${isPlayingVideo(it) ? 'playing' : ''}" data-yt="${id}" tabindex="0">${ytThumb(it)}
    <div class="t" title="${esc(it.title)}">${esc(it.title)}</div>
    ${it.channel ? `<div class="s">${chanLink(it.channel, it.channelId)}</div>` : ''}
    <div class="s">${esc(ytSub(it))}</div></div>`;
}

function ytRow(it, opts = {}) {
  const id = reg(it);
  const attrs = `data-yt="${id}"${opts.list ? ` data-ytlist="${opts.list}" data-ytindex="${opts.index}"` : ''}`;
  const more = `<button class="icon-btn small more" data-ytmenu="${id}" title="More">${ICON.more}</button>`;
  if (it.kind === 'ytchannel') {
    return `<div class="vlist-row chan" ${attrs}><div class="vthumb">${imgTag(it.thumb)}</div><div>
      <div class="t">${esc(it.title)}</div><div class="s">${esc([it.handle, it.subscribers].filter(Boolean).join(' · '))}</div>
      ${it.description ? `<div class="d">${esc(it.description)}</div>` : ''}</div>${more}</div>`;
  }
  if (it.kind === 'ytplaylist') {
    return `<div class="vlist-row ${opts.compact ? 'compact' : ''}" ${attrs}>${ytThumb(it)}<div>
      <div class="t">${esc(it.title)}</div><div class="s">${esc([it.channel, 'Playlist'].filter(Boolean).join(' · '))}</div></div>${opts.compact ? '' : more}</div>`;
  }
  const num = opts.numbered ? `<div class="num">${opts.index + 1}</div>` : '';
  if (opts.compact) {
    return `<div class="vlist-row compact ${isPlayingVideo(it) ? 'playing' : ''}" ${attrs}>${ytThumb(it)}<div>
      <div class="t" title="${esc(it.title)}">${esc(it.title)}</div><div class="s">${chanLink(it.channel || '', it.channelId)}</div><div class="s">${esc(ytSub(it))}</div></div></div>`;
  }
  return `<div class="vlist-row ${isPlayingVideo(it) ? 'playing' : ''}" ${attrs}>${num}${ytThumb(it)}<div>
    <div class="t" title="${esc(it.title)}">${esc(it.title)}</div>
    <div class="s">${esc(ytSub(it))}</div>
    ${it.channel ? `<div class="s ch">${it.channelThumb ? `<img src="${esc(it.channelThumb)}" alt="">` : ''}${chanLink(it.channel, it.channelId)}</div>` : ''}</div>${more}</div>`;
}

let ytGridSeq = 0;
function ytGrid(items, cont, kind = 'feed', layout = 'grid') {
  const gid = 'g' + (++ytGridSeq);
  const body = layout === 'list'
    ? `<div class="vlist" data-ytgrid="${gid}" data-layout="list">${items.map((it) => ytRow(it)).join('')}</div>`
    : `<div class="vgrid" data-ytgrid="${gid}">${items.map(ytCard).join('')}</div>`;
  return body + (cont ? `<div class="sentinel" data-ytcont="${esc(cont)}" data-ytkind="${kind}" data-ytgrid="${gid}"></div>` : '');
}

function ytRail(sec) {
  const more = sec.explore ? `<a class="link-more" data-ytexplore="${esc(sec.explore)}">See All</a>` : '';
  return `<section class="section"><div class="section-head"><div><h2>${esc(sec.title || '')}</h2></div><div class="actions">${more}</div></div>
    <div class="carousel"><div class="row-scroll vrow">${sec.items.map(ytCard).join('')}</div>${arrows}</div></section>`;
}

function ytEmpty(msg, fallbackTitle = 'Nothing here yet') {
  return `<div class="empty">${YICON.yt.replace('<svg', '<svg class="big-icon"')}<h2>${esc(msg?.title || fallbackTitle)}</h2><div>${esc(msg?.body || '')}</div></div>`;
}

function ytSignIn(what) {
  return `<div class="empty">${ICON.user.replace('<svg', '<svg class="big-icon"')}<h2>Sign in to see ${esc(what)}</h2><div>Your subscriptions, Watch Later, liked videos and history come from your YouTube account.</div><button class="btn primary" data-action="login">Sign In</button></div>`;
}

function ytPut(content, html) {
  content.innerHTML = html;
  content.classList.remove('fade-in'); void content.offsetWidth; content.classList.add('fade-in');
  content.scrollTop = 0;
  observeSentinels(content);
  updateArrows();
}

// ---------------------------------------------------------------- pages
async function renderYt(route, content, alive) {
  setTitle(YT_TITLES[route.name] || '');
  const auth = ['yt-subs', 'yt-liked', 'yt-wl', 'yt-playlists', 'yt-history'];
  if (auth.includes(route.name) && !state.signedIn) {
    ytPut(content, `<h1 class="page-title">${esc(YT_TITLES[route.name])}</h1>` + ytSignIn(YT_TITLES[route.name]));
    return;
  }
  switch (route.name) {
    case 'yt-home': {
      const d = await ytData(route, 'ytHome');
      if (!alive()) return;
      let html = '<h1 class="page-title">Home</h1>';
      if (!d.personalized) {
        html += `<div class="yt-note">${YICON.yt}<span>${state.signedIn ? 'Watch some videos to build your recommendations. Until then, here’s what’s popular on YouTube.' : 'You’re browsing YouTube signed out. Sign in for your recommendations, subscriptions and Watch Later.'}</span>${state.signedIn ? '' : '<button class="btn sm primary" data-action="login">Sign In</button>'}</div>`;
      }
      html += d.sections.map(ytRail).join('');
      if (d.items.length || d.continuation) html += `<section class="section">${d.sections.length ? '<div class="section-head"><h2>For You</h2></div>' : ''}${ytGrid(d.items, d.continuation)}</section>`;
      if (!d.sections.length && !d.items.length) html += ytEmpty(d.message, 'No recommendations yet');
      return ytPut(content, html);
    }
    case 'yt-explore': {
      const dest = route.dest || YT_EXPLORE[0][0];
      const d = await ytData(route, 'ytBrowse', { browseId: dest });
      if (!alive()) return;
      let html = `<h1 class="page-title">Explore</h1><div class="tabs-row">${YT_EXPLORE.map(([id, t]) => `<button class="${id === dest ? 'on' : ''}" data-ytexplore="${id}">${t}</button>`).join('')}</div>`;
      html += d.sections.map(ytRail).join('');
      if (d.items.length) html += `<section class="section">${ytGrid(d.items, d.continuation)}</section>`;
      if (!d.sections.length && !d.items.length) html += ytEmpty(d.message);
      return ytPut(content, html);
    }
    case 'yt-subs': {
      const d = await ytData(route, 'ytSubscriptions', {}, 2 * 60e3);
      if (!alive()) return;
      let html = '<h1 class="page-title">Subscriptions</h1>';
      if (d.channels?.length) {
        html += `<div class="yt-subs-row">${d.channels.map((c) => `<div class="ch" data-ytchannel="${esc(c.channelId)}" title="${esc(c.title)}"><img src="${esc(c.thumb)}" alt=""><span>${esc(c.title)}</span></div>`).join('')}</div>`;
      }
      html += d.sections.map(ytRail).join('');
      if (d.items.length || d.continuation) html += `<section class="section">${d.sections.length ? '<div class="section-head"><h2>Latest</h2></div>' : ''}${ytGrid(d.items, d.continuation)}</section>`;
      if (!d.sections.length && !d.items.length) html += ytEmpty(d.message, 'No new videos');
      return ytPut(content, html);
    }
    case 'yt-history': {
      const d = await ytData(route, 'ytBrowse', { browseId: 'FEhistory' }, 60e3);
      if (!alive()) return;
      let html = '<h1 class="page-title">History</h1>';
      html += d.sections.map((s) => `<section class="section"><div class="section-head"><h2>${esc(s.title)}</h2></div>${ytGrid(s.items)}</section>`).join('');
      if (d.items.length || d.continuation) html += `<section class="section">${ytGrid(d.items, d.continuation)}</section>`;
      if (!d.sections.length && !d.items.length) html += ytEmpty(d.message, 'No watch history');
      return ytPut(content, html);
    }
    case 'yt-liked': return renderYtPlaylist({ ...route, playlistId: 'LL' }, content, alive, 'Liked Videos');
    case 'yt-wl': return renderYtPlaylist({ ...route, playlistId: 'WL' }, content, alive, 'Watch Later');
    case 'yt-playlist': return renderYtPlaylist(route, content, alive);
    case 'yt-playlists': {
      const d = await ytData(route, 'ytPlaylists', {}, 60e3);
      if (!alive()) return;
      const fixed = [
        { kind: 'ytplaylist', playlistId: 'WL', title: 'Watch Later', channel: 'Saved videos', thumb: '' },
        { kind: 'ytplaylist', playlistId: 'LL', title: 'Liked Videos', channel: 'Videos you liked', thumb: '' },
      ];
      const items = [...fixed, ...d.items.filter((p) => !['WL', 'LL'].includes(p.playlistId))];
      return ytPut(content, `<h1 class="page-title">Playlists</h1>${ytGrid(items)}`);
    }
    case 'yt-search': return renderYtSearch(route, content, alive);
    case 'yt-channel': return renderYtChannel(route, content, alive);
    case 'yt-watch': return renderYtWatch(route, content, alive);
    default: content.innerHTML = ytEmpty(null, 'Page not found');
  }
}

async function renderYtPlaylist(route, content, alive, fixedTitle) {
  const d = await ytData(route, 'ytPlaylist', { playlistId: route.playlistId }, 60e3);
  if (!alive()) return;
  const title = fixedTitle || d.title || 'Playlist';
  setTitle(title);
  if (!d.items.length) return ytPut(content, `<h1 class="page-title">${esc(title)}</h1>` + ytEmpty(d.message, 'This playlist is empty'));
  const lid = newList(d.items);
  const hid = reg({ kind: 'yt-playlist-header', listId: lid, playlistId: route.playlistId, title });
  const thumb = d.thumb || d.items[0].thumb;
  const html = `<div class="hero"><div class="hero-glow" style="background-image:url('${esc(thumb)}')"></div>
      ${imgTag(thumb, 'cover wide')}
      <div class="info"><div class="kind">Playlist</div><h1>${esc(title)}</h1>
        <div class="meta2">${esc(d.subtitle || `${d.items.length} videos`)}</div>
        ${d.description ? `<div class="desc" data-toggle-desc>${esc(d.description)}</div>` : ''}
        <div class="actions">
          <button class="btn primary" data-ythero="play" data-id="${hid}">${ICON.play} Play All</button>
          <button class="btn" data-ythero="shuffle" data-id="${hid}">${ICON.shuffle} Shuffle</button>
        </div></div></div>
    <div class="vlist numbered" data-ytgrid="${lid}">${d.items.map((it, i) => ytRow(it, { list: lid, index: i, numbered: true })).join('')}</div>
    ${d.continuation ? `<div class="sentinel" data-ytcont="${esc(d.continuation)}" data-ytkind="feed" data-ytgrid="${lid}" data-ytlistid="${lid}"></div>` : ''}`;
  ytPut(content, html);
}

function renderYtSearch(route, content, alive) {
  const recent = store.get('ytRecentSearches', []);
  content.innerHTML = `<div class="search-page"><h1 class="page-title">Search</h1><div class="search-box">${ICON.search}<input id="yt-search" type="search" placeholder="Search YouTube" autocomplete="off" spellcheck="false" value="${esc(route.query || '')}"><div id="yt-suggestions" class="suggestions glass-menu hidden"></div></div><div id="search-results"></div></div>`;
  setupYtSearchInput();
  if (!route.query) {
    $('#yt-search').focus();
    $('#search-results').innerHTML = recent.length
      ? `<div class="section-head"><h2>Recent Searches</h2><div class="actions"><a class="link-more" data-action="yt-clear-recent">Clear</a></div></div><div class="recent">${recent.map((q) => `<button class="chip" data-ytsearch="${esc(q)}">${esc(q)}</button>`).join('')}</div>`
      : ytEmpty({ title: 'Search YouTube', body: 'Find videos, channels and playlists.' });
    return;
  }
  setTitle(`“${route.query}”`);
  const box = $('#search-results');
  box.innerHTML = '<div class="spinner"></div>';
  ytData(route, 'ytSearch', { query: route.query, params: route.params }).then((d) => {
    if (!alive()) return;
    let html = `<div class="chips">${d.filters.map((f) => `<button class="chip ${(route.params || null) === f.params ? 'on' : ''}" data-ytsearch="${esc(route.query)}" data-sparams="${esc(f.params || '')}">${esc(f.title)}</button>`).join('')}</div>`;
    html += d.items.length ? ytGrid(d.items, d.continuation, 'search', 'list') : ytEmpty({ title: 'No Results', body: 'Try a different search.' });
    box.innerHTML = html;
    observeSentinels(box);
  }).catch((e) => { if (alive()) box.innerHTML = `<div class="empty"><h2>Search failed</h2><div>${esc(e.message)}</div></div>`; });
}

function doYtSearch(q, params) {
  q = (q || '').trim();
  if (!q) return;
  const recent = store.get('ytRecentSearches', []).filter((x) => x.toLowerCase() !== q.toLowerCase());
  recent.unshift(q);
  store.set('ytRecentSearches', recent.slice(0, 12));
  const r = currentRoute();
  navigate({ name: 'yt-search', query: q, params: params || undefined }, r?.name === 'yt-search' && !r.query);
}

function setupYtSearchInput() {
  const input = $('#yt-search');
  const box = $('#yt-suggestions');
  let timer = null, idx = -1;
  const close = () => { box.classList.add('hidden'); idx = -1; };
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (!q) return close();
    timer = setTimeout(async () => {
      try {
        const list = await api('ytSuggestions', { input: q });
        if (input.value.trim() !== q) return;
        box.innerHTML = list.map((s) => `<div class="sug" data-q="${esc(s)}">${ICON.search}<span>${esc(s)}</span></div>`).join('');
        box.classList.toggle('hidden', !list.length || document.activeElement !== input);
        idx = -1;
      } catch (_) {}
    }, 140);
  });
  input.addEventListener('keydown', (e) => {
    const opts = $$('.sug', box);
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !box.classList.contains('hidden') && opts.length) {
      e.preventDefault();
      idx = (idx + (e.key === 'ArrowDown' ? 1 : -1) + opts.length) % opts.length;
      opts.forEach((o, i) => o.classList.toggle('active', i === idx));
      input.value = opts[idx].dataset.q;
    } else if (e.key === 'Enter') { close(); doYtSearch(input.value); }
    else if (e.key === 'Escape') { close(); input.blur(); }
  });
  input.addEventListener('blur', () => setTimeout(close, 150));
  box.addEventListener('mousedown', (e) => { const s = e.target.closest('.sug'); if (!s) return; e.preventDefault(); close(); doYtSearch(s.dataset.q); });
}

async function renderYtChannel(route, content, alive) {
  const d = await ytData(route, 'ytChannel', { channelId: route.channelId, params: route.params });
  if (!alive()) return;
  const c = d.channel;
  setTitle(c.title);
  const hid = reg({ ...c, kind: 'ytchannel' });
  let html = c.banner ? `<div class="yt-channel-banner" style="background-image:url('${esc(c.banner)}')"></div>` : '';
  html += `<div class="yt-channel-head ${c.banner ? 'with-banner' : ''}">${c.thumb ? `<img class="avatar" src="${esc(c.thumb)}" alt="">` : ''}<div>
    <h1>${esc(c.title)}</h1><div class="meta2">${esc([c.handle, c.subscribers, c.videoCount].filter(Boolean).join(' • '))}</div>
    ${c.description ? `<div class="desc" data-toggle-desc>${esc(c.description)}</div>` : ''}
    <div class="actions">${state.signedIn ? `<button class="btn primary" data-ythero="subscribe" data-id="${hid}">Subscribe</button>` : ''}
      <button class="btn round-icon" data-ythero="channel-menu" data-id="${hid}" title="More">${ICON.more}</button></div></div></div>`;
  const selected = route.params || d.tabs.find((t) => t.selected)?.params;
  if (d.tabs.length > 1) html += `<div class="tabs-row">${d.tabs.map((t) => `<button class="${t.params === selected || (!route.params && t.selected) ? 'on' : ''}" data-ytchtab="${esc(t.params)}">${esc(t.title)}</button>`).join('')}</div>`;
  html += d.sections.map(ytRail).join('');
  if (d.items.length) html += `<section class="section">${ytGrid(d.items, d.continuation)}</section>`;
  if (!d.sections.length && !d.items.length) html += ytEmpty(null, 'This channel has no content here');
  ytPut(content, html);
}

async function renderYtWatch(route, content, alive) {
  const d = await ytData(route, 'ytWatch', { videoId: route.videoId }, 60e3);
  if (!alive()) return;
  setTitle(d.title);
  const playing = ytPlayer.current()?.videoId === route.videoId;
  const cid = reg({ ...d.channel });
  const vid = reg({ kind: 'ytvideo', videoId: route.videoId, title: d.title, channel: d.channel.title, channelId: d.channel.channelId, thumb: `https://i.ytimg.com/vi/${route.videoId}/hqdefault.jpg`, views: d.shortViews ? d.shortViews + ' views' : d.views });
  const rid = newList(d.related);
  const html = `<div class="yt-watch"><div class="main">
      <div class="yt-stage" data-ytwatchstage="${vid}"><img src="https://i.ytimg.com/vi/${esc(route.videoId)}/hqdefault.jpg" alt="">
        <div class="stage-msg">${playing ? YICON.window + '<span>Playing in the video window — click to show it</span>' : ICON.play + '<span>Play</span>'}</div></div>
      <h1>${esc(d.title)}</h1>
      <div class="yt-owner">
        ${d.channel.thumb ? `<img src="${esc(d.channel.thumb)}" alt="" data-ytchannel="${esc(d.channel.channelId || '')}">` : ''}
        <div class="who" data-ytchannel="${esc(d.channel.channelId || '')}"><b>${esc(d.channel.title)}</b><span>${esc(d.channel.subscribers)}</span></div>
        ${state.signedIn && d.channel.channelId ? `<button class="btn ${d.channel.subscribed ? 'on' : 'primary'}" data-ythero="subscribe" data-id="${cid}">${d.channel.subscribed ? ICON.check + ' Subscribed' : 'Subscribe'}</button>` : ''}
        <div class="spacer"></div>
        <button class="btn" data-ythero="like" data-id="${vid}">${YICON.like}${esc(d.likes || 'Like')}</button>
        <button class="btn round-icon" data-ythero="dislike" data-id="${vid}" title="Dislike">${YICON.dislike}</button>
        <button class="btn" data-ythero="watch-later" data-id="${vid}">${YICON.clock}Watch Later</button>
        <button class="btn round-icon" data-ythero="share" data-id="${vid}" title="Copy Link">${YICON.share}</button>
      </div>
      <div class="yt-desc" data-ytdesc><div class="stats">${esc([d.views, d.date].filter(Boolean).join('  '))}</div><div class="body">${esc(d.description)}</div></div>
    </div>
    <div class="side"><h3>Up Next</h3><div class="vlist" data-ytgrid="${rid}" data-layout="compact">${d.related.map((it, i) => ytRow(it, { compact: true, list: rid, index: i })).join('')}</div>
      ${d.relatedContinuation ? `<div class="sentinel" data-ytcont="${esc(d.relatedContinuation)}" data-ytkind="related" data-ytgrid="${rid}" data-ytlistid="${rid}"></div>` : ''}</div></div>`;
  ytPut(content, html);
  syncYtWatchButtons();
}

function syncYtWatchButtons() {
  const cur = ytPlayer.current();
  const r = currentRoute();
  if (!cur || r?.name !== 'yt-watch' || r.videoId !== cur.videoId) return;
  const like = $('[data-ythero="like"]');
  const dis = $('[data-ythero="dislike"]');
  if (like) like.classList.toggle('on', ytPlayer.likeStatus === 'LIKE');
  if (dis) dis.classList.toggle('on', ytPlayer.likeStatus === 'DISLIKE');
}

// ---------------------------------------------------------------- continuations
async function loadYtContinuation(el) {
  const gid = el.dataset.ytgrid;
  const kind = el.dataset.ytkind;
  const r = await api('ytContinuation', { token: el.dataset.ytcont, kind });
  const items = (r.items || []).concat(...(r.sections || []).map((s) => s.items)).filter((i) => !i.short);
  const grid = $(`[data-ytgrid="${gid}"]:not(.sentinel)`);
  const listId = el.dataset.ytlistid;
  if (grid) {
    const layout = grid.dataset.layout;
    let html;
    if (listId) {
      const list = lists.get(listId) || [];
      const start = list.length;
      list.push(...items.filter((i) => i.kind === 'ytvideo'));
      html = items.map((it, i) => ytRow(it, { list: listId, index: start + i, numbered: !layout, compact: layout === 'compact' })).join('');
    } else if (layout === 'list') html = items.map((it) => ytRow(it)).join('');
    else html = items.map(ytCard).join('');
    grid.insertAdjacentHTML('beforeend', html);
  }
  return r.continuation;
}

// ---------------------------------------------------------------- open / menus
function openYtItem(it, el) {
  if (!it) return;
  if (it.kind === 'ytchannel') return navigate({ name: 'yt-channel', channelId: it.channelId });
  if (it.kind === 'ytplaylist') {
    if (it.playlistId === 'WL') return navigate({ name: 'yt-wl' });
    if (it.playlistId === 'LL') return navigate({ name: 'yt-liked' });
    return navigate({ name: 'yt-playlist', playlistId: it.playlistId });
  }
  if (it.videoId) {
    const listId = el?.dataset.ytlist;
    const list = listId ? lists.get(listId) : null;
    if (list) ytPlayer.play(it, { queue: list, index: Math.max(0, list.indexOf(it)) });
    else ytPlayer.play(it);
    const r = currentRoute();
    if (!(r?.name === 'yt-watch' && r.videoId === it.videoId)) navigate({ name: 'yt-watch', videoId: it.videoId });
  }
}

function ytItemMenu(it, x, y) {
  const e = [];
  if (it.videoId) {
    e.push({ label: 'Play', fn: () => openYtItem(it) });
    e.push({ label: 'Play in Background', fn: () => ytPlayer.play(it, { show: false }) });
    if (state.signedIn) e.push({ label: 'Save to Watch Later', fn: () => ytWatchLater(it, true) });
    if (state.signedIn && currentRoute()?.name === 'yt-wl') e.push({ label: 'Remove from Watch Later', fn: () => ytWatchLater(it, false) });
    if (it.channelId) e.push({ label: 'Go to Channel', fn: () => navigate({ name: 'yt-channel', channelId: it.channelId }) });
  } else if (it.kind === 'ytchannel') {
    e.push({ label: 'Open Channel', fn: () => openYtItem(it) });
  } else if (it.kind === 'ytplaylist') {
    e.push({ label: 'Open Playlist', fn: () => openYtItem(it) });
  }
  e.push('-', { label: 'Copy Link', fn: () => copy(ytLink(it)) }, { label: 'Open in Browser', fn: () => K.openExternal(ytLink(it)) });
  showMenu(x, y, e);
}

async function ytWatchLater(it, add) {
  if (!state.signedIn) return toast('Sign in to use Watch Later');
  try {
    await api('ytWatchLater', { videoId: it.videoId, add });
    [...pageCache.keys()].filter((k) => k.includes('"yt-wl"')).forEach((k) => pageCache.delete(k));
    toast(add ? 'Saved to Watch Later' : 'Removed from Watch Later');
    if (ytPlayer.current()?.videoId === it.videoId) { ytPlayer.current().inWatchLater = add; updateYtBar('like'); }
    if (!add && currentRoute()?.name === 'yt-wl') render();
  } catch (e) { toast("Couldn't update Watch Later: " + e.message); }
}

async function ytHeroAction(kind, h, btn) {
  if (!h) return;
  if (kind === 'play' || kind === 'shuffle') {
    const list = (lists.get(h.listId) || []).slice();
    if (!list.length) return;
    if (kind === 'shuffle') for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
    ytPlayer.play(list[0], { queue: list, index: 0 });
    return navigate({ name: 'yt-watch', videoId: list[0].videoId });
  }
  if (kind === 'subscribe') {
    try {
      await api('ytSubscribe', { channelId: h.channelId, subscribe: !h.subscribed });
      h.subscribed = !h.subscribed;
      btn.innerHTML = h.subscribed ? ICON.check + ' Subscribed' : 'Subscribe';
      btn.classList.toggle('on', h.subscribed); btn.classList.toggle('primary', !h.subscribed);
      toast(h.subscribed ? `Subscribed to ${h.title}` : `Unsubscribed from ${h.title}`);
      [...pageCache.keys()].filter((k) => k.includes('yt-subs') || k.includes('yt-watch')).forEach((k) => pageCache.delete(k));
      loadYtSidebarSubs();
    } catch (e) { toast(e.message); }
    return;
  }
  if (kind === 'channel-menu') {
    const r = btn.getBoundingClientRect();
    return ytItemMenu(h, r.left, r.bottom + 6);
  }
  if (kind === 'like' || kind === 'dislike') {
    if (ytPlayer.current()?.videoId === h.videoId) return ytPlayer.rate(kind === 'like' ? 'LIKE' : 'DISLIKE');
    if (!state.signedIn) return toast('Sign in to rate videos');
    try { await api('ytRate', { videoId: h.videoId, status: kind === 'like' ? 'LIKE' : 'DISLIKE' }); btn.classList.add('on'); toast(kind === 'like' ? 'Added to Liked Videos' : 'Got it'); } catch (e) { toast(e.message); }
    return;
  }
  if (kind === 'watch-later') return ytWatchLater(h, true);
  if (kind === 'share') return copy(ytLink(h));
}

async function loadYtSidebarSubs() {
  const box = $('#yt-sidebar-subs');
  if (!state.signedIn) { box.innerHTML = '<div class="nav-muted">Sign in to see your subscriptions</div>'; return; }
  try {
    const chans = await api('ytGuideSubscriptions');
    box.innerHTML = chans.length
      ? chans.map((c) => `<a class="nav-item" data-ytchannel="${esc(c.channelId)}" title="${esc(c.title)}"><img src="${esc(c.thumb)}" alt=""><span>${esc(c.title)}</span></a>`).join('')
      : '<div class="nav-muted">No subscriptions yet</div>';
  } catch (_) { box.innerHTML = ''; }
}

// ---------------------------------------------------------------- video player
const ytPlayer = (() => {
  let cur = null;
  let queue = [];
  let qi = -1;
  let related = [];
  let position = 0, duration = 0, paused = true, loading = false, ad = false, captions = false;
  let likeStatus = 'INDIFFERENT';
  let seq = 0;
  let seeking = false;
  const listeners = new Set();
  const emit = (w) => listeners.forEach((fn) => fn(w));

  function pushMeta() {
    K.yt('meta', cur ? { title: cur.title, artist: cur.channel || '', album: '', thumb: cur.thumb, videoId: cur.videoId, like: likeStatus } : null);
  }

  async function play(item, opts = {}) {
    if (!item?.videoId) return;
    if (opts.queue) { queue = opts.queue; qi = opts.index || 0; } else { queue = [item]; qi = 0; }
    cur = item;
    activeSource = 'youtube';
    position = 0; duration = item.duration || 0; paused = false; loading = true; ad = false;
    likeStatus = 'INDIFFERENT';
    related = [];
    const s = ++seq;
    emit('track'); emit('state');
    const show = opts.show !== false && state.settings.ytShowVideoWindow !== false;
    await K.yt('load', { videoId: item.videoId, title: item.title, channel: item.channel, show });
    if (s !== seq) return;
    pushMeta();
    api('ytWatch', { videoId: item.videoId }).then((w) => {
      if (s !== seq) return;
      likeStatus = w.likeStatus || 'INDIFFERENT';
      related = w.related || [];
      if (!cur.channel && w.channel.title) cur.channel = w.channel.title;
      if (!cur.channelId && w.channel.channelId) cur.channelId = w.channel.channelId;
      if (!cur.views && w.views) cur.views = w.views;
      emit('like'); emit('track'); pushMeta();
    }).catch(() => {});
  }

  function onEvent(msg) {
    if (msg.type === 'state') {
      if (!msg.ready || !cur) return;
      if (msg.videoId && msg.videoId !== cur.videoId) return;
      if (!msg.ad && !seeking) position = msg.time;
      if (!msg.ad && msg.duration > 0) duration = msg.duration;
      if (loading && (msg.state === 1 || msg.state === 2)) loading = false;
      const changed = !!msg.paused !== paused || !!msg.ad !== ad || !!msg.captions !== captions;
      paused = !!msg.paused; ad = !!msg.ad; captions = !!msg.captions;
      if (changed) emit('state');
      emit('time');
      if (!cur.title && msg.title) { cur.title = msg.title; cur.channel = cur.channel || msg.author; emit('track'); pushMeta(); }
    } else if (msg.type === 'ended') {
      if (cur && msg.videoId === cur.videoId) next(true);
    } else if (msg.type === 'error') {
      if (cur && msg.videoId === cur.videoId) toast(`“${cur.title}” can't be played here.`);
    } else if (msg.type === 'media') {
      ytCommand({ play: 'play', pause: 'pause', nexttrack: 'next', previoustrack: 'previous', stop: 'pause', seekto: 'seekto' }[msg.action] || msg.action, msg);
    }
  }

  // Inside a playlist, videos advance on their own; otherwise (as in Kaset)
  // a finished video stays put and Next moves to the first related video.
  function next(auto = false) {
    if (qi < queue.length - 1) return play(queue[qi + 1], { queue, index: qi + 1, show: false });
    if (auto) return;
    if (related.length) return play(related[0], { show: false });
  }
  function previous() {
    if (position > 3 || qi <= 0) return seekTo(0);
    play(queue[qi - 1], { queue, index: qi - 1, show: false });
  }
  function toggle() {
    if (!cur) return;
    activeSource = 'youtube';
    if (paused) { K.yt('play'); paused = false; } else { K.yt('pause'); paused = true; }
    emit('state');
  }
  function seekTo(t) {
    if (!cur) return;
    position = Math.max(0, Math.min(duration || t, t));
    K.yt('seek', position);
    emit('time');
  }
  async function rate(target) {
    if (!cur) return;
    if (!state.signedIn) return toast('Sign in to rate videos');
    const nextStatus = likeStatus === target ? 'INDIFFERENT' : target;
    likeStatus = nextStatus; emit('like');
    try {
      await api('ytRate', { videoId: cur.videoId, status: nextStatus });
      [...pageCache.keys()].filter((k) => k.includes('yt-liked')).forEach((k) => pageCache.delete(k));
      if (nextStatus === 'LIKE') toast('Added to Liked Videos');
    } catch (e) { toast("Couldn't update rating: " + e.message); }
  }
  function stop() { cur = null; queue = []; qi = -1; paused = true; K.yt('stop'); emit('track'); emit('state'); }

  return {
    play, onEvent, next, previous, toggle, seekTo, rate, stop, pushMeta,
    on: (fn) => listeners.add(fn),
    current: () => cur,
    get position() { return position; }, get duration() { return duration; }, get paused() { return paused; },
    get loading() { return loading; }, get ad() { return ad; }, get likeStatus() { return likeStatus; }, get captions() { return captions; },
    get queue() { return queue; }, get index() { return qi; },
    set seeking(v) { seeking = v; },
  };
})();

function ytCommand(cmd, msg) {
  switch (cmd) {
    case 'playPause': return ytPlayer.toggle();
    case 'play': return ytPlayer.paused && ytPlayer.toggle();
    case 'pause': return !ytPlayer.paused && ytPlayer.toggle();
    case 'next': return ytPlayer.next();
    case 'previous': return ytPlayer.previous();
    case 'like': return ytPlayer.rate('LIKE');
    case 'dislike': return ytPlayer.rate('DISLIKE');
    case 'seekto': return msg && ytPlayer.seekTo(msg.seekTime);
    case 'seekFraction': return msg && ytPlayer.seekTo(msg.fraction * ytPlayer.duration);
    case 'captions': return toggleYtCaptions();
    default: return null;
  }
}

async function toggleYtCaptions() {
  if (!ytPlayer.current()) return;
  const c = await K.yt('captions');
  if (c?.current) { await K.yt('setCaptions', ''); return toast('Captions off'); }
  const tracks = c?.tracks || [];
  if (!tracks.length) return toast('No captions for this video');
  const lang = (state.settings.language || 'en').split('-')[0];
  const t = tracks.find((x) => x.code === lang) || tracks.find((x) => x.code.startsWith(lang)) || tracks[0];
  await K.yt('setCaptions', t.code);
  toast(`Captions: ${t.name}`);
}

async function ytCaptionsMenu(btn) {
  const c = await K.yt('captions');
  const tracks = c?.tracks || [];
  const r = btn.getBoundingClientRect();
  const mark = (on, label) => (on ? '✓  ' : '     ') + label;
  showMenu(r.left - 120, r.top - 12 - 34 * (tracks.length + 2), [
    { header: 'Captions' },
    { label: mark(!c?.current, 'Off'), fn: () => K.yt('setCaptions', '') },
    ...(tracks.length ? tracks.map((t) => ({ label: mark(c.current === t.code, t.name), fn: () => K.yt('setCaptions', t.code) })) : [{ label: 'No captions available', fn: () => {} }]),
  ]);
}

const QUALITY = { highres: '4320p', hd2880: '2880p', hd2160: '2160p 4K', hd1440: '1440p', hd1080: '1080p', hd720: '720p', large: '480p', medium: '360p', small: '240p', tiny: '144p', auto: 'Auto' };
async function ytQualityMenu(btn) {
  const q = await K.yt('qualities');
  const levels = q?.levels?.length ? q.levels : ['auto'];
  const r = btn.getBoundingClientRect();
  const mark = (on, label) => (on ? '✓  ' : '     ') + label;
  showMenu(r.left - 100, r.top - 12 - 32 * (levels.length + 1), [
    { header: `Quality${q?.current && QUALITY[q.current] ? ' · playing ' + QUALITY[q.current] : ''}` },
    ...levels.map((l) => ({ label: mark(l === q?.current, QUALITY[l] || l), fn: () => { K.yt('setQuality', l); toast(`Quality: ${QUALITY[l] || l}`); } })),
  ]);
}

// ---------------------------------------------------------------- player bar (video controls)
let ytWindowShown = false;
function updateYtBar(what) {
  const cur = ytPlayer.current();
  const center = $('#yt-center');
  if (!center) return;
  if (what === 'track') {
    center.classList.toggle('idle', !cur);
    $('#yt-np-title').textContent = cur?.title || '';
    $('#yt-np-sub').innerHTML = cur ? [cur.channel ? chanLink(cur.channel, cur.channelId) : '', esc(cur.views || '')].filter(Boolean).join(' · ') : '';
    $('#yt-np-art img').src = cur?.thumb || '';
    $$('#yt-back, #yt-play, #yt-fwd, #yt-like, #yt-dislike, #yt-wl, #yt-cc, #yt-quality, #yt-full, #yt-window').forEach((b) => { b.disabled = !cur; });
    $$('.vcard, .vlist-row').forEach((el) => { const it = registry.get(el.dataset.yt); el.classList.toggle('playing', !!(it && cur && it.videoId === cur.videoId)); });
    if (mode === 'youtube') document.title = cur ? `${cur.title} — Kaset` : 'Kaset';
  }
  if (what === 'state' || what === 'track') {
    $('#yt-pp-path').setAttribute('d', ytPlayer.paused || !cur ? 'M7 4.5v15l12.5-7.5z' : 'M6.5 4.5h3.8v15H6.5zM13.7 4.5h3.8v15h-3.8z');
    $('#yt-play').title = ytPlayer.paused ? 'Play (Space)' : 'Pause (Space)';
    $('#yt-play').classList.toggle('loading', !!cur && ytPlayer.loading);
    $('#yt-lane').classList.toggle('loading', !!cur && ytPlayer.loading && !ytPlayer.ad);
    $('#yt-cc').classList.toggle('on', ytPlayer.captions);
    if (cur && ytPlayer.ad) $('#yt-np-sub').innerHTML = '<span class="ad">Ad</span> · Your video will play after the ad';
    else if (cur) $('#yt-np-sub').innerHTML = [cur.channel ? chanLink(cur.channel, cur.channelId) : '', esc(cur.views || '')].filter(Boolean).join(' · ');
  }
  if (what === 'time' || what === 'track') {
    if (!$('#yt-lane').classList.contains('drag')) {
      const f = ytPlayer.duration ? Math.min(1, ytPlayer.position / ytPlayer.duration) : 0;
      $('#yt-fill').style.width = f * 100 + '%';
      $('#yt-knob').style.left = f * 100 + '%';
      $('#yt-cur').textContent = fmt(ytPlayer.position);
    }
    $('#yt-dur').textContent = cur?.live ? 'LIVE' : fmt(ytPlayer.duration);
  }
  if (what === 'like' || what === 'track') {
    $('#yt-like').classList.toggle('on', ytPlayer.likeStatus === 'LIKE');
    $('#yt-dislike').classList.toggle('on', ytPlayer.likeStatus === 'DISLIKE');
    $('#yt-wl').classList.toggle('on', !!cur?.inWatchLater);
    syncYtWatchButtons();
  }
}

function setupYtPlayerBar() {
  $('#yt-play').onclick = () => ytPlayer.toggle();
  $('#yt-back').onclick = () => ytPlayer.seekTo(Math.max(0, ytPlayer.position - 10));
  $('#yt-fwd').onclick = () => ytPlayer.seekTo(ytPlayer.position + 10);
  $('#yt-like').onclick = () => ytPlayer.rate('LIKE');
  $('#yt-dislike').onclick = () => ytPlayer.rate('DISLIKE');
  $('#yt-wl').onclick = () => { const c = ytPlayer.current(); if (c) ytWatchLater(c, !c.inWatchLater); };
  $('#yt-cc').onclick = (e) => { e.stopPropagation(); ytCaptionsMenu(e.currentTarget); };
  $('#yt-quality').onclick = (e) => { e.stopPropagation(); ytQualityMenu(e.currentTarget); };
  $('#yt-full').onclick = () => K.yt('fullscreen');
  $('#yt-window').onclick = () => { if (ytPlayer.current()) K.yt('show', !ytWindowShown); };
  $('#yt-np-art').onclick = () => { if (ytPlayer.current()) K.yt('show', true); };
  $('#yt-np-title').onclick = () => { const c = ytPlayer.current(); if (c) navigate({ name: 'yt-watch', videoId: c.videoId }); };
  K.onYtVisible((v) => { ytWindowShown = v; $('#yt-window').classList.toggle('on', v); });
  K.onYtEvent((m) => ytPlayer.onEvent(m));
  const lane = $('#yt-lane');
  const frac = (e) => { const r = lane.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); };
  const show = (f) => { $('#yt-fill').style.width = f * 100 + '%'; $('#yt-knob').style.left = f * 100 + '%'; };
  lane.addEventListener('pointerdown', (e) => {
    if (!ytPlayer.duration || ytPlayer.ad) return;
    lane.setPointerCapture(e.pointerId);
    lane.classList.add('drag');
    ytPlayer.seeking = true;
    const move = (ev) => { const f = frac(ev); show(f); $('#yt-cur').textContent = fmt(f * ytPlayer.duration); };
    move(e);
    const up = (ev) => { lane.removeEventListener('pointermove', move); lane.removeEventListener('pointerup', up); lane.classList.remove('drag'); ytPlayer.seeking = false; ytPlayer.seekTo(frac(ev) * ytPlayer.duration); };
    lane.addEventListener('pointermove', move);
    lane.addEventListener('pointerup', up);
  });
  ytPlayer.on(updateYtBar);
  $$('.source-toggle button').forEach((b) => { b.onclick = () => setMode(b.dataset.source); });
  updateYtBar('track');
}

// Global click handling for YouTube-mode elements. Returns true when handled.
function handleYtClick(e) {
  const t = e.target;
  const ch = t.closest('[data-ytchannel]');
  if (ch && ch.dataset.ytchannel) { e.stopPropagation(); navigate({ name: 'yt-channel', channelId: ch.dataset.ytchannel }); return true; }
  const menu = t.closest('[data-ytmenu]');
  if (menu) { e.stopPropagation(); const r = menu.getBoundingClientRect(); ytItemMenu(registry.get(menu.dataset.ytmenu), r.left - 190, r.bottom + 4); return true; }
  const hero = t.closest('[data-ythero]');
  if (hero) { e.stopPropagation(); ytHeroAction(hero.dataset.ythero, registry.get(hero.dataset.id), hero); return true; }
  const stage = t.closest('[data-ytwatchstage]');
  if (stage) {
    const it = registry.get(stage.dataset.ytwatchstage);
    if (ytPlayer.current()?.videoId === it.videoId) K.yt('show', true);
    else { ytPlayer.play(it); render(); }
    return true;
  }
  const ex = t.closest('[data-ytexplore]');
  if (ex) { navigate({ name: 'yt-explore', dest: ex.dataset.ytexplore }, currentRoute()?.name === 'yt-explore'); return true; }
  const tab = t.closest('[data-ytchtab]');
  if (tab) { const r = currentRoute(); navigate({ name: 'yt-channel', channelId: r.channelId, params: tab.dataset.ytchtab || undefined }, true); return true; }
  const se = t.closest('[data-ytsearch]');
  if (se) { doYtSearch(se.dataset.ytsearch, se.dataset.sparams || undefined); return true; }
  if (t.closest('[data-ytdesc]')) { t.closest('[data-ytdesc]').classList.toggle('open'); return true; }
  const act = t.closest('[data-action="yt-clear-recent"]');
  if (act) { store.set('ytRecentSearches', []); render(); return true; }
  const item = t.closest('[data-yt]');
  if (item) { openYtItem(registry.get(item.dataset.yt), item); return true; }
  return false;
}

// ---------------------------------------------------------------- boot
async function boot() {
  state.settings = await K.getSettings();
  state.version = await K.version();
  applyTheme();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
  setupDelegation();
  setupPlayerBar();
  setupNowPlaying();
  setupYtPlayerBar();
  setupKeyboard();
  K.onPlayerEvent((m) => player.onEvent(m));
  K.onCommand((c) => (typeof c === 'string' ? handleCommand(c) : handleCommand(c.cmd, c)));
  K.onOpenUrl((u) => handleOpenUrl(u));
  K.onAuthChanged(async () => { pageCache.clear(); await refreshAccount(); render(); });
  histories.music = history_;
  $$('.source-toggle button').forEach((b) => b.classList.toggle('on', b.dataset.source === 'music'));
  if (state.settings.source === 'youtube') setMode('youtube', { persist: false });
  else navigate({ name: 'home' });
  await refreshAccount();
  if (state.signedIn && ['home', 'yt-home'].includes(currentRoute()?.name)) { pageCache.clear(); render(); }
  player.restore(state.settings.lastQueue);
  if (state.settings.eq?.enabled) K.player('eq', state.settings.eq);
  K.ready();
}

boot();
