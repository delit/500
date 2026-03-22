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

## Tech

- Static **HTML / CSS (Tailwind CDN) / JavaScript**
- **PWA**: `manifest.json` + service worker (`sw.js`) for install and offline play
- No build step — deploy the repo root as static hosting

## GitHub Pages

1. Repo **Settings → Pages**
2. **Build and deployment**: Source **Deploy from a branch**
3. Branch **main**, folder **/ (root)** → Save
4. Wait 1–2 minutes; the site URL is shown on that same page (typically `https://delit.github.io/500/`)

If you get **404** at that URL, Pages is usually not enabled yet or the branch/folder is wrong. The code uses relative paths (`./app.js`, `./sw.js`, etc.), so it is meant to work under `/500/`.

This repo includes a **`.nojekyll`** file so GitHub serves the files as plain static assets.

## License

**Personal, non-commercial use only** — you may run and study the project for yourself; you may **not** use it for business/commercial purposes, sell or license the code, or use it on behalf of a company or organization without written permission.

Full terms: [LICENSE](./LICENSE) (custom license — not MIT/OSI).
