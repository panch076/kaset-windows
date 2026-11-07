'use strict';
// Pure parsers for YouTube Music InnerTube (WEB_REMIX) responses.
// Response shapes are undocumented, so every accessor here is defensive:
// a missing field yields undefined rather than throwing.

const runsText = (t) => {
  if (!t) return '';
  if (typeof t.simpleText === 'string') return t.simpleText;
  if (Array.isArray(t.runs)) return t.runs.map((r) => r.text).join('');
  if (typeof t.content === 'string') return t.content;
  return '';
};

function bestThumb(node) {
  if (!node) return '';
  const list =
    node.thumbnails ||
    node.thumbnail?.thumbnails ||
    node.musicThumbnailRenderer?.thumbnail?.thumbnails ||
    node.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails ||
    node.croppedSquareThumbnailRenderer?.thumbnail?.thumbnails ||
    node.thumbnailRenderer?.musicThumbnailRenderer?.thumbnail?.thumbnails ||
    node.thumbnailRenderer?.croppedSquareThumbnailRenderer?.thumbnail?.thumbnails ||
    node.thumbnail?.croppedSquareThumbnailRenderer?.thumbnail?.thumbnails;
  if (!Array.isArray(list) || !list.length) return '';
  const url = list[list.length - 1].url || '';
  return upsizeThumb(url);
}

function upsizeThumb(url, size = 544) {
  if (!url) return '';
  if (url.startsWith('//')) url = 'https:' + url;
  // lh3/yt3 googleusercontent URLs encode size after '='
  if (/googleusercontent\.com|ggpht\.com/.test(url)) {
    return url.replace(/=w\d+-h\d+[^&]*$/, `=w${size}-h${size}-l90-rj`).replace(/=s\d+[^&]*$/, `=s${size}`);
  }
  return url;
}

const pageTypeOf = (ep) =>
  ep?.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType || '';

function kindFromPageType(pt) {
  switch (pt) {
    case 'MUSIC_PAGE_TYPE_ALBUM':
    case 'MUSIC_PAGE_TYPE_AUDIOBOOK':
      return 'album';
    case 'MUSIC_PAGE_TYPE_PLAYLIST':
      return 'playlist';
    case 'MUSIC_PAGE_TYPE_ARTIST':
    case 'MUSIC_PAGE_TYPE_LIBRARY_ARTIST':
    case 'MUSIC_PAGE_TYPE_USER_CHANNEL':
      return 'artist';
    case 'MUSIC_PAGE_TYPE_PODCAST_SHOW_DETAIL_PAGE':
      return 'podcast';
    case 'MUSIC_PAGE_TYPE_NON_MUSIC_AUDIO_TRACK_PAGE':
      return 'episode';
    default:
      return pt ? 'browse' : '';
  }
}

function linksFromRuns(runs = []) {
  const artists = [];
  let album = null;
  for (const r of runs) {
    const ep = r.navigationEndpoint;
    if (!ep?.browseEndpoint) continue;
    const kind = kindFromPageType(pageTypeOf(ep));
    if (kind === 'artist') artists.push({ name: r.text, id: ep.browseEndpoint.browseId });
    else if (kind === 'album') album = { name: r.text, id: ep.browseEndpoint.browseId };
  }
  return { artists, album };
}

const DURATION_RE = /^\d{1,2}(:\d{2}){1,2}$/;
const TYPE_WORDS = new Set(['Song', 'Video', 'Album', 'Single', 'EP', 'Playlist', 'Artist', 'Podcast', 'Episode', 'Profile', 'Station']);

function toSeconds(text) {
  if (!text || !DURATION_RE.test(text.trim())) return 0;
  return text.trim().split(':').reduce((a, p) => a * 60 + Number(p), 0);
}

function watchEndpointOf(r) {
  const play = r.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint ||
    r.thumbnailOverlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint;
  return play || null;
}

function likeStatusFromMenu(menu) {
  const btns = menu?.menuRenderer?.topLevelButtons || [];
  for (const b of btns) if (b.likeButtonRenderer) return b.likeButtonRenderer.likeStatus;
  return undefined;
}

