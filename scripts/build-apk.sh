#!/usr/bin/env bash
# The JVM defaults to a heap this device cannot reserve. Cap it so the build does not die
# with "Could not reserve enough space for object heap" on a 2 GB machine.
# Append rather than default: the environment may already set other JVM flags, and a plain
# default would silently keep them while never adding the heap cap.
case "${JAVA_TOOL_OPTIONS:-}" in
  *-Xmx*) : ;;                                   # a heap is already specified
  *) export JAVA_TOOL_OPTIONS="${JAVA_TOOL_OPTIONS:-} -Xmx768m" ;;
esac
# Build a signed release APK from the PWA without Gradle.
# Everything is reproducible: the keystore is generated from documented values if it is
# missing, so no binary secret has to survive between machines.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TC="${ATLAS_TOOLCHAIN:-/scratch/work/toolchain}"
OUT="${ATLAS_OUT:-/scratch/output}"
WORK="${ATLAS_BUILD:-/scratch/work/apkbuild}"
KEYSTORE="${ATLAS_KEYSTORE:-/scratch/work/keys/atlas-release.keystore}"
KS_PASS="${ATLAS_KS_PASS:-atlas-release-2026}"
KS_ALIAS="${ATLAS_KS_ALIAS:-atlas}"

JDK="$(find "$TC" -maxdepth 1 -type d -name 'jdk-17*' | head -1)"
BT="$(find "$TC/android" -maxdepth 2 -type d -name 'android-14' | head -1)"
AJAR="$TC/android/android-34/android.jar"
[ -x "$JDK/bin/javac" ] || { echo "toolchain missing — run scripts/install-toolchain.sh"; exit 1; }
[ -n "$BT" ] || { echo "build-tools missing"; exit 1; }
[ -f "$AJAR" ] || { echo "android.jar missing"; exit 1; }

export JAVA_HOME="$JDK"; export PATH="$JDK/bin:$PATH"
rm -rf "$WORK"; mkdir -p "$WORK/gen" "$WORK/classes" "$WORK/dex" "$WORK/apk" "$WORK/assets/www"

echo "→ assets"
cp -r "$ROOT/dist/console/." "$WORK/assets/www/" 2>/dev/null || cp -r "$ROOT/src/console/." "$WORK/assets/www/"

echo "→ resources"
"$BT/aapt2" compile --dir "$ROOT/android/app/src/main/res" -o "$WORK/res.zip"
"$BT/aapt2" link -o "$WORK/base.apk" -I "$AJAR" \
  --manifest "$ROOT/android/app/src/main/AndroidManifest.xml" \
  -A "$WORK/assets" --java "$WORK/gen" "$WORK/res.zip" --auto-add-overlay

echo "→ compile"
"$JDK/bin/javac" -source 17 -target 17 -classpath "$AJAR" -nowarn \
  -d "$WORK/classes" $(find "$ROOT/android/app/src/main/java" "$WORK/gen" -name '*.java')

echo "→ dex"
"$BT/d8" --lib "$AJAR" --min-api 23 --output "$WORK/dex" $(find "$WORK/classes" -name '*.class')

echo "→ package"
cd "$WORK/apk" && unzip -qo ../base.apk && cp ../dex/classes.dex .
# Android 11+ rejects an APK whose resources.arsc is compressed (INSTALL_FAILED_INVALID_APK,
# which MIUI surfaces as "Couldn't install (-124)"). Store it uncompressed, then align.
rm -f ../unsigned.apk
zip -qr ../unsigned.apk . -x 'resources.arsc'
zip -q0 ../unsigned.apk resources.arsc

echo "→ align + sign"
"$BT/zipalign" -f 4 "$WORK/unsigned.apk" "$WORK/aligned.apk"
mkdir -p "$(dirname "$KEYSTORE")"
if [ ! -f "$KEYSTORE" ]; then
  echo "→ generating release keystore (documented values, not a stored secret)"
  "$JDK/bin/keytool" -genkeypair -v -keystore "$KEYSTORE" -alias "$KS_ALIAS" \
    -keyalg RSA -keysize 2048 -validity 10000 \
    -storepass "$KS_PASS" -keypass "$KS_PASS" \
    -dname "CN=Atlas, OU=Mobile, O=Atlas, L=, S=, C=IN" >/dev/null 2>&1
fi
"$BT/apksigner" sign --ks "$KEYSTORE" --ks-key-alias "$KS_ALIAS" \
  --ks-pass "pass:$KS_PASS" --key-pass "pass:$KS_PASS" \
  --min-sdk-version 23 --max-sdk-version 34 \
  --out "$WORK/atlas-release.apk" "$WORK/aligned.apk"
"$BT/apksigner" verify --print-certs "$WORK/atlas-release.apk" | head -3

mkdir -p "$OUT"; cp "$WORK/atlas-release.apk" "$OUT/atlas-release.apk"
echo "APK: $OUT/atlas-release.apk ($(du -h "$OUT/atlas-release.apk" | cut -f1))"
