'use strict';
// Parsers for regular YouTube (WEB client) InnerTube responses — YouTube mode.
// Port of Kaset for macOS's Services/API/Parsers/YouTube/, checked against live
// responses (Nov 2026). YouTube is mid-migration between renderer generations:
//   - search videos/channels: legacy videoRenderer / channelRenderer
//   - watch-next, channel pages, playlists: lockupViewModel
//   - destination feeds: richItemRenderer > videoRenderer, videoCardRenderer
// so items are recognized by shape and feeds are walked recursively.

// ---------------------------------------------------------------- text / images
function text(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v.simpleText === 'string') return v.simpleText;
  if (typeof v.content === 'string') return v.content;
  if (Array.isArray(v.runs)) return v.runs.map((r) => r.text || '').join('');
  return '';
}

function bestUrl(sources) {
  if (!Array.isArray(sources) || !sources.length) return '';
  const best = sources.reduce((a, b) => ((b.width || 0) > (a.width || 0) ? b : a), sources[0]);
  let u = best.url || '';
  if (u.startsWith('//')) u = 'https:' + u;
  return u;
}
const thumbOf = (t) => bestUrl(t?.thumbnails);

function imageSources(tvm) {
  if (!tvm) return null;
  return tvm.image?.sources || tvm.thumbnailViewModel?.image?.sources || null;
}

function parseDuration(s) {
  if (!s || !/^\d+(:\d+)+$/.test(s)) return 0;
  return s.split(':').reduce((a, n) => a * 60 + Number(n), 0);
}

// Video thumbnails at a reliable 16:9 size.
const videoThumb = (videoId, fallback) => fallback || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

function firstBrowseId(v, prefix) {
  if (Array.isArray(v)) {
    for (const x of v) { const r = firstBrowseId(x, prefix); if (r) return r; }
  } else if (v && typeof v === 'object') {
    const id = v.browseEndpoint?.browseId;
    if (typeof id === 'string' && id.startsWith(prefix)) return id;
    for (const x of Object.values(v)) { const r = firstBrowseId(x, prefix); if (r) return r; }
  }
  return null;
}

function isShortNav(nav) {
  if (!nav) return false;
  if (nav.reelWatchEndpoint) return true;
  return (nav.commandMetadata?.webCommandMetadata?.url || '').startsWith('/shorts/');
}

// ---------------------------------------------------------------- items
function videoFromRenderer(r) {
  const videoId = r.videoId;
  const title = text(r.title) || text(r.headline);
  if (!videoId || !title) return null;
  const owner = r.ownerText?.runs || r.shortBylineText?.runs || r.longBylineText?.runs || r.bylineText?.runs;
  const lengthText = text(r.lengthText) || overlayTime(r.thumbnailOverlays);
  const live = (r.badges || []).some((b) => b.metadataBadgeRenderer?.style === 'BADGE_STYLE_TYPE_LIVE_NOW')
    || (r.thumbnailOverlays || []).some((o) => o.thumbnailOverlayTimeStatusRenderer?.style === 'LIVE');
  const views = text(r.shortViewCountText) || text(r.viewCountText);
  let published = text(r.publishedTimeText);
  // videoCardRenderer packs "views · ago" into metadataText
  const meta = text(r.metadataText);
  let viewsOut = views;
  if (!viewsOut && meta) {
    const parts = meta.split(' · ');
    viewsOut = parts.find((p) => /view|watching/i.test(p)) || parts[0];
    published = published || parts.find((p) => /ago/i.test(p)) || '';
  }
  const watched = (r.thumbnailOverlays || []).map((o) => o.thumbnailOverlayResumePlaybackRenderer?.percentDurationWatched).find((x) => x > 0);
  return {
    kind: 'ytvideo',
    videoId,
    title,
    channel: owner?.[0]?.text || '',
    channelId: owner?.[0]?.navigationEndpoint?.browseEndpoint?.browseId || null,
    channelThumb: thumbOf(r.channelThumbnailSupportedRenderers?.channelThumbnailWithLinkRenderer?.thumbnail) || '',
    lengthText: live ? '' : lengthText,
    duration: parseDuration(lengthText),
    views: viewsOut || '',
    published: published || '',
    thumb: videoThumb(videoId, thumbOf(r.thumbnail)),
    live,
    short: isShortNav(r.navigationEndpoint),
    watched: watched ? Math.min(100, watched) : 0,
  };
}

