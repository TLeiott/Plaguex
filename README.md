# Plaguex

A fast, no-nonsense Plex client for Linux and Android. Free software under the AGPLv3.

Plaguex talks directly to your Plex Media Server. No Discover feed, no ads, no Plex Pass paywall for
downloads, and it only transcodes when your device genuinely cannot play the file.

## Status

Early development. Web build works against a Plex server; Linux and Android shells via Tauri are in progress.

| Feature                                                             | Status             |
| ------------------------------------------------------------------- | ------------------ |
| plex.tv sign-in (PIN flow), server discovery, connection racing     | ✅                 |
| Home: continue watching, recently added                             | ✅                 |
| Movie and TV libraries, hubs, infinite grid with sort/filter        | ✅                 |
| Detail pages, seasons, episodes, mark watched                       | ✅                 |
| Search                                                              | ✅                 |
| Player: direct play → direct stream → transcode, automatic fallback | ✅                 |
| Audio/subtitle selection persisted to the server                    | ✅                 |
| Skip intro / credits markers, next episode autoplay                 | ✅                 |
| Keyboard shortcuts                                                  | ✅                 |
| Downloads for offline playback (Linux/Android)                      | 🚧                 |
| Linux desktop app (Tauri)                                           | 🚧                 |
| Android app (Tauri)                                                 | 🚧                 |
| Native mpv playback backend on Linux                                | planned            |
| Music, photos, live TV                                              | not planned for v1 |

## Repository layout

```
apps/web            React 19 + Vite app (the client itself)
apps/desktop        Tauri 2 shell for Linux and Android (Rust glue for downloads)
crates/downloader   Resumable HTTP download engine (Rust, no Tauri dependency, unit-tested)
packages/plex-api   Typed, dependency-free client for plex.tv and Plex Media Server
packages/mock-plex  Fake Plex server + plex.tv used by tests and for offline development
e2e                 Playwright UI test suite (desktop + Android viewports)
scripts             Dev tooling (e.g. `pnpm plex:login`)
```

## Development

Requirements: Node ≥ 22, pnpm 11.

```sh
pnpm install
pnpm dev:mock        # fake Plex server on http://127.0.0.1:32400
pnpm dev             # web app on http://127.0.0.1:5173
```

To point the dev build at the mock plex.tv instead of the real one:

```sh
VITE_PLEXTV_URL=http://127.0.0.1:32400/plextv VITE_PLEX_AUTH_APP_URL=http://127.0.0.1:32400/plextv/auth pnpm dev
```

Against a real server, just run `pnpm dev` and sign in normally.

### Checks

```sh
pnpm check           # typecheck + lint + format + unit tests
pnpm test:e2e        # Playwright UI suite (starts mock server + built app itself)
```

### Desktop (Linux) and Android

Native shells use [Tauri 2](https://tauri.app). Prerequisites on Arch-based systems:

```sh
sudo pacman -S --needed webkit2gtk-4.1 libappindicator-gtk3 librsvg base-devel openssl
curl https://sh.rustup.rs -sSf | sh          # Rust toolchain
```

```sh
pnpm --filter @plaguex/desktop dev            # desktop dev window against `pnpm dev`
pnpm --filter @plaguex/desktop tauri build    # .deb / .rpm / AppImage in apps/desktop/src-tauri/target
```

Android additionally needs JDK 17+, the Android SDK (platform 35, build-tools, NDK) and the Rust
Android targets (`rustup target add aarch64-linux-android armv7-linux-androideabi`).

```sh
. scripts/android-env.sh                      # exports JAVA_HOME / ANDROID_HOME / NDK_HOME
pnpm --filter @plaguex/desktop android:init   # once: generates the Gradle project
pnpm --filter @plaguex/desktop android:build  # APK in apps/desktop/src-tauri/gen/android/app/build/outputs
```

### Keyboard shortcuts (player)

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

## License

AGPL-3.0-only. See [LICENSE](LICENSE).