// musicResponsiveListItemRenderer -> item
function parseListItem(r) {
  const cols = (r.flexColumns || []).map((c) => c.musicResponsiveListItemFlexColumnRenderer?.text?.runs || []);
  const fixed = (r.fixedColumns || []).map((c) => runsText(c.musicResponsiveListItemFixedColumnRenderer?.text));
  const title = (cols[0] || []).map((x) => x.text).join('');
  const subRuns = cols.slice(1).flat();
  const { artists, album } = linksFromRuns(subRuns);
  const play = watchEndpointOf(r);
  const titleEp = cols[0]?.[0]?.navigationEndpoint;
  const videoId = r.playlistItemData?.videoId || titleEp?.watchEndpoint?.videoId || play?.watchEndpoint?.videoId;
  const nav = r.navigationEndpoint;
  const subtitleParts = cols.slice(1).map((runs) => runs.map((x) => x.text).join('')).filter(Boolean);
  let subtitle = subtitleParts.join(' • ');
  let durationText = fixed.find((t) => DURATION_RE.test(t)) || subRuns.map((x) => x.text).find((t) => DURATION_RE.test(t)) || '';

  const item = {
    title,
    subtitle,
    thumb: bestThumb(r.thumbnail),
    artists,
    album,
    duration: toSeconds(durationText),
    durationText,
  };
  const firstWord = subRuns[0]?.text;
  if (videoId && !nav?.browseEndpoint) {
    const mvt = (titleEp || play)?.watchEndpoint?.watchEndpointMusicSupportedConfigs?.watchEndpointMusicConfig?.musicVideoType;
    item.kind = firstWord === 'Episode' || mvt === 'MUSIC_VIDEO_TYPE_PODCAST_EPISODE' ? 'episode' : (firstWord === 'Video' || mvt === 'MUSIC_VIDEO_TYPE_UGC' || mvt === 'MUSIC_VIDEO_TYPE_OMV' && firstWord === 'Video') ? 'video' : 'song';
    item.videoId = videoId;
    item.playlistSetVideoId = r.playlistItemData?.playlistSetVideoId;
    if (TYPE_WORDS.has(firstWord)) item.subtitle = subtitleParts.join(' • ').replace(new RegExp('^' + firstWord + ' • '), '');
    item.unavailable = r.musicItemRendererDisplayPolicy === 'MUSIC_ITEM_RENDERER_DISPLAY_POLICY_GREY_OUT';
    item.likeStatus = likeStatusFromMenu(r.menu);
  } else if (nav?.browseEndpoint) {
    item.kind = kindFromPageType(pageTypeOf(nav)) || 'browse';
    item.browseId = nav.browseEndpoint.browseId;
    item.params = nav.browseEndpoint.params;
    if (TYPE_WORDS.has(firstWord)) item.subtitle = subtitle.replace(new RegExp('^' + firstWord + ' • '), '');
    if (play?.watchPlaylistEndpoint) item.playlistId = play.watchPlaylistEndpoint.playlistId;
    if (play?.watchEndpoint?.playlistId) item.playlistId = play.watchEndpoint.playlistId;
  } else {
    return null;
  }
  return item;
}

// musicTwoRowItemRenderer -> item (cards)
function parseTwoRow(r) {
  const nav = r.navigationEndpoint;
  const subRuns = r.subtitle?.runs || [];
  const { artists, album } = linksFromRuns(subRuns);
  const item = {
    title: runsText(r.title),
    subtitle: runsText(r.subtitle),
    thumb: bestThumb(r.thumbnailRenderer),
    artists,
    album,
    round: r.thumbnailRenderer?.musicThumbnailRenderer?.thumbnailCrop === 'MUSIC_THUMBNAIL_CROP_CIRCLE',
    wide: r.aspectRatio === 'MUSIC_TWO_ROW_ITEM_THUMBNAIL_ASPECT_RATIO_RECTANGLE_16_9',
  };
  const play = watchEndpointOf(r);
  if (nav?.watchEndpoint) {
    item.kind = r.aspectRatio?.includes('16_9') ? 'video' : 'song';
    item.videoId = nav.watchEndpoint.videoId;
    item.playlistId = nav.watchEndpoint.playlistId;
  } else if (nav?.browseEndpoint) {
    item.kind = kindFromPageType(pageTypeOf(nav)) || 'browse';
    item.browseId = nav.browseEndpoint.browseId;
    item.params = nav.browseEndpoint.params;
    if (play?.watchPlaylistEndpoint) item.playlistId = play.watchPlaylistEndpoint.playlistId;
    else if (play?.watchEndpoint?.playlistId) item.playlistId = play.watchEndpoint.playlistId;
  } else if (nav?.watchPlaylistEndpoint) {
    item.kind = 'playlist';
    item.playlistId = nav.watchPlaylistEndpoint.playlistId;
  } else {
    return null;
  }
  if (item.kind === 'artist') item.round = true;
  return item;
}

