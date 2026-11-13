<h1 align="center">Kaset for Windows</h1>

<p align="center">A native-feeling Windows client for YouTube Music: the Windows edition of <a href="https://github.com/sozercan/kaset">Kaset</a>.</p>

Kaset for Windows brings Kaset's design and features to Windows 10 and 11. It has the same sidebar, a floating glass player bar, a full-screen Now Playing view with synced lyrics, Smart Shuffle, a 6-band equalizer, and the cassette icon. On Windows 11 the glass surfaces use the system's Acrylic material.

## Features

### Music
- **YouTube Music**: Home with mood chips, Explore, Charts, Moods & Genres, New Releases, Podcasts, artists, albums, and playlists with infinite scroll.
- **Search**: Live suggestions, a top result, filters (Songs, Albums, Artists, Playlists, Videos, Episodes and more), and recent searches.
- **Library**: Playlists, Songs, Albums, Artists, Subscriptions, Podcasts, Liked Music and History. Your playlists also appear in the sidebar.

### Playback
- **Floating glass player bar**: Shuffle, previous, play/pause, next and repeat; a draggable progress lane; like, dislike, lyrics, Up Next, Mini Player, video, equalizer and volume.
- **Now Playing**: Full-screen artwork over a blurred backdrop, with synced lyrics or Up Next beside it. Open it from the artwork; press `Esc` to close.
- **Lyrics**: Synced line-by-line lyrics from LRCLIB (click a line to seek), with YouTube Music's own lyrics as a fallback.
- **Up Next**: Jump to a track, drag to reorder, remove, clear, Play Next and Add to Queue.
- **Smart Shuffle**: Click shuffle twice. Suggestions based on the current song are blended into Up Next. You can set how often they appear and how many are queued ahead in Settings → Playback.
- **Equalizer**: 6-band parametric EQ (60 Hz to 15 kHz) with Kaset's 22 presets, or set your own.
- **Mini Player**: An always-on-top square player with glass controls (`Ctrl+Shift+M`).
- **Video**: Open the playing music video in its own window.
- **Autoplay and resume**: The music keeps going when the queue ends, and your queue and position come back the next time Kaset starts.

### YouTube mode
The **Music | YouTube** toggle at the bottom of the sidebar switches Kaset to regular YouTube, over the same Google sign-in (as in Kaset for macOS). Each side keeps its own navigation history.

- **Home**: your recommendations and topic rails when signed in; signed out, rails from YouTube's Live, Gaming, News, Sports and Learning feeds.
- **Search** with suggestions and Videos / Channels / Playlists filters, **Explore**, **Subscriptions**, **Liked Videos**, **Watch Later**, **Playlists** and **History**.
- **Channel pages** (Home, Videos, Playlists tabs) and a **watch page** with details, subscribe, like, Watch Later and Up Next.
- **Video window**: videos play in Kaset's video window with native-style hover controls (play/pause, ±10 s, scrubber, captions, full screen). In YouTube mode the player bar becomes video controls: ±10 s, play/pause, like/dislike, Watch Later, captions, quality, full screen and the video window toggle.
- One audio source at a time: starting a video pauses music and vice versa; media keys follow whichever played last.

### Library management
Like and dislike songs. Add albums and playlists to your library. Create playlists, add songs to them, remove songs, and delete playlists. Subscribe to artists.

