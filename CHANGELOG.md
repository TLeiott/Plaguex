# Changelog

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