function parseNavButton(r) {
  const ep = r.clickCommand?.browseEndpoint;
  if (!ep) return null;
  const color = r.solid?.leftStripeColor;
  return {
    kind: 'mood',
    title: runsText(r.buttonText),
    browseId: ep.browseId,
    params: ep.params,
    color: typeof color === 'number' ? '#' + (color & 0xffffff).toString(16).padStart(6, '0') : undefined,
  };
}

function parseItem(wrapper) {
  if (wrapper.musicResponsiveListItemRenderer) return parseListItem(wrapper.musicResponsiveListItemRenderer);
  if (wrapper.musicTwoRowItemRenderer) return parseTwoRow(wrapper.musicTwoRowItemRenderer);
  if (wrapper.musicNavigationButtonRenderer) return parseNavButton(wrapper.musicNavigationButtonRenderer);
  if (wrapper.musicMultiRowListItemRenderer) {
    const r = wrapper.musicMultiRowListItemRenderer;
    const vid = r.onTap?.watchEndpoint?.videoId || r.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.videoId;
    if (!vid) return null;
    return { kind: 'episode', title: runsText(r.title), subtitle: runsText(r.subtitle), thumb: bestThumb(r.thumbnail), videoId: vid, artists: [], description: runsText(r.description) };
  }
  return null;
}

function continuationOf(contents, shelf) {
  const last = Array.isArray(contents) ? contents[contents.length - 1] : null;
  const tok = last?.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;
  if (tok) return tok;
  const c = shelf?.continuations?.[0];
  return c?.nextContinuationData?.continuation || c?.nextRadioContinuationData?.continuation || null;
}

const SHELF_KEYS = [
  'musicCarouselShelfRenderer',
  'musicImmersiveCarouselShelfRenderer',
  'musicShelfRenderer',
  'musicPlaylistShelfRenderer',
  'musicCardShelfRenderer',
  'gridRenderer',
  'musicDescriptionShelfRenderer',
];

function parseShelf(key, s) {
  let title = '';
  let browse = null;
  if (key === 'musicCarouselShelfRenderer' || key === 'musicImmersiveCarouselShelfRenderer') {
    const h = s.header?.musicCarouselShelfBasicHeaderRenderer || s.header?.musicImmersiveCarouselShelfBasicHeaderRenderer || {};
    title = runsText(h.title);
    const strap = runsText(h.strapline);
    const ep = h.moreContentButton?.buttonRenderer?.navigationEndpoint?.browseEndpoint || h.title?.runs?.[0]?.navigationEndpoint?.browseEndpoint;
    if (ep) browse = { browseId: ep.browseId, params: ep.params };
    const items = (s.contents || []).map(parseItem).filter(Boolean);
    const style = items.length && items.every((i) => i.kind === 'song' && !i.wide) && s.contents[0].musicResponsiveListItemRenderer ? 'grid-list' : items.every((i) => i.kind === 'mood') ? 'moods' : 'cards';
    return { title, strapline: strap, items, style, browse };
  }
  if (key === 'gridRenderer') {
    title = runsText(s.header?.gridHeaderRenderer?.title);
    const items = (s.items || []).map(parseItem).filter(Boolean);
    return { title, items, style: items.every((i) => i.kind === 'mood') ? 'moods' : 'cards', continuation: continuationOf(s.items, s) };
  }
  if (key === 'musicCardShelfRenderer') {
    // Search "top result"
    const top = {
      title: runsText(s.title),
      subtitle: runsText(s.subtitle),
      thumb: bestThumb(s.thumbnail),
      ...linksFromRuns(s.subtitle?.runs),
    };
    const ep = s.title?.runs?.[0]?.navigationEndpoint;
    if (ep?.watchEndpoint) Object.assign(top, { kind: 'song', videoId: ep.watchEndpoint.videoId });
    else if (ep?.browseEndpoint) Object.assign(top, { kind: kindFromPageType(pageTypeOf(ep)), browseId: ep.browseEndpoint.browseId });
    const items = (s.contents || []).map(parseItem).filter(Boolean);
    return { title: runsText(s.header?.musicCardShelfHeaderBasicRenderer?.title) || 'Top result', items: top.kind ? [top, ...items] : items, style: 'top' };
  }
  if (key === 'musicDescriptionShelfRenderer') {
    return { title: runsText(s.header), text: runsText(s.description), style: 'text', items: [] };
  }
  // musicShelfRenderer / musicPlaylistShelfRenderer
  title = runsText(s.title);
  const ep = s.bottomEndpoint?.browseEndpoint || s.title?.runs?.[0]?.navigationEndpoint?.browseEndpoint;
  if (ep) browse = { browseId: ep.browseId, params: ep.params };
  const searchEp = s.bottomEndpoint?.searchEndpoint;
  const items = (s.contents || []).map(parseItem).filter(Boolean);
  return {
    title,
    items,
    style: 'list',
    browse,
    search: searchEp ? { query: searchEp.query, params: searchEp.params } : null,
    continuation: continuationOf(s.contents, s),
    playlistId: s.playlistId,
  };
}