function overlayTime(overlays) {
  for (const o of overlays || []) {
    const t = o.thumbnailOverlayTimeStatusRenderer;
    if (t && t.style !== 'LIVE') return text(t.text);
  }
  return '';
}

const onTapOf = (lockup) => lockup?.rendererContext?.commandContext?.onTap?.innertubeCommand;

function metadataRows(meta) {
  const rows = meta?.metadata?.contentMetadataViewModel?.metadataRows || [];
  return rows.map((row) => (row.metadataParts || []).map((p) => p.text?.content).filter(Boolean)).filter((r) => r.length);
}

function lockupBadge(lockup) {
  for (const o of lockup.contentImage?.thumbnailViewModel?.overlays || []) {
    const badges = o.thumbnailBottomOverlayViewModel?.badges || o.thumbnailOverlayBadgeViewModel?.thumbnailBadges || [];
    for (const b of badges) if (b.thumbnailBadgeViewModel?.text) return b.thumbnailBadgeViewModel.text;
  }
  return '';
}

function lockupWatched(lockup) {
  for (const o of lockup.contentImage?.thumbnailViewModel?.overlays || []) {
    const p = o.thumbnailBottomOverlayViewModel?.progressBar?.thumbnailOverlayProgressBarViewModel?.startPercent;
    if (p > 0) return Math.min(100, p);
  }
  return 0;
}

function lockupThumb(lockup) {
  const ci = lockup.contentImage || {};
  return bestUrl(imageSources(ci.thumbnailViewModel)) || bestUrl(imageSources(ci.collectionThumbnailViewModel?.primaryThumbnail));
}

function videoFromLockup(l) {
  if (l.contentType !== 'LOCKUP_CONTENT_TYPE_VIDEO') return null;
  const tap = onTapOf(l);
  const videoId = tap?.watchEndpoint?.videoId || l.contentId;
  const meta = l.metadata?.lockupMetadataViewModel;
  const title = meta?.title?.content;
  if (!videoId || !title) return null;
  const rows = metadataRows(meta);
  const channel = rows.length > 1 ? rows[0][0] : '';
  const stats = rows.length > 1 ? rows[1] : rows[0] || [];
  const badge = lockupBadge(l);
  const sources = imageSources(l.contentImage?.thumbnailViewModel) || [];
  const portrait = sources[0] && sources[0].height > sources[0].width;
  const live = /^live$/i.test(badge) || stats.some((s) => /watching/i.test(s));
  const avatar = meta?.image?.decoratedAvatarViewModel?.avatar?.avatarViewModel?.image?.sources;
  return {
    kind: 'ytvideo',
    videoId,
    title,
    channel: channel || '',
    channelId: firstBrowseId(meta, 'UC'),
    channelThumb: bestUrl(avatar),
    lengthText: badge.includes(':') ? badge : '',
    duration: parseDuration(badge),
    views: stats.find((s) => /view|watching/i.test(s)) || stats[0] || '',
    published: stats.find((s) => /ago|streamed|premiere/i.test(s)) || '',
    thumb: videoThumb(videoId, bestUrl(sources)),
    live,
    short: isShortNav(tap) || !!portrait,
    watched: lockupWatched(l),
  };
}

function playlistFromLockup(l) {
  if (!['LOCKUP_CONTENT_TYPE_PLAYLIST', 'LOCKUP_CONTENT_TYPE_PODCAST'].includes(l.contentType)) return null;
  const meta = l.metadata?.lockupMetadataViewModel;
  const title = meta?.title?.content;
  if (!l.contentId || !title) return null;
  const rows = metadataRows(meta);
  const flat = rows.flat();
  const tap = onTapOf(l);
  return {
    kind: 'ytplaylist',
    playlistId: l.contentId,
    title,
    channel: rows[0]?.[0] && !/video|episode|view playlist/i.test(rows[0][0]) ? rows[0][0] : '',
    countText: lockupBadge(l) || flat.find((s) => /video|episode/i.test(s)) || '',
    thumb: lockupThumb(l),
    firstVideoId: tap?.watchEndpoint?.videoId || null,
  };
}

