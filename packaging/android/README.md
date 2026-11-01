# Building the Android app — and why MIUI says "Risks detected"

## The two things your screenshots show

**1. `freewebtoapk` — "Please enter package name"**

Fill the form exactly like this:

| Field | Value |
|---|---|
| App name | `Atlas` |
| **Package name** | `com.atlas.finance` |
| Version | `1.0.0` |
| Version code | `1` |
| Minimum Android | `24` (Android 7.0 — matches what the form already suggests) |
| Theme / primary colour | `#1A56DB` (the screenshot shows `#4F46E5`, which is their default — change it so the app matches `manifest.json`) |
| Start URL | `https://YOUR-HOST/` — must be **HTTPS** |
| Icon | upload `icons/icon-512.png` from `atlas-pwa.zip` |

Rules for a package name: two or more dot-separated segments, letters/digits/underscore,
each segment starting with a letter. `com.atlas.finance` satisfies all of it. It must be
unique on the device — if you already installed a build with another name, uninstall it
first.

**2. MIUI package installer — "Risks detected. Connect to the internet and try again."**

That is **not a code error in the app**. MIUI runs its own scan before installing, and the
message means one of:

- the APK is **unsigned or debug-signed** — the signature is unknown to MIUI, so it cannot
  clear the app;
- the phone **had no working internet at that moment**, so MIUI's online check failed
  ("A network error occurred. Couldn't check this app.").

### Fix it, in order

1. **Sign the APK** — the real fix. See below. An APK signed with your own release
   keystore stops the "unknown developer" warning and is required by Play anyway.
2. **Turn on mobile data / Wi-Fi** during install so MIUI's check can complete.
3. **Install with adb** — bypasses the MIUI installer entirely:
   `adb install -r atlas-signed.apk`
4. **Or** MIUI: *Settings → Security → Scan apps before installing* → off, and allow
   *Install from unknown sources* for your file manager.

## Signing (do this once, keep the keystore forever)

Requires a JDK and Android build-tools on your machine:

```bash
bash scripts/sign-apk.sh                     # creates signing/atlas-release.keystore + SHA-256
bash scripts/sign-apk.sh path/to/app.apk     # aligns, signs (v1+v2+v3), verifies
```

It prints the SHA-256 fingerprint and writes `signing/SHA256.txt`. **Losing the keystore
means you can never update the app on Play** — back it up.

## Trusted Web Activity (the proper path)

A generic webview wrapper shows a browser bar and fails asset verification. A **TWA**
runs your PWA full-screen with no chrome, verified by Digital Asset Links:

```bash
npm i -g @bubblewrap/cli
bubblewrap init --manifest https://YOUR-HOST/manifest.json
# edit twa-manifest.json using packaging/android/twa-manifest.json as the template
bubblewrap build          # produces a signed APK + AAB
```

Then publish the fingerprint:

```bash
cp packaging/android/assetlinks.template.json packaging/android/assetlinks.json
# replace REPLACE_WITH_SHA256... with the value from signing/SHA256.txt
```

The server serves it at `https://YOUR-HOST/.well-known/assetlinks.json` automatically once
that file exists. Verify with:

```bash
curl https://YOUR-HOST/.well-known/assetlinks.json
```

## What cannot be done in this environment

There is **no JDK, no Android SDK, no keytool and no apksigner** in the sandbox this
project was built in, so no APK can be compiled or signed here. The scripts and configs
above are complete and run wherever those tools exist — but they are **unverified in this
sandbox**, and I am telling you that rather than claiming a signed APK exists.