// Walks any response and yields shelves (not descending into a shelf once found).
function collectShelves(root) {
  const out = [];
  const visit = (o) => {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) return o.forEach(visit);
    for (const k of Object.keys(o)) {
      if (k === 'frameworkUpdates' || k === 'responseContext' || k === 'header' || k === 'microformat') continue;
      if (SHELF_KEYS.includes(k)) {
        const shelf = parseShelf(k, o[k]);
        if (shelf && (shelf.items.length || shelf.text)) out.push(shelf);
      } else if (k === 'musicResponsiveHeaderRenderer' || k === 'musicEditablePlaylistDetailHeaderRenderer') {
        continue;
      } else if (k === 'itemSectionRenderer' && (o[k].contents || []).some((c) => c.musicResponsiveListItemRenderer || c.musicTwoRowItemRenderer)) {
        // Newer search layout: one bare item per itemSectionRenderer. Merge runs of them.
        const items = o[k].contents.map(parseItem).filter(Boolean);
        const prev = out[out.length - 1];
        if (prev && prev.merged) prev.items.push(...items);
        else out.push({ title: 'Results', items, style: 'list', merged: true });
      } else {
        visit(o[k]);
      }
    }
  };
  visit(root.contents);
  return out;
}

function findKey(o, key, depth = 0) {
  if (!o || typeof o !== 'object' || depth > 30) return undefined;
  if (Array.isArray(o)) {
    for (const x of o) {
      const r = findKey(x, key, depth + 1);
      if (r !== undefined) return r;
    }
    return undefined;
  }
  if (Object.prototype.hasOwnProperty.call(o, key)) return o[key];
  for (const k of Object.keys(o)) {
    if (k === 'frameworkUpdates') continue;
    const r = findKey(o[k], key, depth + 1);
    if (r !== undefined) return r;
  }
  return undefined;
}