function channelFromRenderer(r) {
  if (!r.channelId) return null;
  // Nov 2026 quirk (as in Kaset): subscriberCountText may carry the @handle and
  // videoCountText the subscriber count — assign by content, not field name.
  const a = text(r.subscriberCountText), b = text(r.videoCountText);
  return {
    kind: 'ytchannel',
    channelId: r.channelId,
    title: text(r.title),
    handle: [a, b].find((x) => x.startsWith('@')) || '',
    subscribers: [b, a].find((x) => x && !x.startsWith('@')) || '',
    description: text(r.descriptionSnippet),
    thumb: thumbOf(r.thumbnail),
  };
}

function shortFromLockup(l) {
  const tap = l.onTap?.innertubeCommand;
  const videoId = tap?.reelWatchEndpoint?.videoId || (l.entityId || '').split('-').pop();
  const title = text(l.overlayMetadata?.primaryText);
  if (!videoId || !title) return null;
  return { kind: 'ytvideo', videoId, title, channel: '', views: text(l.overlayMetadata?.secondaryText), thumb: bestUrl(imageSources(l.thumbnailViewModel)), short: true, lengthText: '', duration: 0, published: '' };
}

// Any known item wrapper → item (or null)
function itemFrom(d) {
  const r = d.videoRenderer || d.gridVideoRenderer || d.compactVideoRenderer || d.videoCardRenderer || d.playlistVideoRenderer || d.playlistPanelVideoRenderer;
  if (r) return videoFromRenderer(r);
  if (d.richItemRenderer?.content) return itemFrom(d.richItemRenderer.content);
  if (d.lockupViewModel) return videoFromLockup(d.lockupViewModel) || playlistFromLockup(d.lockupViewModel);
  if (d.channelRenderer) return channelFromRenderer(d.channelRenderer);
  if (d.gridChannelRenderer) return channelFromRenderer(d.gridChannelRenderer);
  if (d.shortsLockupViewModel) return shortFromLockup(d.shortsLockupViewModel);
  return undefined; // not an item wrapper
}

const contToken = (c) => c?.continuationEndpoint?.continuationCommand?.token
  || c?.button?.buttonRenderer?.command?.continuationCommand?.token || null;

// ---------------------------------------------------------------- feed walking
const SKIP_KEYS = new Set(['engagementPanels', 'playerOverlays', 'topbar', 'header', 'frameworkUpdates', 'onResponseReceivedEndpoints', 'microformat', 'metadata', 'responseContext', 'sidebar']);

function shelfTitle(key, s) {
  if (key === 'richShelfRenderer' || key === 'shelfRenderer' || key === 'reelShelfRenderer') return text(s.title);
  if (key === 'horizontalCardListRenderer') return text(s.header?.richListHeaderRenderer?.title);
  if (key === 'gridRenderer') return text(s.header?.gridHeaderRenderer?.title);
  return '';
}
const SHELF_KEYS = ['richShelfRenderer', 'shelfRenderer', 'reelShelfRenderer', 'horizontalCardListRenderer'];

/**
 * Walks a browse/search response and returns
 *   { sections: [{ title, items, shorts }], items, shorts, continuation }
 * where `items` are loose (non-shelf) items. Shorts are kept apart so
 * feed grids stay uniform (as in Kaset).
 */
