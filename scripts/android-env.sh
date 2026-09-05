#!/usr/bin/env sh
# Source this before `pnpm --filter @plaguex/desktop android:*`.
export JAVA_HOME="${JAVA_HOME:-/usr/lib/jvm/java-21-openjdk}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Android/Sdk}"
export NDK_HOME="${NDK_HOME:-$(ls -d "$ANDROID_HOME"/ndk/* 2>/dev/null | sort -V | tail -1)}"
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin:$HOME/.cargo/bin:$PATH"
echo "JAVA_HOME=$JAVA_HOME ANDROID_HOME=$ANDROID_HOME NDK_HOME=$NDK_HOME"
