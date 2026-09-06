# Plaguex

**A fast, no-nonsense Plex client for Linux and Android.**

[![CI](https://github.com/TLeiott/Plaguex/actions/workflows/ci.yml/badge.svg)](https://github.com/TLeiott/Plaguex/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/TLeiott/Plaguex)](https://github.com/TLeiott/Plaguex/releases/latest)
[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)

Plaguex talks directly to your Plex Media Server. There is no Discover feed, no advertising and no
Plex Pass paywall on downloads. It plays the original file whenever your device can decode it and
only asks the server to transcode when it really has to.

## Highlights

- **Direct play first.** Direct play, then direct stream, then transcode, with automatic fallback on
  media errors. A playback stats overlay shows what is actually happening.
- **Downloads without Plex Pass.** Resumable downloads of movies, episodes, seasons and whole shows,
  as the original file or a server re-encode with size estimates. Downloads continue in the
  background on Android and play offline.
- **Use the player you trust.** Plaguex can hand any title, streamed or downloaded, to an installed
  player such as VLC on Android or mpv on Linux, resuming at the right position and syncing your
  watch progress back to Plex. On Android this is the default; the built-in player is one tap away.
- **Everything else you expect.** Continue watching, libraries with sort and filter, search, seasons
  and episodes, mark watched, audio and subtitle selection persisted to the server, skip intro and
  credits, next-episode autoplay, keyboard shortcuts.
- **Diagnostics built in.** Settings → Diagnostics runs a benchmark against your server and device
  and produces a shareable report, including frame-pacing measurements for the built-in players.

## Install

**Android:** download the APK from the [latest release](https://github.com/TLeiott/Plaguex/releases/latest)
and install it. The build is signed with the project's release key; Android will ask you to allow
installs from your browser or file manager once.

**Linux:** build from source (see below). Packaged builds (`.deb`, `.rpm`, AppImage) come out of
`pnpm --filter @plaguex/desktop tauri build`.

**Browser:** the web client runs in any modern browser with `pnpm dev` or `pnpm build`.

## Platform notes

| Platform | Player                                                                                                   | Downloads                   |
| -------- | -------------------------------------------------------------------------------------------------------- | --------------------------- |
| Android  | External app (VLC & co.) by default; built-in players (ExoPlayer surface or WebView) available per title | Background service, offline |
| Linux    | Built-in web player by default; mpv opt-in in Settings (direct plays everything, all subtitle formats)   | Resumable, offline          |
| Browser  | Web player                                                                                               | Not available               |

### Why "another app" is the default on Android

On Qualcomm devices some HEVC 10-bit files stutter in every renderer that schedules frames through
Android's media stack, including Samsung's own player, while VLC plays them smoothly. Rather than
ship a player that is only sometimes smooth, Plaguex hands the file to the player that is, and
keeps Plex's progress in sync. Turn off **Play in another app** in Settings to make the built-in
player the default instead.

### Subtitles

- External subtitle files are fetched as WebVTT and rendered by the built-in player without
  transcoding.
- Embedded subtitles are rendered natively by the external players (VLC, mpv) and the Android
  ExoPlayer surface. The web player has to ask the server to burn them in, because Plex Media
  Server does not serve embedded subtitle tracks to browsers.

### Keyboard shortcuts (built-in player)

| Key       | Action               |
| --------- | -------------------- |
| Space / K | play / pause         |
| ← → / J L | seek 10 s            |
| ↑ ↓       | volume               |
| M         | mute                 |
| F         | fullscreen           |
| C         | toggle subtitles     |
| S         | skip intro / credits |
| N         | next episode         |
| Esc       | back                 |

## Development

Requirements: Node ≥ 22, pnpm 11. Rust and the Tauri prerequisites are only needed for the native
shells.

```sh
pnpm install
pnpm dev:mock        # fake Plex server on http://127.0.0.1:32400
pnpm dev             # web app on http://127.0.0.1:5173
```

To point the dev build at the mock plex.tv instead of the real one:

```sh
VITE_PLEXTV_URL=http://127.0.0.1:32400/plextv VITE_PLEX_AUTH_APP_URL=http://127.0.0.1:32400/plextv/auth pnpm dev
```

Against a real server, run `pnpm dev` and sign in normally.

### Checks

```sh
pnpm check           # typecheck + lint + format + unit tests
pnpm test:e2e        # Playwright UI suite (starts the mock server and a built app itself)
cargo clippy --workspace --all-targets -- -D warnings
```

CI runs all of the above on every push.

### Linux desktop

Native shells use [Tauri 2](https://tauri.app). Prerequisites on Arch-based systems:

```sh
sudo pacman -S --needed webkit2gtk-4.1 libappindicator-gtk3 librsvg base-devel openssl
curl https://sh.rustup.rs -sSf | sh          # Rust toolchain
```

```sh
pnpm --filter @plaguex/desktop dev            # desktop dev window against `pnpm dev`
pnpm --filter @plaguex/desktop tauri build    # .deb / .rpm / AppImage in apps/desktop/src-tauri/target
```

### Android

Additionally needs JDK 17+, the Android SDK (platform 35, build-tools, NDK) and the Rust Android
targets (`rustup target add aarch64-linux-android armv7-linux-androideabi`).

```sh
. scripts/android-env.sh                      # exports JAVA_HOME / ANDROID_HOME / NDK_HOME
pnpm --filter @plaguex/desktop android:init   # once: generates the Gradle project
pnpm --filter @plaguex/desktop android:build  # APK in apps/desktop/src-tauri/gen/android/app/build/outputs
```

Release APKs are aligned with `zipalign` and signed with `apksigner` before publishing.

## Repository layout

```
apps/web                            React 19 + Vite client (the app itself)
apps/desktop                        Tauri 2 shell for Linux and Android
crates/downloader                   Resumable HTTP download engine and loopback file server (Rust)
crates/mpv                          mpv process control for the Linux external player (Rust)
crates/tauri-plugin-plaguex-android Android plugin: ExoPlayer surface, external player hand-off,
                                    screen/insets control, background downloads, diagnostics
packages/plex-api                   Typed, dependency-free client for plex.tv and Plex Media Server
packages/mock-plex                  Fake Plex server and plex.tv used by tests and offline development
e2e                                 Playwright UI suite (desktop and Android viewports)
scripts                             Developer tooling, e.g. `pnpm plex:login`
```

## Contributing

Issues and pull requests are welcome. Please keep `pnpm check`, `pnpm test:e2e` and
`cargo clippy --workspace --all-targets -- -D warnings` green, and use
[Conventional Commits](https://www.conventionalcommits.org/) for commit messages.

## License

AGPL-3.0-only. See [LICENSE](LICENSE).
