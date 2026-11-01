#!/usr/bin/env bash
# Sign an APK (or AAB) with your own keystore, and emit the assetlinks fingerprint.
#
# Why this exists: MIUI / Play Protect flag an APK whose signature is missing or
# unknown ("Risks detected"). A properly signed APK removes that warning and is the
# only way Play will accept an upload.
#
# Requires: JDK (keytool) + Android build-tools (zipalign, apksigner) on PATH.
set -euo pipefail
APK="${1:-}"
KEYSTORE="${KEYSTORE:-signing/atlas-release.keystore}"
ALIAS="${ALIAS:-atlas}"
OUTDIR="${OUTDIR:-signing}"

if ! command -v keytool >/dev/null 2>&1; then echo "ERROR: keytool not found — install a JDK (17+)."; exit 1; fi
if ! command -v apksigner >/dev/null 2>&1; then echo "ERROR: apksigner not found — install Android build-tools."; exit 1; fi

mkdir -p "$OUTDIR"

# 1. Create the keystore once. KEEP IT: losing it means you can never update the app.
if [ ! -f "$KEYSTORE" ]; then
  echo "Creating keystore at $KEYSTORE (valid 10000 days)…"
  read -r -s -p "Choose a keystore password: " KSPASS; echo
  read -r -s -p "Confirm: " KSPASS2; echo
  [ "$KSPASS" = "$KSPASS2" ] || { echo "Passwords differ."; exit 1; }
  keytool -genkeypair -v -keystore "$KEYSTORE" -alias "$ALIAS" \
    -keyalg RSA -keysize 2048 -validity 10000 \
    -storepass "$KSPASS" -keypass "$KSPASS" \
    -dname "CN=Atlas, OU=Mobile, O=Atlas, L=, ST=, C=IN"
  printf '%s' "$KSPASS" > "$OUTDIR/.kspass"
  chmod 600 "$OUTDIR/.kspass"
else
  KSPASS="$(cat "$OUTDIR/.kspass" 2>/dev/null || true)"
  [ -n "$KSPASS" ] || { read -r -s -p "Keystore password: " KSPASS; echo; }
fi

# 2. Publish the SHA-256 fingerprint — required by assetlinks.json for TWA.
keytool -list -v -keystore "$KEYSTORE" -alias "$ALIAS" -storepass "$KSPASS" \
  | awk '/SHA256:/{print $2; exit}' > "$OUTDIR/SHA256.txt"
echo "SHA-256 fingerprint: $(cat "$OUTDIR/SHA256.txt")"

[ -n "$APK" ] || { echo "No APK given — keystore ready. Re-run with: $0 path/to/app.apk"; exit 0; }
[ -f "$APK" ] || { echo "ERROR: $APK not found."; exit 1; }

# 3. Align, then sign (v2+v3 schemes — what modern Android verifies).
BASE="$(basename "${APK%.apk}")"
ALIGNED="$OUTDIR/${BASE}-aligned.apk"
SIGNED="$OUTDIR/${BASE}-signed.apk"
command -v zipalign >/dev/null 2>&1 && zipalign -p -f 4 "$APK" "$ALIGNED" || cp "$APK" "$ALIGNED"
apksigner sign --ks "$KEYSTORE" --ks-key-alias "$ALIAS" \
  --ks-pass "pass:$KSPASS" --key-pass "pass:$KSPASS" \
  --v1-signing-enabled true --v2-signing-enabled true --v3-signing-enabled true \
  --out "$SIGNED" "$ALIGNED"

# 4. Prove it.
apksigner verify --print-certs --verbose "$SIGNED" | tee "$OUTDIR/verify.txt"
echo
echo "Signed APK: $SIGNED"
echo "Install it with:  adb install -r \"$SIGNED\""
echo "Then host assetlinks.json at https://YOUR-HOST/.well-known/assetlinks.json"
