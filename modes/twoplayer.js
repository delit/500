/**
 * Two-player mode: same RNG seed for both runs, pass-and-play, results compare.
 * Depends on app.js exposing window.OneTo500Game and window.OneTo500Hooks.
 */
(function () {
  "use strict";

  const $ = (sel, el = document) => el.querySelector(sel);

  /** @type {{ seed: number, p1: { score: number; timeMs: number; won: boolean } | null; p2: { score: number; timeMs: number; won: boolean } | null } | null} */
  let session = null;

  /** @type {{ p1: object; p2: object } | null} */
  let resultsSnapshot = null;

  /** @type {ReturnType<typeof setTimeout> | null} */
  let passOverlayDelayTimer = null;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let preResultsDelayTimer = null;

  function clearTwoPlayerUiTimers() {
    if (passOverlayDelayTimer != null) {
      clearTimeout(passOverlayDelayTimer);
      passOverlayDelayTimer = null;
    }
    if (preResultsDelayTimer != null) {
      clearTimeout(preResultsDelayTimer);
      preResultsDelayTimer = null;
    }
  }

  function createUniform01(seed) {
    let s = seed >>> 0;
    if (s === 0) s = 0xdeadbeef;
    return function () {
      s |= 0;
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  let rollUniform = null;

  function installRollRngFromSeed(seed) {
    rollUniform = createUniform01(seed);
    window.OneTo500Hooks.rollRandomInt = function (a, b) {
      return a + Math.floor(rollUniform() * (b - a + 1));
    };
  }

  function tearDownHooksOnly() {
    delete window.OneTo500Hooks.rollRandomInt;
    delete window.OneTo500Hooks.handleRunEnd;
    delete window.OneTo500Hooks.skipRunStatsBump;
    delete window.OneTo500Hooks.abortTwoPlayerIfActive;
    delete window.OneTo500Hooks.onGoHomeFromGame;
  }

  function hideBanner() {
    const rollLabel = $("#roll-draw-label");
    if (rollLabel) {
      rollLabel.classList.remove("roll-draw-label--game-over");
      rollLabel.textContent = "Current draw";
      rollLabel.removeAttribute("aria-live");
    }
  }

  function showBanner(playerNum) {
    const rollLabel = $("#roll-draw-label");
    if (rollLabel) {
      rollLabel.classList.remove("roll-draw-label--game-over");
      rollLabel.textContent = `PLAYER ${playerNum}`;
      rollLabel.setAttribute("aria-live", "polite");
    }
  }

  function hidePassOverlay() {
    const game = window.OneTo500Game;
    if (game && typeof game.resumeTimerAfterOverlay === "function") {
      game.resumeTimerAfterOverlay();
    }
    const o = $("#tp-pass-overlay");
    if (o) {
      o.classList.add("hidden");
      o.setAttribute("aria-hidden", "true");
    }
  }

  function hidePreResultsOverlay() {
    const o = $("#tp-pre-results-overlay");
    if (o) {
      o.classList.add("hidden");
      o.setAttribute("aria-hidden", "true");
    }
  }

  function showPreResultsOverlay() {
    const game = window.OneTo500Game;
    if (game && typeof game.pauseTimerForOverlay === "function") {
      game.pauseTimerForOverlay();
    }
    const o = $("#tp-pre-results-overlay");
    if (o) {
      o.classList.remove("hidden");
      o.setAttribute("aria-hidden", "false");
    }
  }

  function showPassOverlay() {
    const game = window.OneTo500Game;
    if (game && typeof game.pauseTimerForOverlay === "function") {
      game.pauseTimerForOverlay();
    }
    const o = $("#tp-pass-overlay");
    if (o) {
      o.classList.remove("hidden");
      o.setAttribute("aria-hidden", "false");
    }
  }

  function openModalEl(m) {
    if (!m) return;
    const game = window.OneTo500Game;
    if (game && typeof game.pauseTimerForOverlay === "function") {
      game.pauseTimerForOverlay();
    }
    m.classList.add("is-open");
    m.setAttribute("aria-hidden", "false");
  }

  function closeModalEl(m) {
    if (!m) return;
    m.classList.remove("is-open");
    m.setAttribute("aria-hidden", "true");
    const game = window.OneTo500Game;
    if (game && typeof game.resumeTimerAfterOverlay === "function") {
      game.resumeTimerAfterOverlay();
    }
  }

  function computeWinner(p1, p2) {
    if (p1.score > p2.score) return 1;
    if (p2.score > p1.score) return 2;
    if (p1.timeMs < p2.timeMs) return 1;
    if (p2.timeMs < p1.timeMs) return 2;
    return 0;
  }

  function fillAndShowResults() {
    if (!resultsSnapshot) {
      closeModalEl($("#modal-twoplayer-results"));
      return;
    }
    const fmt = window.OneTo500Game && window.OneTo500Game.formatGameElapsed;
    const f = typeof fmt === "function" ? fmt : (ms) => String(ms);
    const { p1, p2 } = resultsSnapshot;
    const elP1s = $("#tp-res-p1-score");
    const elP1t = $("#tp-res-p1-time");
    const elP2s = $("#tp-res-p2-score");
    const elP2t = $("#tp-res-p2-time");
    const elWin = $("#tp-res-winner");
    const card1 = $("#tp-res-card-p1");
    const card2 = $("#tp-res-card-p2");

    if (elP1s) elP1s.textContent = `${p1.score}/10`;
    if (elP1t) elP1t.textContent = f(p1.timeMs);
    if (elP2s) elP2s.textContent = `${p2.score}/10`;
    if (elP2t) elP2t.textContent = f(p2.timeMs);
    const w = computeWinner(p1, p2);
    if (elWin) {
      if (w === 0) elWin.textContent = "It’s a tie";
      else elWin.textContent = `Player ${w} wins`;
    }

    [card1, card2].forEach((c) => {
      if (c) c.classList.remove("tp-res-card-highlight", "tp-res-card-muted");
    });
    if (w === 1) {
      card1 && card1.classList.add("tp-res-card-highlight");
      card2 && card2.classList.add("tp-res-card-muted");
    } else if (w === 2) {
      card2 && card2.classList.add("tp-res-card-highlight");
      card1 && card1.classList.add("tp-res-card-muted");
    } else {
      card1 && card1.classList.add("tp-res-card-highlight");
      card2 && card2.classList.add("tp-res-card-highlight");
    }

    openModalEl($("#modal-twoplayer-results"));
  }

  function handleRunEnd(detail) {
    if (!session) return false;
    const won = detail.outcome === "win";
    const rec = {
      score: detail.score,
      timeMs: detail.elapsedMs,
      won,
    };

    if (session.p1 == null) {
      session.p1 = rec;
      clearTwoPlayerUiTimers();
      const loss = detail.outcome === "loss";
      const delayMs = loss ? 1000 : 0;
      if (delayMs > 0) {
        passOverlayDelayTimer = window.setTimeout(() => {
          passOverlayDelayTimer = null;
          showPassOverlay();
        }, delayMs);
      } else {
        showPassOverlay();
      }
      return true;
    }

    if (session.p2 == null) {
      session.p2 = rec;
      resultsSnapshot = { p1: session.p1, p2: session.p2 };
      tearDownHooksOnly();
      session = null;
      clearTwoPlayerUiTimers();
      const loss = detail.outcome === "loss";
      const delayMs = loss ? 1000 : 0;
      const finishToPreResults = () => {
        preResultsDelayTimer = null;
        hideBanner();
        hidePassOverlay();
        showPreResultsOverlay();
      };
      if (delayMs > 0) {
        preResultsDelayTimer = window.setTimeout(finishToPreResults, delayMs);
      } else {
        finishToPreResults();
      }
      return true;
    }

    return false;
  }

  function abortTwoPlayerSession() {
    clearTwoPlayerUiTimers();
    const g = window.OneTo500Game;
    if (g && typeof g.resetTimerOverlayPauseState === "function") {
      g.resetTimerOverlayPauseState();
    }
    session = null;
    resultsSnapshot = null;
    tearDownHooksOnly();
    hideBanner();
    hidePassOverlay();
    hidePreResultsOverlay();
    closeModalEl($("#modal-twoplayer-results"));
    closeModalEl($("#modal-twoplayer-info"));
  }

  function startTwoPlayerMatch() {
    abortTwoPlayerSession();
    session = {
      seed: (Math.random() * 0x7fffffff) | 0,
      p1: null,
      p2: null,
    };
    installRollRngFromSeed(session.seed);
    window.OneTo500Hooks.handleRunEnd = handleRunEnd;
    window.OneTo500Hooks.skipRunStatsBump = true;
    window.OneTo500Hooks.abortTwoPlayerIfActive = abortTwoPlayerSession;
    window.OneTo500Hooks.onGoHomeFromGame = abortTwoPlayerSession;

    closeModalEl($("#modal-twoplayer-info"));
    closeModalEl($("#modal-settings"));

    const game = window.OneTo500Game;
    // goHome() calls onGoHomeFromGame which would abort the session we just created - skip once.
    const hooksRef = window.OneTo500Hooks;
    const restoreGoHome = hooksRef.onGoHomeFromGame;
    hooksRef.onGoHomeFromGame = null;
    try {
      if (game && game.goHome) game.goHome();
    } finally {
      hooksRef.onGoHomeFromGame = restoreGoHome;
    }

    showBanner(1);
    if (game && game.startGame) game.startGame();
  }

  function onP2Ready() {
    hidePassOverlay();
    if (!session || session.p1 == null) return;
    installRollRngFromSeed(session.seed);
    showBanner(2);
    const game = window.OneTo500Game;
    if (game && game.startGame) game.startGame();
  }

  function onShowResultsClick() {
    hidePreResultsOverlay();
    const game = window.OneTo500Game;
    if (game && typeof game.markTimerOverlayLayerReplace === "function") {
      game.markTimerOverlayLayerReplace();
    }
    if (game && typeof game.trackUmami === "function") {
      game.trackUmami("two-player-results-shown");
    }
    fillAndShowResults();
  }

  function onResultsDone() {
    closeModalEl($("#modal-twoplayer-results"));
    resultsSnapshot = null;
    hideBanner();
    hidePreResultsOverlay();
    const game = window.OneTo500Game;
    if (game && game.goHome) game.goHome();
  }

  function onResultsPlayAgain() {
    startTwoPlayerMatch();
  }

  function bind() {
    const btnOpen = $("#btn-open-twoplayer");
    if (btnOpen) {
      btnOpen.addEventListener("click", () => {
        openModalEl($("#modal-twoplayer-info"));
      });
    }

    const btnStart = $("#btn-twoplayer-start");
    if (btnStart) btnStart.addEventListener("click", startTwoPlayerMatch);

    const btnP2 = $("#btn-tp-p2-ready");
    if (btnP2) btnP2.addEventListener("click", onP2Ready);

    const btnDone = $("#btn-tp-results-done");
    if (btnDone) btnDone.addEventListener("click", onResultsDone);

    const btnPlayAgain = $("#btn-tp-results-play-again");
    if (btnPlayAgain) btnPlayAgain.addEventListener("click", onResultsPlayAgain);

    const btnShowRes = $("#btn-tp-show-results");
    if (btnShowRes) btnShowRes.addEventListener("click", onShowResultsClick);

    document.querySelectorAll('[data-close="modal-twoplayer-results"]').forEach((btn) => {
      btn.addEventListener("click", () => {
        window.setTimeout(onResultsDone, 0);
      });
    });

    const mInfo = document.getElementById("modal-twoplayer-info");
    if (mInfo) {
      mInfo.addEventListener("click", (e) => {
        if (e.target === mInfo) closeModalEl(mInfo);
      });
    }
    const mRes = document.getElementById("modal-twoplayer-results");
    if (mRes) {
      mRes.addEventListener("click", (e) => {
        if (e.target === mRes) onResultsDone();
      });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    bind();
  }
})();
