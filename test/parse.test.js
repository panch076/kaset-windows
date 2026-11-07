// Live parser check: hits public YouTube Music endpoints (signed out) and asserts the parsers find content.
const assert = require('assert');
const P = require('../src/main/parse');
const ctx = { client: { clientName: 'WEB_REMIX', clientVersion: '1.20251020.01.00', hl: 'en', gl: 'US' } };
async function call(ep, body) {
  const r = await fetch(`https://music.youtube.com/youtubei/v1/${ep}?prettyPrint=false`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://music.youtube.com' }, body: JSON.stringify({ context: ctx, ...body }) });
  assert.strictEqual(r.status, 200, ep + ' status');
  return r.json();
}
(async () => {
  const home = P.parseBrowse(await call('browse', { browseId: 'FEmusic_home' }));
  assert(home.sections.length > 0 && home.sections[0].items.length > 0, 'home has sections');
  const search = P.parseSearch(await call('search', { query: 'daft punk' }));
  assert(search.sections.some((s) => s.items.length), 'search has results');
  const artistId = search.sections.flatMap((s) => s.items).find((i) => i.kind === 'artist').browseId;
  const artist = P.parseBrowse(await call('browse', { browseId: artistId }));
  assert.strictEqual(artist.header.type, 'artist');
  const album = artist.sections.flatMap((s) => s.items).find((i) => i.kind === 'album');
  const albumPage = P.parseBrowse(await call('browse', { browseId: album.browseId }));
  const tracks = albumPage.sections.flatMap((s) => s.items).filter((i) => i.videoId);
  assert(tracks.length > 0 && albumPage.header.type === 'collection', 'album has tracks');
  const next = P.parseNext(await call('next', { videoId: tracks[0].videoId, playlistId: 'RDAMVM' + tracks[0].videoId, isAudioOnly: true, enablePersistentPlaylistPanel: true }));
  assert(next.items.length > 5 && next.continuation, 'radio queue');
  console.log('ok — home %d sections, album "%s" %d tracks, radio %d tracks', home.sections.length, albumPage.header.title, tracks.length, next.items.length);
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