function parseHeader(res) {
  const h = findKey(res, 'musicResponsiveHeaderRenderer');
  if (h) {
    const buttons = h.buttons || [];
    let playlistId;
    let shufflePlaylistId;
    let radioPlaylistId;
    let saved;
    for (const b of buttons) {
      const p = b.musicPlayButtonRenderer?.playNavigationEndpoint;
      if (p) playlistId = p.watchPlaylistEndpoint?.playlistId || p.watchEndpoint?.playlistId;
      if (b.toggleButtonRenderer) saved = b.toggleButtonRenderer.isToggled;
      for (const it of b.menuRenderer?.items || []) {
        const m = it.menuNavigationItemRenderer;
        const icon = m?.icon?.iconType;
        const wp = m?.navigationEndpoint?.watchPlaylistEndpoint;
        if (icon === 'MUSIC_SHUFFLE' && wp) shufflePlaylistId = wp;
        if (icon === 'MIX' && wp) radioPlaylistId = wp.playlistId;
      }
    }
    const strap = h.straplineTextOne?.runs || [];
    return {
      type: 'collection',
      title: runsText(h.title),
      subtitle: runsText(h.subtitle),
      secondSubtitle: runsText(h.secondSubtitle),
      strapline: runsText(h.straplineTextOne),
      artists: linksFromRuns(strap).artists,
      thumb: bestThumb(h.thumbnail),
      description: runsText(h.description?.musicDescriptionShelfRenderer?.description),
      playlistId,
      shuffle: shufflePlaylistId,
      radioPlaylistId,
      saved,
      editable: !!findKey(res, 'musicEditablePlaylistDetailHeaderRenderer'),
    };
  }
  const a = findKey(res.header, 'musicImmersiveHeaderRenderer') || findKey(res.header, 'musicVisualHeaderRenderer');
  if (a) {
    const radio = a.startRadioButton?.buttonRenderer?.navigationEndpoint?.watchEndpoint || a.startRadioButton?.buttonRenderer?.navigationEndpoint?.watchPlaylistEndpoint;
    const shuffle = a.playButton?.buttonRenderer?.navigationEndpoint?.watchEndpoint || a.playButton?.buttonRenderer?.navigationEndpoint?.watchPlaylistEndpoint;
    const sub = a.subscriptionButton?.subscribeButtonRenderer;
    return {
      type: 'artist',
      title: runsText(a.title),
      description: runsText(a.description),
      thumb: bestThumb(a.thumbnail?.musicThumbnailRenderer ? a.thumbnail : a.foregroundThumbnail || a.thumbnail),
      subscribers: runsText(sub?.subscriberCountText),
      subscribed: sub?.subscribed,
      channelId: sub?.channelId,
      radio,
      shuffle,
    };
  }
  const d = findKey(res.header, 'musicHeaderRenderer');
  if (d) return { type: 'simple', title: runsText(d.title) };
  return null;
}

function parseBrowse(res) {
  const header = parseHeader(res);
  const sections = collectShelves(res);
  const chips = [];
  const chipCloud = findKey(res.contents, 'chipCloudRenderer');
  for (const c of chipCloud?.chips || []) {
    const ch = c.chipCloudChipRenderer;
    const ep = ch?.navigationEndpoint?.browseEndpoint;
    if (ep) chips.push({ title: runsText(ch.text), browseId: ep.browseId, params: ep.params });
  }
  // Fill album rows (they lack thumbnails/artists) from the header.
  if (header?.type === 'collection') {
    for (const s of sections) {
      for (const it of s.items) {
        if (it.kind === 'song' || it.kind === 'video') {
          if (!it.thumb) it.thumb = header.thumb;
          if (!it.artists.length && header.artists.length) it.artists = header.artists;
          if (!it.subtitle && header.strapline) it.subtitle = header.strapline;
        }
      }
    }
  }
  const sectionList = findKey(res.contents, 'sectionListRenderer');
  const sectionContinuation = sectionList?.continuations?.[0]?.nextContinuationData?.continuation || null;
  return { header, sections, chips, sectionContinuation, title: header?.title || runsText(findKey(res.header, 'title')) };
}

// Continuation responses for list shelves (playlists) or section lists (home).
function parseContinuation(res) {
  const actions = res.onResponseReceivedActions || [];
  for (const a of actions) {
    const items = a.appendContinuationItemsAction?.continuationItems;
    if (items) {
      return { items: items.map(parseItem).filter(Boolean), continuation: continuationOf(items) };
    }
  }
  const cc = res.continuationContents || {};
  if (cc.sectionListContinuation) {
    const sections = collectShelves({ contents: cc.sectionListContinuation.contents });
    return { sections, sectionContinuation: cc.sectionListContinuation.continuations?.[0]?.nextContinuationData?.continuation || null };
  }
  const shelf = cc.musicShelfContinuation || cc.musicPlaylistShelfContinuation || cc.gridContinuation;
  if (shelf) {
    const contents = shelf.contents || shelf.items || [];
    return { items: contents.map(parseItem).filter(Boolean), continuation: continuationOf(contents, shelf) };
  }
  if (cc.playlistPanelContinuation) {
    return parsePanel(cc.playlistPanelContinuation);
  }
  return { items: [], continuation: null };
}

