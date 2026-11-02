# Platforms

Atlas targets five platforms from one codebase. Nothing in the application layer knows
which platform it is running on — the same engine and the same REST API serve all of them.

## The split

```
core/        pure TypeScript — analytics, valuation, screening, backtest
             no DOM, no Node APIs, no platform calls
api/         one HTTP route table over core/          → any host that can serve HTTP
console/     vanilla HTML + CSS + JS, no framework      → any WebView or browser
shell/       a thin native wrapper per platform        → WebView + localhost server
```

Every feature is written as a **pure function in `core/`** and exposed as an **HTTP route**.
The UI only ever talks to that route. That is what makes a new platform a wrapper rather
than a rewrite.

## What each target needs

| Platform | Wrapper | Status |
|---|---|---|
| **Web / PWA** | none — the console is the app | working |
| **Android (.apk)** | WebView shell, assets bundled, `android/` | working, signed APK |
| **Windows (.exe)** | Electron or Tauri wrapping the same console | not built — Electron's binary truncates through this network |
| **iOS (.ipa)** | Capacitor or a WKWebView shell, same assets | not built — needs macOS |
| **macOS / Linux** | same as Windows | not built |

## Rules that keep it portable

1. **No platform APIs in `core/`.** A function that reads the filesystem or the DOM cannot
   be reused on a phone. Database access goes through `db.ts`, which takes a path.
2. **No framework in the console.** Vanilla JS has no build step, so the same files run in a
   browser, a WebView and an Electron renderer unchanged.
3. **No network assumptions in the UI.** The console calls relative `/api/...` paths; the
   shell decides what serves them.
4. **Storage is a file path.** SQLite opens by path, so desktop and mobile differ only in
   where that path points.
5. **Anything time-critical is computed server-side.** Device clocks and timezones differ;
   the engine does not depend on them.

## Why no React Native / Expo

The app was evaluated against AnalyzerX (Expo/React Native). Its features were rebuilt
natively here rather than adopted with their runtime, because:

- Expo binds the product to one toolchain and one distribution path (EAS builds, app-store
  flows), which would exclude `.exe` and a plain web deployment.
- A WebView shell ships the **identical** UI to every platform. A native rewrite would give
  Android a different interface from web, and this UI is the reason the merge was wanted.
- Zero framework dependencies means no upgrade treadmill and a smaller attack surface.

The features are portable; the Expo runtime was not carried over.

## Adding a platform

```
1. create shell/<platform>/
2. bundle src/console + dist as static assets
3. start the Node server on localhost and point the WebView at it
4. package
```

No change to `core/` or `api/` is required.