### Windows integration
- Media keys, the Windows media flyout, and Bluetooth headset buttons
- Play/pause/next/previous buttons on the taskbar thumbnail, plus playback progress on the taskbar icon
- Jump list tasks: Play/Pause, Next, Previous, Mini Player
- A notification-area icon with playback controls; music keeps playing when the window is closed (optional)
- Track notifications with artwork (optional), and launch at sign-in (optional)
- Discord Rich Presence with synced lyrics (Settings → Discord; needs your own Discord application ID), ported from [kaset-discord-rpc](https://github.com/panch076/kaset-discord-rpc): "Listening to" with title, artist, artwork, progress, the current lyric line (LRCLIB, falling back to NetEase), and a YouTube Music button; "Watching" for YouTube videos
- The `kaset://` URL scheme (`kaset://play?v=VIDEO_ID`), the same as Kaset for macOS
- Light, dark or system appearance
- Automatic updates from GitHub Releases

### Listening Party
Let people on your Wi-Fi add songs to your queue from their phone or computer. No app or account is needed on their side.

1. Open **Settings → Party** and turn on **Listening Party**. The first time, Windows may ask to allow Kaset through the firewall; allow it on private networks.
2. Guests scan the QR code, or open the link shown, on any device on the same network.
3. They pick a name, search YouTube Music, and tap **Add**. Their songs go into Up Next after the current song, in the order requested, with their name beside them.

Guests also see what's playing and what's up next, updated live. As host you can:

- **Approve requests first**: requests wait at the top of Up Next until you accept or decline them.
- **Limit songs per guest**: how many songs one guest can have waiting at once (default 3).
- **Make a new link**: the old link and QR code stop working immediately.

Guests can only search and request songs. They can't skip, pause, remove songs or see your account. The page is served only to devices on your local network, only while the party is switched on, and only to people with the link.

### Keyboard shortcuts

| Action | Keys |
|---|---|
| Play / Pause | `Space` |
| Next / Previous track | `Ctrl+→` / `Ctrl+←` |
| Seek ±10 s | `→` / `←` |
| Volume up / down | `Ctrl+↑` / `Ctrl+↓` |
| Shuffle / Repeat | `Ctrl+S` / `Ctrl+R` |
| Like | `Ctrl+L` |
| Lyrics / Up Next | `Ctrl+Shift+L` / `Ctrl+Shift+Q` |
| Mini Player | `Ctrl+Shift+M` |
| Home / Explore / Library | `Ctrl+1` / `Ctrl+2` / `Ctrl+3` |
| Search | `Ctrl+F` |
| Command Bar | `Ctrl+K` |
| Refresh Home | `Ctrl+Shift+R` |
| Back / Forward | `Alt+←` / `Alt+→`, or the mouse side buttons |
| Settings | `Ctrl+,` |
| Switch Music / YouTube | `Ctrl+Shift+Y` |
| Captions / Full screen (YouTube) | `C` / `F` |
| Close Now Playing | `Esc` |

These follow Kaset's macOS shortcuts, with `Ctrl` in place of `⌘`.

## Requirements

- Windows 10 or 11 (x64 or ARM64). Acrylic glass needs Windows 11; Windows 10 shows solid surfaces instead.
- A Google account for your library and YouTube Music Premium.

## Installation

Download from the [latest release](https://github.com/sozercan/kaset/releases/latest):

- `Kaset-<version>-x64-Setup.exe` or `Kaset-<version>-arm64-Setup.exe` is the installer. It installs for your user only; you can pick the folder.
- `Kaset-<version>-portable.exe` runs without installing.

The builds aren't code-signed yet, so Windows SmartScreen may show a warning the first time. Click **More info**, then **Run anyway**.

## How it works

Kaset for Windows uses the same architecture as Kaset for macOS:

- **The UI talks to YouTube Music's InnerTube API** (the `WEB_REMIX` client) for browsing, search, the library, queues and actions. Requests are made from the `music.youtube.com` origin so your signed-in session's cookies apply, and they carry a `SAPISIDHASH` authorization header, just like Kaset's `YTMusicClient`.
- **YouTube mode uses a second transport** on `www.youtube.com` (the `WEB` client), with the `SAPISIDHASH` and `X-Origin` computed for that origin, like Kaset's `YouTubeClient`. Videos play in a `www.youtube.com` watch page shown as the video window, stripped down to the video.
- **Playback runs in a hidden YouTube Music web player.** Kaset owns the queue and drives the player through a small injected controller. That controller also takes over the page's Media Session, so Windows' media controls follow Kaset's queue. The equalizer is a Web Audio filter chain on the player's output.

```
src/main/main.js            app lifecycle, windows (main, mini, video, sign-in), tray, taskbar, jump list, updates, IPC + API
src/main/innertube.js       InnerTube transport (in-page fetch + SAPISIDHASH); YouTube Music client
src/main/youtube-innertube.js  the same transport for regular YouTube (WEB client, www.youtube.com)
src/main/parse.js           response parsers (shelves, items, headers, queues, lyrics)
src/main/parse-youtube.js   YouTube mode parsers (feeds, search, channels, playlists, watch-next)
src/main/player-preload.js  player controller for both playback windows, Media Session takeover, equalizer, video hover controls
src/main/party.js            Listening Party web server (guest requests over the local network)
src/party/                  the guest page served to phones and computers
src/main/app-preload.js     the bridge between the UI and the main process
src/renderer/               the UI (index.html/app.js/styles.css) and Mini Player (mini.html/mini.js)
```

## Development

```bash
npm install
npm start                 # run Kaset
npm test                  # live parser checks against public YouTube Music and YouTube endpoints
npx electron test/smoke.js <outDir>   # end-to-end: plays music, drives every view incl. YouTube mode, saves screenshots
npm run test:party        # end-to-end Listening Party check (starts the app, acts as guests)
npm run dist              # build installers into dist/
```

`npm run dist` needs a short project path: NSIS fails when paths inside `node_modules` exceed about 260 characters.

## Not in this release

- **YouTube extras**: Shorts, comments, chapters and Ask Gemini
- **Interface translations.** The interface is in English only, but YouTube Music content follows the content language set in Settings.
- **Apple-only features**, which have no Windows equivalent: Apple Intelligence, AppleScript, Siri and Shortcuts, Force Touch haptics, and WebKit Web Extensions
- **Last.fm scrobbling and account switching (brand accounts)**

## License

MIT, the same as Kaset. See [LICENSE](LICENSE). The app icon and equalizer presets come from [Kaset](https://github.com/sozercan/kaset).

## Disclaimer

Kaset is an unofficial application and is not affiliated with YouTube or Google Inc. in any way. "YouTube", "YouTube Music" and the "YouTube Logo" are registered trademarks of Google Inc.
