// Kaset Party — guest page (served by the host's Kaset app on the local network).
(() => {
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const params = new URLSearchParams(location.search);
  const key = params.get('k') || sessionStorage.getItem('kasetKey') || '';
  if (params.get('k')) sessionStorage.setItem('kasetKey', key);

  let state = null;
  let lastResults = [];
  let name = localStorage.getItem('kasetName') || '';
  let progressAt = 0;

  const store = { pending: new Set() };

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    t.style.animation = 'none'; void t.offsetWidth; t.style.animation = '';
    clearTimeout(toast.t);
    toast.t = setTimeout(() => t.classList.add('hidden'), 2800);
  }

  async function call(path, opts = {}) {
    const res = await fetch(path, { ...opts, headers: { 'X-Kaset-Key': key, 'Content-Type': 'application/json', ...(opts.headers || {}) }, credentials: 'same-origin' });
    const body = await res.json().catch(() => ({}));
    if (res.status === 401) { expired(body.error); throw new Error(body.error || 'expired'); }
    if (!res.ok) throw new Error(body.error || 'Something went wrong');
    return body;
  }

  function expired(msg) {
    $('#expired').classList.remove('hidden');
    if (msg) $('#expired-msg').textContent = msg;
  }

  // ------------------------------------------------ name
  function askName() {
    $('#name-sheet').classList.remove('hidden');
    const i = $('#name-input');
    i.value = name;
    setTimeout(() => i.focus(), 50);
  }
  async function saveName() {
    const v = $('#name-input').value.trim().slice(0, 24);
    if (!v) return $('#name-input').focus();
    name = v;
    localStorage.setItem('kasetName', name);
    $('#name-sheet').classList.add('hidden');
    $('#me-initial').textContent = name[0].toUpperCase();
    call('/api/name', { method: 'POST', body: JSON.stringify({ name }) }).catch(() => {});
  }
  $('#name-save').onclick = saveName;
  $('#name-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') saveName(); });
  $('#me-btn').onclick = askName;

  // ------------------------------------------------ state
  function render() {
    if (!state) return;
    const np = state.nowPlaying;
    $('#host-line').textContent = state.party.hostName ? `${state.party.hostName}'s party` : 'Add songs to the queue';
    $('#now-label').textContent = np ? (np.paused ? 'Paused' : 'Now Playing') : 'Now Playing';
    $('#now-title').textContent = np ? np.title : 'Nothing playing yet';
    $('#now-artist').innerHTML = np ? esc(np.artist) + (np.requestedBy ? ` · <span class="by">${esc(np.requestedBy)}</span>` : '') : 'Search below to request the first song';
    $('#now-art').src = np?.thumb || '';
    const bd = $('#backdrop');
    if (np?.thumb) { bd.style.backgroundImage = `url("${np.thumb.replace(/"/g, '')}")`; bd.classList.add('on'); } else bd.classList.remove('on');
    progressAt = Date.now();
    tickProgress();

    const up = state.upNext || [];
    $('#queue-count').textContent = up.length ? `${up.length} song${up.length === 1 ? '' : 's'}` : '';
    $('#queue').innerHTML = up.length
      ? up.map((s, i) => `<div class="row"><div class="num">${i + 1}</div><div style="min-width:0"><div class="tt">${esc(s.title)}</div><div class="ta">${esc(s.artist)}${s.requestedBy ? ` · <span class="by">${esc(s.requestedBy)}</span>` : ''}</div></div>${state.me.requests[s.videoId]?.status === 'queued' ? '<span class="mine">YOURS</span>' : '<span></span>'}</div>`).join('')
      : '<div class="empty">The queue is empty. Request something!</div>';
    renderResults();
  }

  function tickProgress() {
    const np = state?.nowPlaying;
    if (!np || !np.duration) { $('#now-bar').style.width = '0'; return; }
    const elapsed = np.paused ? 0 : (Date.now() - progressAt) / 1000;
    const pos = Math.min(np.duration, np.position + elapsed);
    $('#now-bar').style.width = `${(pos / np.duration) * 100}%`;
  }
  setInterval(tickProgress, 1000);

  function buttonFor(s) {
    const r = state?.me.requests[s.videoId];
    if (r?.status === 'queued') return '<button class="add done" disabled>Added ✓</button>';
    if (r?.status === 'playing') return '<button class="add done" disabled>Playing</button>';
    if (r?.status === 'pending' || store.pending.has(s.videoId)) return '<button class="add wait" disabled>Waiting</button>';
    if (r?.status === 'declined') return '<button class="add no" disabled>Declined</button>';
    return `<button class="add" data-add="${esc(s.videoId)}">Add</button>`;
  }

  function renderResults() {
    const box = $('#results');
    if (!lastResults.length) return;
    box.innerHTML = '<div class="results-head">Songs</div>' + lastResults.map((s) => `<div class="row"><img src="${esc(s.thumb)}" alt="" loading="lazy"><div style="min-width:0"><div class="tt">${esc(s.title)}</div><div class="ta">${esc(s.artist)}${s.durationText ? ' · ' + esc(s.durationText) : ''}</div></div>${buttonFor(s)}</div>`).join('');
  }

  // ------------------------------------------------ search
  let searchSeq = 0, suggestTimer = null;
  const input = $('#q');
  async function search(q) {
    q = q.trim();
    if (!q) return;
    input.blur();
    $('#suggest').innerHTML = '';
    const seq = ++searchSeq;
    $('#results').innerHTML = '<div class="spinner"></div>';
    try {
      const r = await call('/api/search?q=' + encodeURIComponent(q));
      if (seq !== searchSeq) return;
      lastResults = r.items;
      if (!lastResults.length) $('#results').innerHTML = '<div class="empty">No songs found. Try another search.</div>';
      else renderResults();
    } catch (e) {
      if (seq === searchSeq) $('#results').innerHTML = `<div class="empty">${esc(e.message)}</div>`;
    }
  }
  input.addEventListener('input', () => {
    $('#clear').classList.toggle('hidden', !input.value);
    clearTimeout(suggestTimer);
    const q = input.value.trim();
    if (!q) { $('#suggest').innerHTML = ''; return; }
    suggestTimer = setTimeout(async () => {
      try {
        const r = await call('/api/suggest?q=' + encodeURIComponent(q));
        if (input.value.trim() !== q) return;
        $('#suggest').innerHTML = r.queries.slice(0, 6).map((s) => `<button class="chip" data-q="${esc(s)}">${esc(s)}</button>`).join('');
      } catch (_) {}
    }, 180);
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') search(input.value); });
  $('#clear').onclick = () => { input.value = ''; $('#clear').classList.add('hidden'); $('#suggest').innerHTML = ''; lastResults = []; $('#results').innerHTML = ''; input.focus(); };
  $('#suggest').addEventListener('click', (e) => { const c = e.target.closest('[data-q]'); if (c) { input.value = c.dataset.q; search(c.dataset.q); } });

  $('#results').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-add]');
    if (!b) return;
    if (!name) return askName();
    const videoId = b.dataset.add;
    store.pending.add(videoId);
    renderResults();
    try {
      const r = await call('/api/request', { method: 'POST', body: JSON.stringify({ videoId, name }) });
      state.me.requests[videoId] = { status: r.status, requestId: r.requestId };
      toast(r.status === 'pending' ? 'Sent to the host for approval' : 'Added to the queue 🎶');
      if (navigator.vibrate) navigator.vibrate(12);
    } catch (err) {
      toast(err.message);
    } finally {
      store.pending.delete(videoId);
      renderResults();
    }
  });

  // ------------------------------------------------ live updates
  function connect() {
    const es = new EventSource('/api/events?k=' + encodeURIComponent(key));
    es.onmessage = (e) => {
      const prev = state;
      state = JSON.parse(e.data);
      if (prev) {
        for (const [vid, r] of Object.entries(state.me.requests)) {
          const before = prev.me.requests[vid]?.status;
          if (before === 'pending' && r.status === 'queued') toast('The host approved your song ✓');
          if (before === 'pending' && r.status === 'declined') toast('The host skipped your request');
        }
      }
      render();
    };
    es.onerror = () => {
      // EventSource reconnects by itself; check whether the link was revoked.
      call('/api/state').then((s) => { state = s; render(); }).catch(() => {});
    };
  }

  // ------------------------------------------------ boot
  if (!key) { expired('Open the link or scan the QR code the host shared.'); return; }
  if (name) $('#me-initial').textContent = name[0].toUpperCase();
  call('/api/state').then((s) => {
    state = s;
    render();
    if (!name) askName();
    else call('/api/name', { method: 'POST', body: JSON.stringify({ name }) }).catch(() => {});
    connect();
  }).catch(() => {});
})();
