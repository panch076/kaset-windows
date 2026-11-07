// Live parser check for YouTube mode: hits public www.youtube.com InnerTube
// endpoints (WEB client, signed out) and asserts the parsers find content.
const assert = require('assert');
const YP = require('../src/main/parse-youtube');
const ctx = { client: { clientName: 'WEB', clientVersion: '2.20260611.01.00', hl: 'en', gl: 'US' } };
async function call(ep, body) {
  const r = await fetch(`https://www.youtube.com/youtubei/v1/${ep}?prettyPrint=false`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://www.youtube.com', 'X-YouTube-Client-Name': '1', 'X-YouTube-Client-Version': ctx.client.clientVersion },
    body: JSON.stringify({ context: ctx, ...body }),
  });
  assert.strictEqual(r.status, 200, ep + ' status');
  return r.json();
}
const videos = (f) => f.items.concat(...f.sections.map((s) => s.items)).filter((i) => i.kind === 'ytvideo');
(async () => {
  // Signed-out home is only a "Try searching" nudge; Kaset falls back to destination feeds.
  const home = YP.parseFeed(await call('browse', { browseId: 'FEwhat_to_watch' }));
  assert(videos(home).length || home.message, 'home has videos or a nudge message');
  const live = YP.parseFeed(await call('browse', { browseId: 'FElive_destination' }));
  assert(live.sections.length && videos(live).length > 5, 'live destination has shelves');
  const v0 = videos(live)[0];
  assert(v0.videoId && v0.title && v0.thumb, 'video item has id/title/thumb');

  const search = YP.parseSearch(await call('search', { query: 'veritasium' }));
  assert(search.items.filter((i) => i.kind === 'ytvideo').length > 5, 'search has videos');
  const chan = search.items.find((i) => i.kind === 'ytchannel');
  assert(chan && chan.channelId.startsWith('UC'), 'search finds the channel');
  assert(search.continuation, 'search continuation');

  const channel = YP.parseChannel(await call('browse', { browseId: chan.channelId }), chan.channelId);
  assert.strictEqual(channel.channel.channelId, chan.channelId);
  assert(channel.channel.title && channel.tabs.some((t) => t.title === 'Videos'), 'channel header + tabs');
  const vtab = channel.tabs.find((t) => t.title === 'Videos');
  const vids = YP.parseChannel(await call('browse', { browseId: chan.channelId, params: vtab.params }), chan.channelId);
  assert(videos(vids).length > 10 && vids.continuation, 'channel videos tab');

  const watch = YP.parseWatch(await call('next', { videoId: v0.videoId }));
  assert(watch.title && watch.channel.title && watch.related.length > 3, 'watch-next details + related');

  const pl = YP.parsePlaylist(await call('browse', { browseId: 'VLPLFgquLnL59alCl_2TQvOiD5Vgm1hCaGSI' }));
  assert(pl.title && pl.items.length > 10, 'playlist page');

  const subs = YP.parseFeed(await call('browse', { browseId: 'FEsubscriptions' }));
  assert(subs.message, 'signed-out subscriptions explain sign-in');
  console.log('ok — live %d shelves, search %d results, channel "%s" %d videos, watch %d related, playlist "%s" %d videos',
    live.sections.length, search.items.length, channel.channel.title, videos(vids).length, watch.related.length, pl.title, pl.items.length);
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