function walkFeed(root) {
  const out = { sections: [], items: [], shorts: [], continuation: null };
  const keys = new WeakMap(); // per-bucket de-duplication
  const push = (bucket, shorts, it) => {
    const target = it.short ? shorts : bucket;
    const key = it.videoId || it.playlistId || it.channelId;
    if (!keys.has(target)) keys.set(target, new Set());
    if (keys.get(target).has(key)) return;
    keys.get(target).add(key);
    target.push(it);
  };
  function walk(v, bucket, shorts, topLevel) {
    if (Array.isArray(v)) { for (const x of v) walk(x, bucket, shorts, topLevel); return; }
    if (!v || typeof v !== 'object') return;
    const it = itemFrom(v);
    if (it !== undefined) { if (it) push(bucket, shorts, it); return; }
    if (v.continuationItemRenderer) {
      if (topLevel && !out.continuation) out.continuation = contToken(v.continuationItemRenderer);
      return;
    }
    // Dated groups (History: "Today", "Yesterday", …) are titled item sections.
    const ish = v.itemSectionRenderer;
    const ishTitle = text(ish?.header?.itemSectionHeaderRenderer?.title);
    if (ish && ishTitle) {
      const sec = { title: ishTitle, items: [], shorts: [] };
      walk(ish.contents, sec.items, sec.shorts, false);
      if (sec.items.length || sec.shorts.length) out.sections.push(sec);
      return;
    }
    for (const k of SHELF_KEYS) {
      if (v[k]) {
        const sec = { title: shelfTitle(k, v[k]), items: [], shorts: [] };
        const b = k === 'shelfRenderer' ? v[k].content : (v[k].contents || v[k].items || v[k].cards);
        walk(b, sec.items, sec.shorts, false);
        const browse = v[k].endpoint?.browseEndpoint || v[k].title?.runs?.[0]?.navigationEndpoint?.browseEndpoint;
        if (browse?.browseId) sec.browse = { browseId: browse.browseId, params: browse.params || undefined };
        if (sec.items.length || sec.shorts.length) out.sections.push(sec);
        return;
      }
    }
    for (const [k, x] of Object.entries(v)) {
      if (SKIP_KEYS.has(k)) continue;
      walk(x, bucket, shorts, topLevel);
    }
  }
  walk(root, out.items, out.shorts, true);
  return out;
}

function continuationItems(json) {
  const acts = json.onResponseReceivedActions || json.onResponseReceivedCommands || json.onResponseReceivedEndpoints || [];
  const items = [];
  for (const a of acts) {
    const c = a.appendContinuationItemsAction?.continuationItems || a.reloadContinuationItemsCommand?.continuationItems;
    if (c) items.push(...c);
  }
  return items;
}

// ---------------------------------------------------------------- public parsers
function message(json) {
  // Empty feeds carry a nudge / message ("Try searching to get started",
  // "This list has no videos", "Watch history is off") — surface it.
  let msg = null;
  (function w(v) {
    if (msg || !v || typeof v !== 'object') return;
    if (Array.isArray(v)) { v.forEach(w); return; }
    const m = v.feedNudgeRenderer || v.messageRenderer || v.backgroundPromoRenderer || v.alertRenderer || v.alertWithButtonRenderer;
    if (m) { msg = { title: text(m.title) || text(m.text), body: text(m.subtitle) || text(m.bodyText) || text(m.subtext?.messageSubtextRenderer?.text) }; return; }
    for (const [k, x] of Object.entries(v)) if (!SKIP_KEYS.has(k)) w(x);
  })(json);
  return msg && (msg.title || msg.body) ? msg : null;
}

function chips(json) {
  const out = [];
  (function w(v) {
    if (!v || typeof v !== 'object') return;
    if (Array.isArray(v)) { v.forEach(w); return; }
    if (v.chipCloudChipRenderer) {
      const c = v.chipCloudChipRenderer;
      const token = c.navigationEndpoint?.continuationCommand?.token;
      const params = c.navigationEndpoint?.searchEndpoint?.params;
      if (text(c.text)) out.push({ title: text(c.text), selected: !!c.isSelected, token: token || null, params: params || null });
      return;
    }
    for (const [k, x] of Object.entries(v)) if (k !== 'frameworkUpdates') w(x);
  })(json.contents || json);
  const seen = new Set();
  return out.filter((c) => !seen.has(c.title) && seen.add(c.title));
}

