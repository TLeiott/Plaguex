#!/usr/bin/env bash
set -euo pipefail

# Kleine deterministische Medienproben für Range- und HLS-Tests erzeugen.
cd "$(dirname "$0")/.."
rm -f assets/sample.mp4 assets/hls/index.m3u8 assets/hls/*.ts
/usr/bin/ffmpeg -hide_banner -loglevel error -f lavfi -i 'testsrc2=size=320x180:rate=15:duration=10' -f lavfi -i 'sine=frequency=440:sample_rate=22050:duration=10' -c:v libx264 -profile:v baseline -pix_fmt yuv420p -preset veryfast -crf 34 -g 30 -keyint_min 30 -sc_threshold 0 -force_key_frames 'expr:gte(t,n_forced*2)' -c:a aac -b:a 32k -movflags +faststart -shortest assets/sample.mp4
/usr/bin/ffmpeg -hide_banner -loglevel error -i assets/sample.mp4 -c copy -f hls -hls_time 2 -hls_list_size 0 -hls_segment_filename 'assets/hls/segment%03d.ts' assets/hls/index.m3u8
