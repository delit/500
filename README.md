<div align="center">

<img src="./icon.svg" width="120" height="120" alt="The 1 to 500 Game icon" />

# The 1 to 500 Game

**Ten random draws from 1–500. Lock each into a slot so every value rises from top to bottom — one wrong confirm ends the run.**

[Play on GitHub Pages](https://delit.github.io/500/) · [Repository](https://github.com/delit/500)

</div>

---

## How it works

1. Each round shows a random integer **1–500** (slot-style roll).
2. Tap an empty row to **preview**, then **Confirm** (or tap the row again) to lock it in.
3. Locked numbers must stay **strictly increasing** from slot 01 → 10.
4. Fill all **10** slots in valid order to **win**. Your best depth and times are saved locally.

## Settings

Open **Settings** from the in-game footer (gear icon) on the game screen.

| Control | What it does |
|--------|----------------|
| **Sound** | Toggle game audio on/off (stored in `localStorage`). |
| **Vibration** | Toggle haptics on supported devices (stored in `localStorage`). |
| **Statistics** | Runs, wins, losses, win rate, total time in runs; optional **Reset statistics**. |
| **High score** | Leaderboard of finished runs (best depth first, then fastest time). |
| **Two player mode** | Opens the two-player explainer; **Start match** begins a pass-and-play session (see below). |
| **Install app** | Shown when the browser supports installing the PWA; adds the app to the home screen. |

Statistics and high score do **not** include two-player practice runs — those matches skip global stats bumps so solo stats stay meaningful.

## Two player mode

Two players compete on the **identical order of random numbers** (including roll decoys), so neither player gets a luckier draw sequence.

1. **Player 1** plays a full run until **win (10/10)** or **loss**. On a loss, the normal loss animation plays; after a short pause, a **pass device** screen asks you to hand the phone/tablet to Player 2 without showing the previous board.
2. **Player 2** confirms they are ready; the same seed is replayed for their run.
3. When both runs are done, **Show results** reveals **Match results**: slots filled (depth) and **time** for each player. Higher depth wins; if depth is tied, **faster time** wins.

Implementation notes:

- Logic lives in **`modes/twoplayer.js`** (loaded after `app.js`).
- `app.js` exposes `window.OneTo500Hooks` for a seeded `rollRandomInt`, run-end handling, and skipping solo stats during a match.
- Service worker **`sw.js`** caches `modes/twoplayer.js` for offline use.

## Tech

- Static **HTML / CSS (Tailwind CDN) / JavaScript**
- **PWA**: `manifest.json` + service worker (`sw.js`) for install and offline play
- **Two player**: `modes/twoplayer.js` + hooks in `app.js` (`OneTo500Hooks`, `OneTo500Game`)
- No build step — deploy the repo root as static hosting

## License

**Personal, non-commercial use only** — you may run and study the project for yourself; you may **not** use it for business/commercial purposes, sell or license the code, or use it on behalf of a company or organization without written permission.

Full terms: [LICENSE](./LICENSE) (custom license — not MIT/OSI).