/** Browse feed (home, subscriptions, history, destinations): sections + loose grid. */
function parseFeed(json) {
  const f = walkFeed(json.contents || json);
  return {
    sections: f.sections.filter((s) => s.items.length),
    items: f.items,
    shorts: f.shorts.concat(...f.sections.map((s) => s.shorts)),
    continuation: f.continuation,
    chips: chips(json).filter((c) => !c.selected && c.token),
    message: f.items.length || f.sections.length ? null : message(json),
  };
}

function parseContinuation(json) {
  const f = walkFeed(continuationItems(json));
  return { sections: f.sections.filter((s) => s.items.length), items: f.items, continuation: f.continuation };
}

function parseSearch(json) {
  const primary = json.contents?.twoColumnSearchResultsRenderer?.primaryContents || json.contents;
  const f = walkFeed(primary);
  // Flatten: search shelves ("People also watched", "Latest from X") inline into results.
  const items = f.items.slice();
  for (const s of f.sections) if (!/shorts/i.test(s.title)) items.push(...s.items.filter((i) => !items.some((x) => x.videoId && x.videoId === i.videoId)));
  const filters = [{ title: 'All', params: null }, { title: 'Videos', params: 'EgIQAQ==' }, { title: 'Channels', params: 'EgIQAg==' }, { title: 'Playlists', params: 'EgIQAw==' }];
  return { items: items.filter((i) => !i.short), continuation: f.continuation, filters };
}

function parseSearchContinuation(json) {
  const f = walkFeed(continuationItems(json));
  const items = f.items.concat(...f.sections.map((s) => s.items));
  return { items: items.filter((i) => !i.short), continuation: f.continuation };
}

function pageHeader(json) {
  const vm = json.header?.pageHeaderRenderer?.content?.pageHeaderViewModel;
  if (!vm) return null;
  const rows = metadataRows({ metadata: vm.metadata });
  const avatar = vm.image?.decoratedAvatarViewModel?.avatar?.avatarViewModel?.image?.sources;
  const hero = vm.heroImage?.contentPreviewImageViewModel?.image?.sources || vm.image?.contentPreviewImageViewModel?.image?.sources;
  return {
    title: text(vm.title?.dynamicTextViewModel?.text) || json.header.pageHeaderRenderer.pageTitle || '',
    rows,
    avatar: bestUrl(avatar),
    hero: bestUrl(hero),
    banner: bestUrl(vm.banner?.imageBannerViewModel?.image?.sources),
    description: vm.description?.descriptionPreviewViewModel?.description?.content || '',
  };
}

/** Channel page (browse UC…, optionally with a tab's params). */
function parseChannel(json, channelId) {
  const md = json.metadata?.channelMetadataRenderer || {};
  const h = pageHeader(json) || { rows: [] };
  const flat = h.rows.flat();
  const tabs = (json.contents?.twoColumnBrowseResultsRenderer?.tabs || [])
    .map((t) => t.tabRenderer)
    .filter((t) => t && t.title && t.endpoint?.browseEndpoint)
    .map((t) => ({ title: t.title, params: t.endpoint.browseEndpoint.params, selected: !!t.selected }))
    .filter((t) => /^(Home|Videos|Live|Playlists|Podcasts)$/i.test(t.title));
  const f = walkFeed(json.contents);
  return {
    channel: {
      kind: 'ytchannel',
      channelId: md.externalId || channelId,
      title: md.title || h.title,
      handle: flat.find((x) => x.startsWith('@')) || '',
      subscribers: flat.find((x) => /subscriber/i.test(x)) || '',
      videoCount: flat.find((x) => /video/i.test(x)) || '',
      description: md.description || h.description || '',
      thumb: thumbOf(md.avatar) || h.avatar,
      banner: h.banner,
    },
    tabs,
    sections: f.sections.filter((s) => s.items.length && !/^posts$/i.test(s.title)),
    items: f.items,
    continuation: f.continuation,
  };
}

