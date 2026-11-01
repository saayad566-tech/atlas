#!/usr/bin/env bash
# Download the Android build toolchain into a work directory. Idempotent: re-running
# skips anything already present. Nothing here is a secret, so it can be re-fetched
# on any machine after a sandbox reset.
set -euo pipefail
TC="${ATLAS_TOOLCHAIN:-/scratch/work/toolchain}"
mkdir -p "$TC"; cd "$TC"

need_jdk() { [ -d "$TC"/jdk-17* ] || return 0; return 1; }
if need_jdk; then
  echo "→ JDK 17"
  curl -sL --max-time 300 -o jdk.tar.gz \
    "https://api.adoptium.net/v3/binary/latest/17/ga/linux/x64/jdk/hotspot/normal/eclipse"
  tar -xzf jdk.tar.gz && rm -f jdk.tar.gz
else echo "✓ JDK present"; fi

if [ ! -x "$(find "$TC/android" -name aapt2 2>/dev/null | head -1)" ]; then
  echo "→ build-tools 34"
  curl -sL --max-time 300 -o bt.zip "https://dl.google.com/android/repository/build-tools_r34-linux.zip"
  unzip -qo bt.zip -d android && rm -f bt.zip
else echo "✓ build-tools present"; fi

if [ ! -f "$TC/android/android-34/android.jar" ]; then
  echo "→ platform 34"
  curl -sL --max-time 300 -o platform.zip "https://dl.google.com/android/repository/platform-34-ext7_r03.zip"
  unzip -qo platform.zip -d android && rm -f platform.zip
else echo "✓ platform present"; fi

echo "toolchain ready at $TC"
