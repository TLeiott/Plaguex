# Changelog

## 1.1.0 — 2026-09-06

The stutter release. Investigated frame drops reported on a Galaxy S23 Ultra down to the Qualcomm
HEVC decoder path and shipped a way around it.

### Player

- **Play in another app** (Android): hand any title, streamed or downloaded, to an installed player
  such as VLC or MX Player with the resume position, title and external subtitles. The end position
  comes back to Plaguex and is pushed to Plex, so resume and next-episode autoplay keep working.
  This is the default on Android; **Play in app** stays one tap away on every item and download.
- Native ExoPlayer surface on Android (SurfaceView under a transparent WebView): direct plays
  everything, renders embedded and image subtitles natively, no server burn-in.
- Video decoder setting for the native surface (hardware default or software), for files a hardware
  decoder mishandles.
- The `Play with mpv` / `Play in another app` setting is now a platform-aware default
  (`settings.player`); an explicit choice always wins.

### Diagnostics

- Playback probes run full-screen so the compositor is part of the measurement, and report frame
  pacing (presented frames, median gap, hitches, main-thread jank).
- Native-player probes with decoder counters (dropped, skipped, longest drop streak, frame
  lateness), a video-only run, a run per alternative decoder and a cross-codec comparison title.
- Device state section: thermal status and headroom, power-save mode, battery, display modes and
  refresh rate, HDR types and what every hardware decoder claims it can sustain at 1080p.
- "Open in another player" A/B button on the Diagnostics page.

### Fixes

- Release APKs keep reflection-filled argument classes under R8.
- Clippy passes on non-Android targets for the Android plugin crate.

### Known limitations

- Some HEVC 10-bit files drop ~30% of frames in every in-app renderer on Qualcomm devices while
  VLC plays them smoothly; hence the external-player default on Android.
- Embedded subtitles still require a server burn-in in the web player.

## 1.0.0 — 2026-09-05

First release. Built and verified in a single day against a live Plex Media Server (1.43) and a
Galaxy S23 Ultra.

### Client

- plex.tv PIN sign-in, server discovery, connection racing (local > remote > relay)
- Home (continue watching / on deck, recently added), movie and TV libraries with hubs and infinite
  grids, detail pages, seasons and episodes, search, mark watched
- Player: direct play → direct stream → transcode with automatic fallback, audio/subtitle selection
  persisted to the server, skip intro/credits, next-episode autoplay, keyboard shortcuts, resume,
  progress reporting with keepalive on exit, maximum-resolution cap, playback stats overlay
- Offline mode: the app stays usable without the server; downloads play from a loopback file server
- Diagnostics & benchmark page producing a shareable report

### Downloads

- Resumable Rust download engine with a persisted manifest and a 2-slot queue
- Original file or server re-encode presets with size estimates; movies, episodes, seasons, series
- Grouped Downloads page; Android foreground service keeps transfers running in the background

### Platforms

- Linux (Tauri 2, WebKitGTK) with an external mpv backend that direct plays everything
- Android (Tauri 2) with a native plugin for screen rotation, system-bar insets, immersive playback,
  background downloads and report sharing

### Known limitations

- Embedded subtitles are burned in by the server in the HTML5 player (Plex does not serve them to
  browsers); mpv renders them natively on Linux
- Offline playback of original MKV files depends on the Android WebView's codec support; re-encoded
  downloads (H.264/AAC) are the reliable choice until the native Android player lands
- Frame drops reported on some local files are under investigation (use Settings → Diagnostics)
- After Plex login in the browser, the user switches back to the app manually
- Server re-encode quality is subject to the server owner's remote-stream limit for shared users