/** Playlist page (browse VL…): Watch Later, Liked videos, any playlist. */
function parsePlaylist(json) {
  const h = pageHeader(json);
  const md = json.metadata?.playlistMetadataRenderer || {};
  const f = walkFeed(json.contents);
  const items = f.items.concat(...f.sections.map((s) => s.items)).filter((i) => i.kind === 'ytvideo');
  return {
    title: h?.title || md.title || '',
    subtitle: h ? h.rows.flat().join(' • ') : '',
    thumb: h?.hero || items[0]?.thumb || '',
    description: md.description || h?.description || '',
    items,
    continuation: f.continuation,
    message: items.length ? null : message(json),
  };
}

/** Subscribed channels from the `guide` endpoint (signed in only). */
function parseGuideSubscriptions(json) {
  const out = [];
  for (const s of json.items || []) {
    const sec = s.guideSubscriptionsSectionRenderer;
    if (!sec) continue;
    const walk = (entries) => {
      for (const e of entries || []) {
        const r = e.guideEntryRenderer;
        if (r?.navigationEndpoint?.browseEndpoint?.browseId?.startsWith('UC')) {
          out.push({ kind: 'ytchannel', channelId: r.navigationEndpoint.browseEndpoint.browseId, title: text(r.formattedTitle) || r.title || '', thumb: thumbOf(r.thumbnail), live: r.badges?.liveBroadcasting || false });
        }
        if (e.guideCollapsibleEntryRenderer) walk(e.guideCollapsibleEntryRenderer.expandableItems);
      }
    };
    walk(sec.items);
  }
  return out;
}

/** Watch-next: video details, like status, channel, related videos. */
function parseWatch(json) {
  const r = json.contents?.twoColumnWatchNextResults;
  const contents = r?.results?.results?.contents || [];
  const pri = contents.find((c) => c.videoPrimaryInfoRenderer)?.videoPrimaryInfoRenderer || {};
  const sec = contents.find((c) => c.videoSecondaryInfoRenderer)?.videoSecondaryInfoRenderer || {};
  const owner = sec.owner?.videoOwnerRenderer || {};
  const sub = sec.subscribeButton?.subscribeButtonRenderer;
  let likeStatus = 'INDIFFERENT';
  let likes = '';
  (function w(v) {
    if (!v || typeof v !== 'object') return;
    if (Array.isArray(v)) { v.forEach(w); return; }
    if (v.segmentedLikeDislikeButtonViewModel) {
      const lb = v.segmentedLikeDislikeButtonViewModel.likeButtonViewModel?.likeButtonViewModel;
      likeStatus = lb?.likeStatusEntity?.likeStatus || likeStatus;
      likes = lb?.toggleButtonViewModel?.toggleButtonViewModel?.defaultButtonViewModel?.buttonViewModel?.title || '';
      return;
    }
    Object.values(v).forEach(w);
  })(pri.videoActions);
  const related = walkFeed(r?.secondaryResults);
  const currentVideoId = json.currentVideoEndpoint?.watchEndpoint?.videoId || null;
  return {
    videoId: currentVideoId,
    title: text(pri.title),
    views: text(pri.viewCount?.videoViewCountRenderer?.viewCount),
    shortViews: text(pri.viewCount?.videoViewCountRenderer?.extraShortViewCount),
    date: text(pri.dateText),
    relativeDate: text(pri.relativeDateText),
    likeStatus,
    likes,
    channel: {
      kind: 'ytchannel',
      channelId: owner.navigationEndpoint?.browseEndpoint?.browseId || owner.title?.runs?.[0]?.navigationEndpoint?.browseEndpoint?.browseId || sub?.channelId || null,
      title: text(owner.title),
      subscribers: text(owner.subscriberCountText),
      thumb: thumbOf(owner.thumbnail),
      subscribed: !!sub?.subscribed,
    },
    description: sec.attributedDescription?.content || text(sec.description) || '',
    related: related.items.concat(...related.sections.map((s) => s.items)).filter((i) => !i.short),
    relatedContinuation: related.continuation,
  };
}

module.exports = {
  text, parseDuration, itemFrom, walkFeed,
  parseFeed, parseContinuation, parseSearch, parseSearchContinuation,
  parseChannel, parsePlaylist, parseGuideSubscriptions, parseWatch, message,
};
