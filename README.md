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
- No build step — open `index.html` locally or deploy the repo root as static hosting

## Local preview

Serve the folder over HTTP (needed for the service worker), e.g. VS Code **Live Server**, or:

```bash
npx --yes serve .
```

## GitHub Pages

Enable **Settings → Pages → Deploy from branch `main` / root**. The game will be available at:

`https://delit.github.io/500/`

## License

MIT — use and remix freely.