function parsePanelVideo(v) {
  if (!v) return null;
  const byline = v.longBylineText?.runs || [];
  const { artists, album } = linksFromRuns(byline);
  const parts = runsText(v.longBylineText).split(' • ');
  return {
    kind: 'song',
    videoId: v.videoId,
    title: runsText(v.title),
    subtitle: artists.length ? artists.map((a) => a.name).join(', ') : parts[0] || runsText(v.shortBylineText),
    artists: artists.length ? artists : [{ name: runsText(v.shortBylineText), id: null }],
    album,
    thumb: bestThumb(v.thumbnail),
    duration: toSeconds(runsText(v.lengthText)),
    durationText: runsText(v.lengthText),
    playlistSetVideoId: v.playlistSetVideoId,
  };
}

function parsePanel(panel) {
  const items = [];
  for (const c of panel.contents || []) {
    const v = c.playlistPanelVideoRenderer || c.playlistPanelVideoWrapperRenderer?.primaryRenderer?.playlistPanelVideoRenderer;
    const it = parsePanelVideo(v);
    if (it) items.push(it);
  }
  const cont = panel.continuations?.[0];
  return {
    items,
    continuation: cont?.nextRadioContinuationData?.continuation || cont?.nextContinuationData?.continuation || null,
    playlistId: panel.playlistId,
    currentIndex: (panel.contents || []).findIndex((c) => (c.playlistPanelVideoRenderer || c.playlistPanelVideoWrapperRenderer?.primaryRenderer?.playlistPanelVideoRenderer)?.selected),
  };
}

function parseNext(res) {
  if (res.continuationContents?.playlistPanelContinuation) return parsePanel(res.continuationContents.playlistPanelContinuation);
  const watch = res.contents?.singleColumnMusicWatchNextResultsRenderer?.tabbedRenderer?.watchNextTabbedResultsRenderer;
  const tabs = watch?.tabs || [];
  const panel = findKey(tabs[0], 'playlistPanelRenderer');
  const out = panel ? parsePanel(panel) : { items: [], continuation: null };
  for (const t of tabs) {
    const ep = t.tabRenderer?.endpoint?.browseEndpoint;
    const pt = pageTypeOf(t.tabRenderer?.endpoint);
    if (pt === 'MUSIC_PAGE_TYPE_TRACK_LYRICS') out.lyricsBrowseId = ep.browseId;
    if (pt === 'MUSIC_PAGE_TYPE_TRACK_RELATED') out.relatedBrowseId = ep.browseId;
  }
  const like = findKey(res.playerOverlays, 'likeButtonRenderer');
  if (like) out.likeStatus = like.likeStatus;
  return out;
}

function parseLyrics(res) {
  const shelf = findKey(res.contents, 'musicDescriptionShelfRenderer');
  if (!shelf) return null;
  return { text: runsText(shelf.description).replace(/\r\n/g, '\n'), source: runsText(shelf.footer) };
}

function parseSuggestions(res) {
  const out = { queries: [], items: [] };
  for (const sec of res.contents || []) {
    for (const c of sec.searchSuggestionsSectionRenderer?.contents || []) {
      if (c.searchSuggestionRenderer) out.queries.push(runsText(c.searchSuggestionRenderer.suggestion));
      else if (c.musicResponsiveListItemRenderer) {
        const it = parseListItem(c.musicResponsiveListItemRenderer);
        if (it) out.items.push(it);
      }
    }
  }
  return out;
}

function parseSearch(res) {
  const sections = collectShelves(res);
  const chips = [];
  const chipCloud = findKey(res.contents, 'chipCloudRenderer');
  for (const c of chipCloud?.chips || []) {
    const ch = c.chipCloudChipRenderer;
    const ep = ch?.navigationEndpoint?.searchEndpoint;
    if (ep) chips.push({ title: runsText(ch.text), params: ep.params, query: ep.query, selected: !!ch.isSelected });
  }
  return { sections, chips };
}

function parseAccount(res) {
  const h = findKey(res, 'activeAccountHeaderRenderer');
  if (!h) return null;
  return { name: runsText(h.accountName), handle: runsText(h.channelHandle), photo: bestThumb(h.accountPhoto) };
}

module.exports = {
  runsText,
  parseBrowse,
  parseContinuation,
  parseNext,
  parseLyrics,
  parseSuggestions,
  parseSearch,
  parseAccount,
  upsizeThumb,
};
