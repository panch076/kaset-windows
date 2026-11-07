// Kaset Mini Player (always-on-top). State comes from the main window via the main process.
const K = window.kaset;
const $ = (s) => document.querySelector(s);
let duration = 0;
let meta = null;

function setMeta(m) {
  meta = m;
  $('#root').classList.toggle('empty', !m);
  $('#placeholder').style.display = m ? 'none' : '';
  if (!m) { $('#title').textContent = ''; $('#artist').textContent = ''; return; }
  const big = (m.thumb || '').replace(/=w\d+-h\d+[^&]*$/, '=w800-h800-l90-rj').replace(/=s\d+$/, '=s800');
  if ($('#art').getAttribute('src') !== big) $('#art').src = big;
  $('#title').textContent = m.title;
  $('#artist').textContent = m.artist;
  $('#like').classList.toggle('on', m.like === 'LIKE');
  document.title = `${m.title} — ${m.artist}`;
}

K.onMeta(setMeta);
K.onPlayerEvent((msg) => {
  if (msg.type !== 'state' || !msg.ready || msg.ad) return;
  if (meta && msg.videoId !== meta.videoId) return;
  if (msg.duration > 0) duration = msg.duration;
  $('#bar').style.width = duration ? `${Math.min(100, (msg.time / duration) * 100)}%` : '0';
  $('#pp-path').setAttribute('d', msg.paused ? 'M7 4.5v15l12.5-7.5z' : 'M6.5 4.5h3.8v15H6.5zM13.7 4.5h3.8v15h-3.8z');
  $('#art').style.transform = msg.paused ? 'scale(.94)' : 'none';
});

$('#pp').onclick = () => K.command('playPause');
$('#next').onclick = () => K.command('next');
$('#prev').onclick = () => K.command('previous');
$('#like').onclick = () => K.command('like');
$('#np').onclick = () => { K.command('showMain'); K.command('showNowPlaying'); };
$('#close').onclick = () => K.command('closeMini');
$('#expand').onclick = () => K.command('showMain');
$('#progress').onclick = (e) => {
  const r = e.currentTarget.getBoundingClientRect();
  K.command('seekFraction', { fraction: (e.clientX - r.left) / r.width });
};
document.addEventListener('keydown', (e) => {
  if (e.key === ' ') { e.preventDefault(); K.command('playPause'); }
  if (e.key === 'Escape') K.command('closeMini');
  if (e.ctrlKey && e.key === 'ArrowRight') K.command('next');
  if (e.ctrlKey && e.key === 'ArrowLeft') K.command('previous');
});
