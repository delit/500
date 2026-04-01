(function () {
  "use strict";

  window.OneTo500Hooks = window.OneTo500Hooks || {};

  /** Umami custom events — https://umami.is/docs/track-events */
  function trackUmami(eventName, data) {
    try {
      const u = window.umami;
      if (!u || typeof u.track !== "function") return;
      if (data != null && typeof data === "object") u.track(eventName, data);
      else u.track(eventName);
    } catch (_) {}
  }

  const SLOT_COUNT = 10;
  const MIN_N = 1;
  const MAX_N = 500;
  const ROLL_MS = 800;
  /** Stop roll ticks this many ms before the strip transition ends (easing makes the tail feel done sooner). */
  const ROLL_SOUND_TRIM_MS = 400;
  /** Touch/coarse: start “Place number here” stagger this many ms before roll transform ends. */
  const HINT_REVEAL_LEAD_MS = 200;
  const ITEM_H_REM = 5.25;

  const LS_HIGH = "1to500_highScore";
  /** @deprecated merged into LS_BEST_TIME_BY_SCORE["10"] when read */
  const LS_BEST_WIN_TIME_MS = "1to500_bestWinTimeMs";
  /** JSON map score (1–10) → fastest run that ended with that many slots filled (ms) */
  const LS_BEST_TIME_BY_SCORE = "1to500_bestTimeMsByScore";
  const LS_THEME = "1to500_theme";
  const LS_SOUND = "1to500_sound";
  /** When `"on"`, solo game over starts a new run automatically after a short delay. */
  const LS_AUTO_PLAY_AGAIN = "1to500_autoPlayAgain";
  /** When `"on"`, choosing a slot locks the draw immediately (no separate Confirm tap). */
  const LS_IGNORE_CONFIRM = "1to500_ignoreConfirm";
  /** { runs, wins, losses, playTimeMs } — device-local, offline-safe. */
  const LS_STATS = "1to500_stats";
  /** Top runs in localStorage: JSON array { score, timeMs, at }[], max 10 (best score, then fastest time). */
  const LS_LEADERBOARD = "1to500_leaderboard_top10";
  /** Set to "1" after user dismisses the one-time “faster play” tip (10th finished run). */
  const LS_SPEED_TIP_SHOWN = "1to500_speedTipShown";

  /** @type {number[]} */
  let locked = Array(SLOT_COUNT).fill(null);
  let currentNumber = null;
  let previewIndex = null;
  let isRolling = false;
  /** When true, locked rows use the same neutral styling as empty rows (loss state). */
  let isGameOverBoard = false;
  /** One-shot: stagger “Place number here” on the render pass that mounts it. */
  let pendingMobileHintReveal = false;
  /** During roll on touch: show place hints (still disabled) before roll ends. */
  let earlyHintRevealPhase = false;
  /** Early hint stagger already ran; settle skips repeating hint animation. */
  let hintRevealAlreadyPlayed = false;
  /** Completed normal draws this run; intro stagger only while this is 0 (after startGame). */
  let completedDrawCount = 0;
  /** Values already chosen as the real draw this run — no duplicate draws within one run (solo & two-player). */
  let usedRollNumbersThisRun = new Set();
  /** Draw value for loss UI: invalid confirm or unwinnable-draw (cleared after gameOver reads it). */
  let lastLossHintDraw = null;
  /** After loss: where that draw belongs between locked rows (prev row bottom + next row top). */
  let lossInsertionHint = null;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let rollEarlyHintTimerId = null;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let rollSettleTimerId = null;
  let deferredInstall = null;
  /** @type {ReturnType<typeof setInterval> | null} */
  let gameTimerId = null;
  let gameStartMs = 0;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let rollLossPulseClearTimer = null;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let autoPlayAgainAfterLossTimerId = null;
  const AUTO_PLAY_AGAIN_DELAY_MS = 600;
  /** Full-screen / modal overlays over the game: pause the run timer while open (nested = depth). */
  let gameTimerOverlayPauseDepth = 0;
  let gameTimerElapsedMsWhenPaused = 0;
  /** Next overlay open replaces the previous layer without increasing pause depth (two-player pre-results → results). */
  let skipNextOverlayPauseDepthBump = false;
  /** False after run ends (freezeGameTimer); blocks overlay-resume from restarting the interval. */
  let gameTimerMayResume = true;

  const $ = (sel, el = document) => el.querySelector(sel);

  const screenStart = $("#screen-start");
  const screenGame = $("#screen-game");
  const gameLossFlash = $("#game-loss-flash");
  const slotsContainer = $("#slots-container");
  const rollStrip = $("#roll-strip");
  const rollContainer = $("#roll-container");
  const progressLabel = $("#progress-label");
  const startHighScore = $("#start-high-score");
  const startBestTime = $("#start-best-time");
  const overlayWin = $("#overlay-win");
  const overlayRestartConfirm = $("#overlay-restart-confirm");
  const overlayRestartPanel = $("#overlay-restart-panel");
  const overlayResetStatsConfirm = $("#overlay-reset-stats-confirm");
  const overlayResetStatsPanel = $("#overlay-reset-stats-panel");
  const overlaySpeedTip = $("#overlay-speed-tip");
  const overlaySpeedTipPanel = $("#overlay-speed-tip-panel");
  const goScore = $("#go-score");
  const goMessage = $("#go-message");
  const metaTheme = $("#meta-theme");
  const modalHelp = $("#modal-help");
  const modalSettings = $("#modal-settings");
  const btnInstall = $("#btn-install");
  const soundState = $("#sound-state");
  const soundSwitchTrack = $("#sound-switch-track");
  const soundSwitchKnob = $("#sound-switch-knob");
  const btnToggleSound = $("#btn-toggle-sound");
  const btnToggleAutoPlayAgain = $("#btn-toggle-auto-play-again");
  const autoPlayAgainState = $("#auto-play-again-state");
  const autoPlayAgainSwitchTrack = $("#auto-play-again-switch-track");
  const autoPlayAgainSwitchKnob = $("#auto-play-again-switch-knob");
  const btnToggleIgnoreConfirm = $("#btn-toggle-ignore-confirm");
  const ignoreConfirmState = $("#ignore-confirm-state");
  const ignoreConfirmSwitchTrack = $("#ignore-confirm-switch-track");
  const ignoreConfirmSwitchKnob = $("#ignore-confirm-switch-knob");
  const postGameoverBar = $("#post-gameover-bar");
  const postGameoverActions = $("#post-gameover-actions");
  const gameFooter = $("#game-footer");

  function gameTimerDom() {
    return document.getElementById("game-timer");
  }

  /** True when a modal or full-screen layer that should freeze the run clock is visible (DOM source of truth). */
  function isTimerBlockingUiOpen() {
    if (document.querySelector(".modal-backdrop.is-open")) return true;
    const ro = document.getElementById("overlay-restart-confirm");
    if (ro && !ro.classList.contains("hidden")) return true;
    const rs = document.getElementById("overlay-reset-stats-confirm");
    if (rs && !rs.classList.contains("hidden")) return true;
    const sp = document.getElementById("overlay-speed-tip");
    if (sp && !sp.classList.contains("hidden")) return true;
    const ow = document.getElementById("overlay-win");
    if (ow && !ow.classList.contains("hidden")) return true;
    const tpPass = document.getElementById("tp-pass-overlay");
    if (tpPass && !tpPass.classList.contains("hidden")) return true;
    const tpPre = document.getElementById("tp-pre-results-overlay");
    if (tpPre && !tpPre.classList.contains("hidden")) return true;
    return false;
  }

  function hidePostGameoverBar() {
    if (postGameoverBar) postGameoverBar.classList.add("hidden");
    if (postGameoverActions) postGameoverActions.classList.remove("hidden");
    if (gameFooter) gameFooter.classList.remove("game-footer--below-gameover");
  }

  function showPostGameoverBar() {
    if (postGameoverBar) postGameoverBar.classList.remove("hidden");
    if (gameFooter) gameFooter.classList.add("game-footer--below-gameover");
  }

  /** @param {boolean} showButtons - false when Auto "Play Again": same bar, no action buttons */
  function setPostGameoverActionsVisible(showButtons) {
    if (postGameoverActions) postGameoverActions.classList.toggle("hidden", !showButtons);
  }

  function formatGameElapsed(ms) {
    const sec = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  /** Statistics modal: h / m / s with abbreviations; omit hours when 0, omit minutes/seconds when 0 (except sub-minute uses seconds only). */
  function formatStatsDuration(ms) {
    const sec = Math.max(0, Math.floor(ms / 1000));
    if (sec === 0) return "0s";
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    const parts = [];
    if (h > 0) parts.push(`${h}h`);
    if (m > 0) parts.push(`${m}m`);
    if (s > 0) parts.push(`${s}s`);
    return parts.length ? parts.join(" ") : "0s";
  }

  function tickGameTimer() {
    const el = gameTimerDom();
    if (!el || !gameStartMs) return;

    if (isTimerBlockingUiOpen()) {
      if (
        gameTimerOverlayPauseDepth === 0 &&
        gameTimerMayResume &&
        !isGameOverBoard
      ) {
        pauseGameTimerForOverlay();
      }
      return;
    }

    if (gameTimerOverlayPauseDepth > 0) return;
    el.textContent = formatGameElapsed(Date.now() - gameStartMs);
  }

  function startGameTimer() {
    stopGameTimer();
    gameTimerMayResume = true;
    gameStartMs = Date.now();
    const el = gameTimerDom();
    if (el) {
      el.textContent = "0:00";
      gameTimerId = window.setInterval(tickGameTimer, 1000);
      tickGameTimer();
    }
  }

  function stopGameTimer() {
    if (gameTimerId != null) {
      window.clearInterval(gameTimerId);
      gameTimerId = null;
    }
  }

  function freezeGameTimer() {
    stopGameTimer();
    gameTimerMayResume = false;
    const el = gameTimerDom();
    if (gameStartMs && el) {
      el.textContent = formatGameElapsed(Date.now() - gameStartMs);
    }
  }

  function resetGameTimerDisplay() {
    stopGameTimer();
    gameTimerMayResume = false;
    gameStartMs = 0;
    const el = gameTimerDom();
    if (el) el.textContent = "0:00";
  }

  function isOnGameScreen() {
    const g = screenGame || document.getElementById("screen-game");
    return Boolean(g && !g.classList.contains("hidden"));
  }

  /** True while a run is in progress and the corner clock should advance (not game over / frozen end). */
  function shouldFreezeGameClockForOpenOverlay() {
    return Boolean(gameStartMs) && gameTimerMayResume && !isGameOverBoard;
  }

  function resetGameTimerOverlayPauseState() {
    gameTimerOverlayPauseDepth = 0;
    gameTimerElapsedMsWhenPaused = 0;
    skipNextOverlayPauseDepthBump = false;
  }

  /** Call when opening a blocking overlay during an active run (modals, restart confirm, two-player screens). */
  function pauseGameTimerForOverlay() {
    if (skipNextOverlayPauseDepthBump && gameTimerOverlayPauseDepth > 0) {
      skipNextOverlayPauseDepthBump = false;
      return;
    }
    if (gameTimerOverlayPauseDepth > 0) {
      gameTimerOverlayPauseDepth++;
      return;
    }
    if (!shouldFreezeGameClockForOpenOverlay()) return;
    gameTimerOverlayPauseDepth = 1;
    gameTimerElapsedMsWhenPaused = Date.now() - gameStartMs;
    gameStartMs = Date.now() - gameTimerElapsedMsWhenPaused;
    stopGameTimer();
    const el = gameTimerDom();
    if (el) {
      el.textContent = formatGameElapsed(gameTimerElapsedMsWhenPaused);
    }
  }

  /** Call when closing an overlay; resumes the timer when the last overlay closes. */
  function resumeGameTimerAfterOverlay() {
    if (gameTimerOverlayPauseDepth === 0) return;
    gameTimerOverlayPauseDepth--;
    if (gameTimerOverlayPauseDepth > 0) return;
    const savedMs = gameTimerElapsedMsWhenPaused;
    gameTimerElapsedMsWhenPaused = 0;
    if (!gameStartMs) return;
    if (!gameTimerMayResume) return;
    if (isGameOverBoard) return;
    gameStartMs = Date.now() - savedMs;
    if (gameTimerId != null) return;
    gameTimerId = window.setInterval(tickGameTimer, 1000);
    tickGameTimer();
  }

  /** Two-player: show results modal right after pre-results without extra pause depth. */
  function markTimerOverlayLayerReplace() {
    skipNextOverlayPauseDepthBump = true;
  }

  function getHighScore() {
    const v = parseInt(localStorage.getItem(LS_HIGH) || "0", 10);
    return Number.isFinite(v) ? Math.min(10, Math.max(0, v)) : 0;
  }

  function setHighScore(n) {
    localStorage.setItem(LS_HIGH, String(n));
    refreshHighScoreUI();
  }

  function loadBestTimeByScore() {
    /** @type {Record<string, number>} */
    let map = {};
    try {
      const raw = localStorage.getItem(LS_BEST_TIME_BY_SCORE);
      if (raw) {
        const p = JSON.parse(raw);
        if (p && typeof p === "object") map = { ...p };
      }
    } catch (_) {
      map = {};
    }
    const legacy = parseInt(localStorage.getItem(LS_BEST_WIN_TIME_MS) || "0", 10);
    if (Number.isFinite(legacy) && legacy > 0) {
      const k = "10";
      const cur = map[k];
      if (cur == null || legacy < cur) map[k] = legacy;
    }
    return map;
  }

  function saveBestTimeByScore(map) {
    try {
      localStorage.setItem(LS_BEST_TIME_BY_SCORE, JSON.stringify(map));
    } catch (_) {}
  }

  /** Record fastest time for runs that ended with exactly `score` slots filled (game over or win). */
  function recordBestTimeForScore(score, elapsedMs) {
    if (!Number.isFinite(score) || score < 1 || score > SLOT_COUNT) return;
    if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return;
    const map = loadBestTimeByScore();
    const k = String(score);
    const prev = map[k];
    const rounded = Math.round(elapsedMs);
    if (prev == null || rounded < prev) {
      map[k] = rounded;
      saveBestTimeByScore(map);
    }
  }

  /** Best elapsed time for the current high score (same depth); 0 if none yet. */
  function getBestTimeForHighScore() {
    const h = getHighScore();
    if (h < 1) return 0;
    const map = loadBestTimeByScore();
    const v = map[String(h)];
    return Number.isFinite(v) && v > 0 ? v : 0;
  }

  function refreshHighScoreUI() {
    const h = getHighScore();
    if (startHighScore) startHighScore.textContent = String(h);
    const bestMs = getBestTimeForHighScore();
    if (startBestTime) startBestTime.textContent = bestMs > 0 ? formatGameElapsed(bestMs) : "—";
  }

  function isSoundOn() {
    return localStorage.getItem(LS_SOUND) !== "off";
  }

  function isAutoPlayAgainOn() {
    return localStorage.getItem(LS_AUTO_PLAY_AGAIN) === "on";
  }

  function isIgnoreConfirmOn() {
    return localStorage.getItem(LS_IGNORE_CONFIRM) === "on";
  }

  function clearAutoPlayAgainAfterLossTimer() {
    if (autoPlayAgainAfterLossTimerId != null) {
      clearTimeout(autoPlayAgainAfterLossTimerId);
      autoPlayAgainAfterLossTimerId = null;
    }
  }

  function setSoundLabel() {
    const on = isSoundOn();
    if (soundState) soundState.textContent = on ? "On" : "Off";
    if (btnToggleSound) btnToggleSound.setAttribute("aria-checked", on ? "true" : "false");
    if (soundSwitchTrack && soundSwitchKnob) {
      const st = soundSwitchTrack;
      st.classList.remove(
        "bg-slate-400",
        "dark:bg-primary/28",
        "bg-gradient-to-r",
        "from-[#a6c9f8]",
        "to-[#6285b0]",
        "shadow-inner",
        "shadow-md",
        "shadow-sky-400/20"
      );
      if (on) {
        st.classList.add("bg-gradient-to-r", "from-[#a6c9f8]", "to-[#6285b0]", "shadow-md", "shadow-sky-400/20");
      } else {
        st.classList.add("bg-slate-400", "dark:bg-primary/28", "shadow-inner");
      }
      soundSwitchKnob.style.transform = on ? "translateX(1.25rem)" : "translateX(0)";
    }
  }

  function setAutoPlayAgainLabel() {
    const on = isAutoPlayAgainOn();
    if (autoPlayAgainState) autoPlayAgainState.textContent = on ? "On" : "Off";
    if (btnToggleAutoPlayAgain) btnToggleAutoPlayAgain.setAttribute("aria-checked", on ? "true" : "false");
    if (autoPlayAgainSwitchTrack && autoPlayAgainSwitchKnob) {
      const st = autoPlayAgainSwitchTrack;
      st.classList.remove(
        "bg-slate-400",
        "dark:bg-primary/28",
        "bg-gradient-to-r",
        "from-[#a6c9f8]",
        "to-[#6285b0]",
        "shadow-inner",
        "shadow-md",
        "shadow-sky-400/20"
      );
      if (on) {
        st.classList.add("bg-gradient-to-r", "from-[#a6c9f8]", "to-[#6285b0]", "shadow-md", "shadow-sky-400/20");
      } else {
        st.classList.add("bg-slate-400", "dark:bg-primary/28", "shadow-inner");
      }
      autoPlayAgainSwitchKnob.style.transform = on ? "translateX(1.25rem)" : "translateX(0)";
    }
    const stState = $("#speed-tip-auto-state");
    const stBtn = $("#btn-speed-tip-toggle-auto");
    const stTrack = $("#speed-tip-auto-switch-track");
    const stKnob = $("#speed-tip-auto-switch-knob");
    if (stTrack && stKnob) {
      stTrack.classList.remove(
        "bg-slate-400",
        "dark:bg-primary/28",
        "bg-gradient-to-r",
        "from-[#a6c9f8]",
        "to-[#6285b0]",
        "shadow-inner",
        "shadow-md",
        "shadow-sky-400/20"
      );
      if (on) {
        stTrack.classList.add("bg-gradient-to-r", "from-[#a6c9f8]", "to-[#6285b0]", "shadow-md", "shadow-sky-400/20");
      } else {
        stTrack.classList.add("bg-slate-400", "dark:bg-primary/28", "shadow-inner");
      }
      stKnob.style.transform = on ? "translateX(1.25rem)" : "translateX(0)";
    }
    if (stState) stState.textContent = on ? "On" : "Off";
    if (stBtn) stBtn.setAttribute("aria-checked", on ? "true" : "false");
  }

  function setIgnoreConfirmLabel() {
    const on = isIgnoreConfirmOn();
    if (ignoreConfirmState) ignoreConfirmState.textContent = on ? "On" : "Off";
    if (btnToggleIgnoreConfirm) btnToggleIgnoreConfirm.setAttribute("aria-checked", on ? "true" : "false");
    if (ignoreConfirmSwitchTrack && ignoreConfirmSwitchKnob) {
      const st = ignoreConfirmSwitchTrack;
      st.classList.remove(
        "bg-slate-400",
        "dark:bg-primary/28",
        "bg-gradient-to-r",
        "from-[#a6c9f8]",
        "to-[#6285b0]",
        "shadow-inner",
        "shadow-md",
        "shadow-sky-400/20"
      );
      if (on) {
        st.classList.add("bg-gradient-to-r", "from-[#a6c9f8]", "to-[#6285b0]", "shadow-md", "shadow-sky-400/20");
      } else {
        st.classList.add("bg-slate-400", "dark:bg-primary/28", "shadow-inner");
      }
      ignoreConfirmSwitchKnob.style.transform = on ? "translateX(1.25rem)" : "translateX(0)";
    }
    const stState = $("#speed-tip-ignore-state");
    const stBtn = $("#btn-speed-tip-toggle-ignore");
    const stTrack = $("#speed-tip-ignore-switch-track");
    const stKnob = $("#speed-tip-ignore-switch-knob");
    if (stTrack && stKnob) {
      stTrack.classList.remove(
        "bg-slate-400",
        "dark:bg-primary/28",
        "bg-gradient-to-r",
        "from-[#a6c9f8]",
        "to-[#6285b0]",
        "shadow-inner",
        "shadow-md",
        "shadow-sky-400/20"
      );
      if (on) {
        stTrack.classList.add("bg-gradient-to-r", "from-[#a6c9f8]", "to-[#6285b0]", "shadow-md", "shadow-sky-400/20");
      } else {
        stTrack.classList.add("bg-slate-400", "dark:bg-primary/28", "shadow-inner");
      }
      stKnob.style.transform = on ? "translateX(1.25rem)" : "translateX(0)";
    }
    if (stState) stState.textContent = on ? "On" : "Off";
    if (stBtn) stBtn.setAttribute("aria-checked", on ? "true" : "false");
  }

  function defaultStats() {
    return { runs: 0, wins: 0, losses: 0, playTimeMs: 0 };
  }

  function loadStats() {
    try {
      const raw = localStorage.getItem(LS_STATS);
      if (!raw) return defaultStats();
      const p = JSON.parse(raw);
      if (!p || typeof p !== "object") return defaultStats();
      return { ...defaultStats(), ...p };
    } catch (_) {
      return defaultStats();
    }
  }

  function saveStats(s) {
    try {
      localStorage.setItem(LS_STATS, JSON.stringify(s));
    } catch (_) {}
  }

  /** Finished runs (wins + losses) from stats. */
  function statsFinishedCount() {
    const s = loadStats();
    return (s.wins || 0) + (s.losses || 0);
  }

  /** One-time tip after exactly 10 finished games; skipped if both speed settings already on. */
  function shouldOfferSpeedTip() {
    if (localStorage.getItem(LS_SPEED_TIP_SHOWN) === "1") return false;
    if (isAutoPlayAgainOn() && isIgnoreConfirmOn()) return false;
    return statsFinishedCount() === 10;
  }

  function openSpeedTipOverlay() {
    if (!overlaySpeedTip || !overlaySpeedTipPanel) return;
    if (!overlaySpeedTip.classList.contains("hidden")) return;
    setAutoPlayAgainLabel();
    setIgnoreConfirmLabel();
    showOverlay(overlaySpeedTip, overlaySpeedTipPanel);
  }

  function dismissSpeedTipOverlay() {
    if (!overlaySpeedTip || !overlaySpeedTipPanel) return;
    try {
      localStorage.setItem(LS_SPEED_TIP_SHOWN, "1");
    } catch (_) {}
    hideOverlay(overlaySpeedTip, overlaySpeedTipPanel);
  }

  function bumpStatsRunStarted() {
    const s = loadStats();
    s.runs = (s.runs || 0) + 1;
    saveStats(s);
  }

  function recordStatsRunEnd(won, elapsedMs, finalScore) {
    const s = loadStats();
    if (won) s.wins = (s.wins || 0) + 1;
    else s.losses = (s.losses || 0) + 1;
    s.playTimeMs = (s.playTimeMs || 0) + Math.max(0, Math.round(elapsedMs || 0));
    const sc = Math.max(0, Math.min(SLOT_COUNT, Math.round(Number(finalScore))));
    s.scoreRunsRecorded = (s.scoreRunsRecorded || 0) + 1;
    s.scoreSumFinished = (s.scoreSumFinished || 0) + sc;
    if (sc === 9) s.countScore9 = (s.countScore9 || 0) + 1;
    if (sc === 1) s.countScore1 = (s.countScore1 || 0) + 1;
    saveStats(s);
  }

  function refreshStatsDisplay() {
    const s = loadStats();
    const runs = s.runs || 0;
    const wins = s.wins || 0;
    const losses = s.losses || 0;
    const finished = wins + losses;
    const playTimeMs = s.playTimeMs || 0;
    const elRuns = $("#stat-runs");
    const elWins = $("#stat-wins");
    const elWr = $("#stat-winrate");
    const elAvgScore = $("#stat-avgscore");
    const elCount9 = $("#stat-count9");
    const elCount1 = $("#stat-count1");
    const elAvg = $("#stat-avgtime");
    const elPt = $("#stat-playtime");
    if (elRuns) elRuns.textContent = String(runs);
    if (elWins) elWins.textContent = String(wins);
    if (elWr) {
      elWr.textContent = runs > 0 ? `${((wins / runs) * 100).toFixed(3)}%` : "—";
    }
    const nScored = s.scoreRunsRecorded || 0;
    const sumScores = s.scoreSumFinished;
    if (elAvgScore) {
      if (typeof sumScores === "number" && nScored > 0) {
        elAvgScore.textContent = `${(sumScores / nScored).toFixed(1)}/10`;
      } else {
        elAvgScore.textContent = "—";
      }
    }
    if (elCount9) elCount9.textContent = String(s.countScore9 || 0);
    if (elCount1) elCount1.textContent = String(s.countScore1 || 0);
    if (elAvg) {
      elAvg.textContent =
        finished > 0 ? formatStatsDuration(Math.round(playTimeMs / finished)) : "—";
    }
    if (elPt) elPt.textContent = formatStatsDuration(playTimeMs);
  }

  /** @returns {Array<{ score: number; timeMs: number; at: number }>} */
  function loadLeaderboard() {
    try {
      const raw = localStorage.getItem(LS_LEADERBOARD);
      if (!raw) return [];
      const a = JSON.parse(raw);
      if (!Array.isArray(a)) return [];
      return a
        .filter(
          (e) =>
            e &&
            typeof e === "object" &&
            typeof e.score === "number" &&
            typeof e.timeMs === "number" &&
            typeof e.at === "number"
        )
        .map((e) => ({
          score: Math.max(0, Math.min(SLOT_COUNT, Math.round(e.score))),
          timeMs: Math.max(0, Math.round(e.timeMs)),
          at: e.at,
        }));
    } catch (_) {
      return [];
    }
  }

  /** @param {Array<{ score: number; timeMs: number; at: number }>} entries */
  function saveLeaderboard(entries) {
    try {
      localStorage.setItem(LS_LEADERBOARD, JSON.stringify(entries.slice(0, 10)));
    } catch (_) {}
  }

  function recordLeaderboardRun(score, elapsedMs) {
    const sc = Math.max(0, Math.min(SLOT_COUNT, Math.round(score)));
    const t = Math.max(0, Math.round(elapsedMs || 0));
    const list = loadLeaderboard();
    list.push({ score: sc, timeMs: t, at: Date.now() });
    list.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.timeMs !== b.timeMs) return a.timeMs - b.timeMs;
      return b.at - a.at;
    });
    saveLeaderboard(list.slice(0, 10));
  }

  function formatLeaderboardDate(ts) {
    try {
      return new Date(ts).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    } catch (_) {
      return "—";
    }
  }

  function refreshLeaderboardTable() {
    const body = $("#leaderboard-body");
    const empty = $("#leaderboard-empty");
    const wrap = $("#leaderboard-table-wrap");
    if (!body) return;
    const rows = loadLeaderboard();
    body.innerHTML = "";
    if (rows.length === 0) {
      if (wrap) wrap.classList.add("hidden");
      if (empty) empty.classList.remove("hidden");
      return;
    }
    if (wrap) wrap.classList.remove("hidden");
    if (empty) empty.classList.add("hidden");
    for (let i = 0; i < rows.length; i++) {
      const e = rows[i];
      const tr = document.createElement("tr");
      tr.className =
        "border-b border-slate-200/90 dark:border-white/[0.08] last:border-0 text-slate-900 dark:text-on-surface";
      const rank = i + 1;
      tr.innerHTML = `
        <td class="py-3 pl-4 pr-2 font-headline font-bold tabular-nums text-slate-500 dark:text-on-surface/45 w-10">${rank}</td>
        <td class="py-3 px-2 tabular-nums text-slate-600 dark:text-on-surface-muted text-[13px]">${e.score} of 10</td>
        <td class="py-3 px-2 text-right tabular-nums text-slate-600 dark:text-on-surface-muted text-[13px]">${formatGameElapsed(e.timeMs)}</td>
        <td class="py-3 pl-2 pr-4 text-right text-slate-600 dark:text-on-surface-muted text-[13px] whitespace-nowrap">${formatLeaderboardDate(e.at)}</td>`;
      body.appendChild(tr);
    }
  }

  function refreshSettingsPanel() {
    setSoundLabel();
    setAutoPlayAgainLabel();
    setIgnoreConfirmLabel();
  }

  let audioCtx = null;
  let rollSoundGen = 0;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let rollSoundCleanupTimerId = null;
  /** @type {Array<{ o: OscillatorNode; g: GainNode }>} */
  let rollSoundScheduled = [];

  function beep(freq = 440, dur = 0.06) {
    if (!isSoundOn()) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      void audioCtx.resume();
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.connect(g);
      g.connect(audioCtx.destination);
      o.frequency.value = freq;
      o.type = "sine";
      g.gain.setValueAtTime(0.08, audioCtx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
      o.start(audioCtx.currentTime);
      o.stop(audioCtx.currentTime + dur);
    } catch (_) {}
  }

  /** Soft tick when choosing a row to preview the current draw. */
  function beepRowSelect() {
    if (!isSoundOn()) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === "suspended") audioCtx.resume();
      const t = audioCtx.currentTime;
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.connect(g);
      g.connect(audioCtx.destination);
      o.type = "sine";
      o.frequency.setValueAtTime(587, t);
      g.gain.setValueAtTime(0.048, t);
      g.gain.exponentialRampToValueAtTime(0.0008, t + 0.04);
      o.start(t);
      o.stop(t + 0.045);
    } catch (_) {}
  }

  /** Short major fanfare; respects Sound setting. */
  function playWinFanfare() {
    if (!isSoundOn()) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === "suspended") void audioCtx.resume();
      const t = audioCtx.currentTime;
      const notes = [
        { f: 392, d: 0.1, g: 0.07 },
        { f: 523.25, d: 0.11, g: 0.085 },
        { f: 659.25, d: 0.11, g: 0.09 },
        { f: 783.99, d: 0.14, g: 0.095 },
        { f: 1046.5, d: 0.38, g: 0.1 },
      ];
      let at = 0;
      for (const { f, d, g } of notes) {
        const o = audioCtx.createOscillator();
        const gn = audioCtx.createGain();
        o.connect(gn);
        gn.connect(audioCtx.destination);
        o.type = "triangle";
        o.frequency.value = f;
        const s = t + at;
        gn.gain.setValueAtTime(0.0001, s);
        gn.gain.exponentialRampToValueAtTime(g, s + 0.028);
        gn.gain.exponentialRampToValueAtTime(0.0001, s + d);
        o.start(s);
        o.stop(s + d + 0.04);
        at += d * 0.72;
      }
    } catch (_) {}
  }

  /** Descending “lose” sting; respects Sound. */
  function playGameOverSound() {
    if (!isSoundOn()) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      void audioCtx.resume();
      const t = audioCtx.currentTime + 0.02;
      const notes = [
        { f0: 245, f1: 180, d: 0.16 },
        { f0: 175, f1: 120, d: 0.18 },
        { f0: 110, f1: 70, d: 0.28 },
      ];
      let at = 0;
      for (const { f0, f1, d } of notes) {
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        o.connect(g);
        g.connect(audioCtx.destination);
        o.type = "triangle";
        const s = t + at;
        o.frequency.setValueAtTime(f0, s);
        o.frequency.exponentialRampToValueAtTime(Math.max(45, f1), s + d);
        g.gain.setValueAtTime(0.0001, s);
        g.gain.exponentialRampToValueAtTime(0.078, s + 0.035);
        g.gain.exponentialRampToValueAtTime(0.0001, s + d);
        o.start(s);
        o.stop(s + d + 0.03);
        at += d * 0.58;
      }
    } catch (_) {}
  }

  /**
   * Chrome Android often leaves AudioContext “suspended” until resume() resolves.
   * Roll ticks are scheduled ahead in time; awaiting resume before scheduling fixes missing roll SFX on GitHub Pages / mobile.
   */
  function prepareRollAudioThen(cb) {
    if (!isSoundOn()) {
      cb();
      return;
    }
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const p = audioCtx.resume();
      if (p && typeof p.then === "function") {
        p.then(() => cb()).catch(() => cb());
      } else {
        cb();
      }
    } catch (_) {
      cb();
    }
  }

  function stopRollSound() {
    if (rollSoundCleanupTimerId != null) {
      window.clearTimeout(rollSoundCleanupTimerId);
      rollSoundCleanupTimerId = null;
    }
    for (const { o, g } of rollSoundScheduled) {
      try {
        g.disconnect();
        o.disconnect();
      } catch (_) {}
    }
    rollSoundScheduled = [];
  }

  /**
   * Mobile Chrome only allows starting audio during a user gesture. Roll ticks run on
   * setInterval (not a gesture), so we start a nearly silent node synchronously here —
   * still inside the click/tap that triggered scheduleRoll — then resume the context.
   */
  function unlockAudioForRoll() {
    if (!isSoundOn()) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const t = audioCtx.currentTime;
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.connect(g);
      g.connect(audioCtx.destination);
      g.gain.setValueAtTime(0.00001, t);
      o.start(t);
      o.stop(t + 0.001);
    } catch (_) {}
    try {
      if (audioCtx) void audioCtx.resume();
    } catch (_) {}
  }

  /**
   * Roll ticks as Web Audio events scheduled ahead in time, all from this synchronous
   * call. Chrome Android treats setInterval callbacks as non-gestures and will not run
   * oscillator.start() there; scheduling start(tFuture) here (still inside the tap that
   * called scheduleRoll) keeps mobile and Live Server working.
   */
  function startRollSound(durationMs, tickCount) {
    stopRollSound();
    const myGen = ++rollSoundGen;
    if (!isSoundOn()) return;

    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      void audioCtx.resume();
      const t0 = audioCtx.currentTime + 0.08;
      const n = Math.max(10, Math.floor((tickCount || 8) * 0.45));
      const tickMs = Math.max(52, Math.floor(durationMs / n));
      const tickSec = tickMs / 1000;
      const numTicks = Math.min(120, Math.ceil(durationMs / tickMs) + 1);
      const dur = 0.012;
      const tickGain = 0.034;

      for (let k = 0; k < numTicks; k++) {
        const t = t0 + k * tickSec;
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        o.connect(g);
        g.connect(audioCtx.destination);
        o.type = "sine";
        o.frequency.setValueAtTime(360 + Math.random() * 100, t);
        g.gain.setValueAtTime(tickGain, t);
        g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
        o.start(t);
        o.stop(t + dur + 0.006);
        rollSoundScheduled.push({ o, g });
      }

      rollSoundCleanupTimerId = window.setTimeout(() => {
        rollSoundCleanupTimerId = null;
        if (myGen !== rollSoundGen) return;
        rollSoundScheduled = [];
      }, durationMs + 200);
    } catch (_) {}
  }

  function applyTheme(dark) {
    const html = document.documentElement;
    if (dark) {
      html.classList.add("dark");
      if (metaTheme) metaTheme.setAttribute("content", "#0f172a");
    } else {
      html.classList.remove("dark");
      if (metaTheme) metaTheme.setAttribute("content", "#f1f5f9");
    }
    localStorage.setItem(LS_THEME, dark ? "dark" : "light");
  }

  function loadTheme() {
    const t = localStorage.getItem(LS_THEME);
    if (t === "light") applyTheme(false);
    else applyTheme(true);
  }

  function toggleTheme() {
    applyTheme(!document.documentElement.classList.contains("dark"));
  }

  function filledCount() {
    return locked.filter((x) => x != null).length;
  }

  /** Where `n` belongs in ascending top→bottom order among locked values (for loss hint UI). */
  function computeLossInsertionHint(board, n) {
    let prevIdx = null;
    for (let i = 0; i < SLOT_COUNT; i++) {
      if (board[i] != null && board[i] < n) prevIdx = i;
    }
    let nextIdx = null;
    for (let i = 0; i < SLOT_COUNT; i++) {
      if (board[i] != null && board[i] > n) {
        nextIdx = i;
        break;
      }
    }
    if (prevIdx == null && nextIdx == null) return null;
    return { draw: n, prevIdx, nextIdx };
  }

  function validatePlacement(index, value, board = locked) {
    let maxAbove = -Infinity;
    for (let i = 0; i < index; i++) {
      if (board[i] != null) maxAbove = Math.max(maxAbove, board[i]);
    }
    let minBelow = Infinity;
    for (let i = index + 1; i < SLOT_COUNT; i++) {
      if (board[i] != null) minBelow = Math.min(minBelow, board[i]);
    }
    if (value <= maxAbove) return false;
    if (value >= minBelow) return false;
    return true;
  }

  /** Greedy check: can all empty cells still get strictly increasing integers in [MIN_N, MAX_N] given fixed locks? */
  function greedyRemainingFeasible(board) {
    let last = 0;
    for (let idx = 0; idx < SLOT_COUNT; idx++) {
      if (board[idx] != null) continue;
      let maxAbove = -Infinity;
      for (let i = 0; i < idx; i++) {
        if (board[i] != null) maxAbove = Math.max(maxAbove, board[i]);
      }
      let minBelow = Infinity;
      for (let i = idx + 1; i < SLOT_COUNT; i++) {
        if (board[i] != null) minBelow = Math.min(minBelow, board[i]);
      }
      const lowFromLocks = maxAbove === -Infinity ? MIN_N : maxAbove + 1;
      const highFromLocks = minBelow === Infinity ? MAX_N : minBelow - 1;
      const vMin = Math.max(lowFromLocks, last + 1);
      const vMax = highFromLocks;
      if (vMin > vMax) return false;
      last = vMin;
    }
    return true;
  }

  /** True if some empty slot can take `n` and the rest of the ladder can still be completed. */
  function canPlaceCurrentSomewhere(board, n) {
    for (let j = 0; j < SLOT_COUNT; j++) {
      if (board[j] != null) continue;
      if (!validatePlacement(j, n, board)) continue;
      const next = board.slice();
      next[j] = n;
      if (greedyRemainingFeasible(next)) return true;
    }
    return false;
  }

  /** SVG ring: multi-stop gradient stroke; dash 28+72=100 matches pathLength for gapless loop. */
  function createLastChanceBorderSvg() {
    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("class", "slot-last-chance-border-svg");
    svg.setAttribute("viewBox", "0 0 400 80");
    svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("aria-hidden", "true");

    const defs = document.createElementNS(svgNS, "defs");

    function addLinearGradient(id, stops) {
      const lg = document.createElementNS(svgNS, "linearGradient");
      lg.setAttribute("id", id);
      lg.setAttribute("gradientUnits", "userSpaceOnUse");
      lg.setAttribute("x1", "0");
      lg.setAttribute("y1", "0");
      lg.setAttribute("x2", "400");
      lg.setAttribute("y2", "80");
      for (const s of stops) {
        const stop = document.createElementNS(svgNS, "stop");
        stop.setAttribute("offset", s.off);
        stop.setAttribute("stop-color", s.c);
        if (s.o != null) stop.setAttribute("stop-opacity", String(s.o));
        lg.appendChild(stop);
      }
      defs.appendChild(lg);
    }

    addLinearGradient("slotLastBorderGrad", [
      { off: "0%", c: "#1e3a8a", o: 0.22 },
      { off: "14%", c: "#2563eb", o: 1 },
      { off: "30%", c: "#3b82f6", o: 1 },
      { off: "46%", c: "#93c5fd", o: 1 },
      { off: "54%", c: "#e0f2fe", o: 0.98 },
      { off: "66%", c: "#7dd3fc", o: 1 },
      { off: "82%", c: "#60a5fa", o: 1 },
      { off: "94%", c: "#3b82f6", o: 0.88 },
      { off: "100%", c: "#1e40af", o: 0.62 },
    ]);
    addLinearGradient("slotLastBorderGradDark", [
      { off: "0%", c: "#172554", o: 0.4 },
      { off: "16%", c: "#2563eb", o: 1 },
      { off: "34%", c: "#60a5fa", o: 1 },
      { off: "48%", c: "#bae6fd", o: 0.95 },
      { off: "58%", c: "#f0f9ff", o: 0.88 },
      { off: "72%", c: "#38bdf8", o: 1 },
      { off: "88%", c: "#93c5fd", o: 1 },
      { off: "95%", c: "#60a5fa", o: 0.9 },
      { off: "100%", c: "#1e3a8a", o: 0.68 },
    ]);

    svg.appendChild(defs);

    const rect = document.createElementNS(svgNS, "rect");
    rect.setAttribute("x", "2.25");
    rect.setAttribute("y", "2.25");
    rect.setAttribute("width", "395.5");
    rect.setAttribute("height", "75.5");
    rect.setAttribute("rx", "10");
    rect.setAttribute("ry", "10");
    rect.setAttribute("fill", "none");
    rect.setAttribute("pathLength", "100");
    const dark = document.documentElement.classList.contains("dark");
    rect.setAttribute("stroke", dark ? "url(#slotLastBorderGradDark)" : "url(#slotLastBorderGrad)");
    rect.setAttribute("stroke-width", "2.35");
    rect.setAttribute("vector-effect", "non-scaling-stroke");
    rect.setAttribute("stroke-linecap", "butt");
    rect.setAttribute("stroke-linejoin", "round");
    /* 28 + 72 = 100: one full normalized perimeter per 0→-100 offset → seamless infinite loop */
    rect.setAttribute("stroke-dasharray", "28 72");
    rect.setAttribute("stroke-dashoffset", "0");
    rect.setAttribute("class", "slot-last-chance-border-rect");
    svg.appendChild(rect);
    return svg;
  }

  function renderSlots() {
    slotsContainer.innerHTML = "";
    const coarsePointer = isCoarsePointer();
    let emptyHintStagger = 0;
    const onlyEmptyIdx =
      !isGameOverBoard && filledCount() === SLOT_COUNT - 1
        ? locked.findIndex((x) => x == null)
        : -1;
    /** After roll settles: 9 locked + current draw is placeable (same gate as scheduleRoll / no unwinnable-draw). */
    const lastSlotBorderActive =
      onlyEmptyIdx >= 0 &&
      currentNumber != null &&
      !isRolling &&
      canPlaceCurrentSomewhere(locked, currentNumber);
    for (let i = 0; i < SLOT_COUNT; i++) {
      const row = document.createElement("div");
      const lastChanceGlow = lastSlotBorderActive && onlyEmptyIdx === i;
      let lossHintClass = "";
      if (isGameOverBoard && lossInsertionHint) {
        const hintBottomRow =
          lossInsertionHint.prevIdx ??
          (lossInsertionHint.nextIdx != null && lossInsertionHint.nextIdx > 0
            ? lossInsertionHint.nextIdx - 1
            : null);
        if (hintBottomRow === i) lossHintClass += " slot-loss-hint-row slot-loss-hint--bottom";
      }
      row.className =
        `min-h-0 flex items-stretch${isGameOverBoard ? " slot-row-go-pulse" : ""}` +
        (lastChanceGlow ? " slot-row-last-chance" : "") +
        lossHintClass;
      if (isGameOverBoard) row.style.setProperty("--slot-go-delay", `${i * 0.068}s`);
      const v = locked[i];
      const isPreview = previewIndex === i && currentNumber != null;

      if (v != null) {
        if (isGameOverBoard) {
          row.innerHTML = `
          <div class="flex w-full items-center justify-between px-3 py-0.5 rounded-lg border bg-white border-slate-300 shadow-sm dark:bg-surface-lowest/40 dark:border-white/10 dark:shadow-none transition-colors opacity-[0.92]">
            <div class="flex items-center gap-3 sm:gap-4 min-w-0">
              <span class="font-headline font-bold text-sm text-slate-400 dark:text-on-surface/28 shrink-0 tabular-nums">${String(i + 1).padStart(2, "0")}</span>
              <div class="h-8 w-px bg-slate-300 dark:bg-[#44474c]/25 shrink-0"></div>
              <span class="font-headline font-bold text-2xl sm:text-3xl text-slate-500 dark:text-on-surface/40 tracking-tight tabular-nums truncate">${v}</span>
            </div>
            <span class="text-slate-400/70 dark:text-on-surface/25 shrink-0" aria-hidden="true">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"/></svg>
            </span>
          </div>`;
        } else {
          row.innerHTML = `
          <div class="flex w-full items-center justify-between px-3 py-0.5 rounded-lg bg-sky-100 dark:bg-surface-low border border-sky-300/90 dark:border-transparent shadow-sm dark:shadow-none transition-colors">
            <div class="flex items-center gap-3 sm:gap-4 min-w-0">
              <span class="font-headline font-bold text-sm text-sky-800/35 dark:text-on-surface/30 shrink-0 tabular-nums">${String(i + 1).padStart(2, "0")}</span>
              <div class="h-8 w-px bg-sky-300/80 dark:bg-[#44474c]/30 shrink-0"></div>
              <span class="font-headline font-bold text-2xl sm:text-3xl text-sky-600 dark:text-tertiary tracking-tight tabular-nums truncate">${v}</span>
            </div>
            <span class="text-sky-600/70 dark:text-[#44474c] shrink-0" aria-hidden="true">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"/></svg>
            </span>
          </div>`;
        }
      } else if (isPreview) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.dataset.slotIndex = String(i);
        btn.disabled = isRolling;
        btn.className =
          "flex w-full items-center justify-between px-3 py-1 rounded-lg border text-left transition-all bg-sky-100 border-sky-400/50 ring-2 ring-sky-400/35 shadow-md dark:bg-slate-950/95 dark:border-primary/35 dark:ring-primary/40 " +
          "disabled:pointer-events-none disabled:opacity-90";
        btn.innerHTML = isIgnoreConfirmOn()
          ? `
          <div class="flex items-center gap-3 sm:gap-4 min-w-0 flex-1">
            <span class="font-headline font-bold text-sm text-sky-800/40 dark:text-white/35 shrink-0 tabular-nums">${String(i + 1).padStart(2, "0")}</span>
            <div class="h-8 w-px bg-sky-300/80 dark:bg-white/25 shrink-0"></div>
            <span class="font-headline font-extrabold text-2xl sm:text-3xl text-sky-900 dark:text-white tracking-tight tabular-nums">${currentNumber}</span>
          </div>`
          : `
          <div class="flex items-center gap-3 sm:gap-4 min-w-0">
            <span class="font-headline font-bold text-sm text-sky-800/40 dark:text-white/35 shrink-0 tabular-nums">${String(i + 1).padStart(2, "0")}</span>
            <div class="h-8 w-px bg-sky-300/80 dark:bg-white/25 shrink-0"></div>
            <span class="font-headline font-extrabold text-2xl sm:text-3xl text-sky-900 dark:text-white tracking-tight tabular-nums">${currentNumber}</span>
          </div>
          <div class="flex items-center gap-2 bg-primary text-[#033258] px-4 py-2.5 rounded-lg text-sm font-bold uppercase tracking-wide animate-pulse shrink-0 shadow-md">
            <span>Confirm</span>
            <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>
          </div>`;
        if (lastChanceGlow) {
          row.appendChild(createLastChanceBorderSvg());
          btn.classList.add("relative", "z-[1]");
        }
        row.appendChild(btn);
      } else {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.dataset.slotIndex = String(i);
        const canInteract = !isRolling && currentNumber != null;
        const showPlaceHint =
          !isGameOverBoard && (canInteract || isRolling);
        btn.disabled = !canInteract;
        btn.className =
          "group flex w-full items-center px-3 py-0.5 rounded-lg text-left transition-colors border bg-white border-slate-300 shadow-sm dark:bg-surface-lowest/40 dark:border-white/10 dark:shadow-none " +
          (isRolling && !canInteract ? "slot-row-rolling-wait " : "") +
          (canInteract
            ? "hover:bg-slate-50 dark:hover:bg-surface-low/60 active:scale-[0.995] "
            : "") +
          "disabled:pointer-events-none disabled:cursor-default disabled:hover:bg-white dark:disabled:hover:bg-surface-lowest/40 disabled:active:scale-100 disabled:opacity-[0.92]";
        if (canInteract) {
          btn.title = "Place your number here";
        }
        /** Touch: first draw — hide hint until early stagger runs (avoids 0.4 opacity before animation). */
        const introHintHidden =
          coarsePointer &&
          completedDrawCount === 0 &&
          !hintRevealAlreadyPlayed &&
          !earlyHintRevealPhase &&
          showPlaceHint;
        const useHintRevealAnim =
          showPlaceHint &&
          coarsePointer &&
          pendingMobileHintReveal &&
          completedDrawCount === 0;
        const hintStagger = useHintRevealAnim ? emptyHintStagger++ : 0;
        const hintRevealClass = useHintRevealAnim ? " slot-hint-reveal-anim" : "";
        const hintRevealStyle = useHintRevealAnim ? ` style="--hint-stagger:${hintStagger}"` : "";
        const hintHtml =
          showPlaceHint && !introHintHidden
            ? `<span class="slot-empty-hint${hintRevealClass} flex-1 min-w-0 min-h-[1.75rem] flex items-center justify-end sm:justify-start pl-1 text-[9px] sm:text-[10px] uppercase tracking-wider text-slate-600 dark:text-on-surface/55 pointer-events-none text-right sm:text-left leading-tight"${hintRevealStyle}>Place number here</span>`
            : `<span class="flex-1 min-w-0 min-h-[1.75rem]" aria-hidden="true"></span>`;
        btn.innerHTML = `
          <div class="flex items-center gap-3 sm:gap-4 w-full min-w-0 ${canInteract ? "opacity-70" : "opacity-[0.68]"}">
            <span class="font-headline font-bold text-sm text-slate-400 dark:text-on-surface/28 tabular-nums shrink-0">${String(i + 1).padStart(2, "0")}</span>
            <div class="h-8 w-px bg-slate-300 dark:bg-[#44474c]/25 shrink-0"></div>
            ${hintHtml}
          </div>`;
        if (lastChanceGlow) {
          row.appendChild(createLastChanceBorderSvg());
          btn.classList.add("relative", "z-[1]");
        }
        row.appendChild(btn);
      }
      slotsContainer.appendChild(row);
    }
    progressLabel.textContent = String(filledCount());
  }

  function onSlotClick(index) {
    if (isGameOverBoard) return;
    if (isRolling || currentNumber == null) return;
    if (locked[index] != null) return;

    if (isIgnoreConfirmOn()) {
      previewIndex = index;
      beepRowSelect();
      tryConfirm();
      return;
    }

    if (previewIndex === index) {
      tryConfirm();
      return;
    }

    if (previewIndex != null && previewIndex !== index) {
      previewIndex = index;
      beepRowSelect();
      renderSlots();
      return;
    }

    previewIndex = index;
    beepRowSelect();
    renderSlots();
  }

  function tryConfirm() {
    if (isRolling) return;
    if (previewIndex == null || currentNumber == null) return;
    const i = previewIndex;
    const v = currentNumber;

    if (!validatePlacement(i, v)) {
      lastLossHintDraw = v;
      gameOver("invalid");
      return;
    }

    locked[i] = v;
    previewIndex = null;

    const done = filledCount();
    if (done >= SLOT_COUNT) {
      win();
      return;
    }

    if (!greedyRemainingFeasible(locked)) {
      gameOver("unwinnable-board");
      return;
    }

    currentNumber = null;
    scheduleRoll();
  }

  const GO_MSG = {
    invalid: "",
    "unwinnable-draw": "",
    "unwinnable-board": "",
  };

  function triggerRollLossPulse() {
    if (!rollContainer) return;
    if (rollLossPulseClearTimer != null) {
      clearTimeout(rollLossPulseClearTimer);
      rollLossPulseClearTimer = null;
    }
    rollContainer.classList.remove("roll-loss-pulse");
    void rollContainer.offsetWidth;
    rollContainer.classList.add("roll-loss-pulse");
    rollLossPulseClearTimer = window.setTimeout(() => {
      rollContainer.classList.remove("roll-loss-pulse");
      rollLossPulseClearTimer = null;
    }, 3100);
  }

  function triggerGameLossBackgroundPulse() {
    if (!gameLossFlash) return;
    gameLossFlash.classList.remove("is-playing");
    void gameLossFlash.offsetWidth;
    gameLossFlash.classList.add("is-playing");
    gameLossFlash.addEventListener(
      "animationend",
      (e) => {
        if (e.target !== gameLossFlash) return;
        gameLossFlash.classList.remove("is-playing");
      },
      { once: true }
    );
  }

  function resetRollDrawLabelGameOverStyle() {
    const el = $("#roll-draw-label");
    if (!el) return;
    el.classList.remove("roll-draw-label--game-over");
  }

  function setRollDrawLabelGameOver() {
    const el = $("#roll-draw-label");
    if (!el) return;
    el.classList.remove("roll-draw-label--game-over");
    void el.offsetWidth;
    el.textContent = "Game Over";
    el.setAttribute("aria-live", "assertive");
    el.classList.add("roll-draw-label--game-over");
  }

  function gameOver(reason = "invalid") {
    clearRollSettleTimer();
    hidePostGameoverBar();
    const elapsedMs = gameStartMs ? Date.now() - gameStartMs : 0;
    freezeGameTimer();
    let hintNum = null;
    if (reason === "invalid" || reason === "unwinnable-draw") {
      hintNum = lastLossHintDraw;
    }
    lastLossHintDraw = null;
    lossInsertionHint = hintNum != null ? computeLossInsertionHint(locked, hintNum) : null;
    isGameOverBoard = true;
    currentNumber = null;
    previewIndex = null;
    isRolling = false;
    const score = filledCount();
    const hooks = window.OneTo500Hooks;
    let lossHandledByHook = false;
    if (hooks && typeof hooks.handleRunEnd === "function") {
      lossHandledByHook = hooks.handleRunEnd({ outcome: "loss", reason, score, elapsedMs });
    }
    let offerSpeedTipAfterLoss = false;
    if (!lossHandledByHook) {
      recordStatsRunEnd(false, elapsedMs, score);
      recordLeaderboardRun(score, elapsedMs);
      recordBestTimeForScore(score, elapsedMs);
      const best = getHighScore();
      if (score > best) setHighScore(score);
      else refreshHighScoreUI();
      if (goScore) goScore.textContent = String(score);
      const goMsgText = GO_MSG[reason] ?? "";
      if (goMessage) {
        goMessage.textContent = goMsgText;
        const hide = !goMsgText.trim();
        goMessage.classList.toggle("hidden", hide);
        goMessage.setAttribute("aria-hidden", hide ? "true" : "false");
      }
      offerSpeedTipAfterLoss = shouldOfferSpeedTip();
      if (isAutoPlayAgainOn() && !offerSpeedTipAfterLoss) {
        clearAutoPlayAgainAfterLossTimer();
        showPostGameoverBar();
        setPostGameoverActionsVisible(false);
        autoPlayAgainAfterLossTimerId = window.setTimeout(() => {
          autoPlayAgainAfterLossTimerId = null;
          if (!isGameOverBoard) return;
          const g = screenGame || document.getElementById("screen-game");
          if (!g || g.classList.contains("hidden")) return;
          startGame();
        }, AUTO_PLAY_AGAIN_DELAY_MS);
      } else {
        showPostGameoverBar();
        setPostGameoverActionsVisible(true);
      }
    }
    playGameOverSound();
    renderSlots();
    triggerRollLossPulse();
    triggerGameLossBackgroundPulse();
    setRollDrawLabelGameOver();
    if (offerSpeedTipAfterLoss) {
      requestAnimationFrame(() => openSpeedTipOverlay());
    }
  }

  function win() {
    const elapsedMs = gameStartMs ? Date.now() - gameStartMs : 0;
    freezeGameTimer();
    const hooks = window.OneTo500Hooks;
    if (hooks && typeof hooks.handleRunEnd === "function") {
      if (hooks.handleRunEnd({ outcome: "win", reason: "", score: SLOT_COUNT, elapsedMs })) {
        isGameOverBoard = false;
        playWinFanfare();
        return;
      }
    }
    isGameOverBoard = false;
    recordStatsRunEnd(true, elapsedMs, SLOT_COUNT);
    recordLeaderboardRun(SLOT_COUNT, elapsedMs);
    recordBestTimeForScore(SLOT_COUNT, elapsedMs);
    setHighScore(10);
    const winTimeEl = $("#win-time-elapsed");
    if (winTimeEl) winTimeEl.textContent = formatGameElapsed(elapsedMs);
    showOverlay(overlayWin, $("#overlay-win-panel"));
    playWinFanfare();
    fireConfetti();
  }

  function showOverlay(overlay, panel) {
    pauseGameTimerForOverlay();
    overlay.classList.remove("hidden");
    overlay.setAttribute("aria-hidden", "false");
    requestAnimationFrame(() => {
      overlay.classList.remove("opacity-0");
      if (panel) panel.classList.remove("scale-95");
    });
  }

  function hideOverlay(overlay, panel) {
    overlay.classList.add("opacity-0");
    if (panel) panel.classList.add("scale-95");
    setTimeout(() => {
      overlay.classList.add("hidden");
      overlay.setAttribute("aria-hidden", "true");
      resumeGameTimerAfterOverlay();
    }, 280);
  }

  function fireConfetti() {
    const canvas = $("#confetti-canvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let w = (canvas.width = Math.floor(window.innerWidth * dpr));
    let h = (canvas.height = Math.floor(window.innerHeight * dpr));
    canvas.style.width = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;
    ctx.scale(dpr, dpr);

    const pieces = Array.from({ length: 120 }, () => ({
      x: Math.random() * window.innerWidth,
      y: -20 - Math.random() * 80,
      vx: (Math.random() - 0.5) * 4,
      vy: 2 + Math.random() * 5,
      r: 3 + Math.random() * 5,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.2,
      hue: 200 + Math.random() * 80,
    }));

    let frame = 0;
    const maxFrames = 140;

    function step() {
      frame++;
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      for (const p of pieces) {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.06;
        p.rot += p.vr;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = `hsla(${p.hue}, 75%, 65%, 0.9)`;
        ctx.fillRect(-p.r, -p.r, p.r * 2, p.r * 1.2);
        ctx.restore();
      }
      if (frame < maxFrames) requestAnimationFrame(step);
      else ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    }
    requestAnimationFrame(step);
  }

  function randomInt(a, b) {
    const hook = window.OneTo500Hooks && window.OneTo500Hooks.rollRandomInt;
    if (typeof hook === "function") return hook(a, b);
    return a + Math.floor(Math.random() * (b - a + 1));
  }

  function isCoarsePointer() {
    try {
      return window.matchMedia("(hover: none), (pointer: coarse)").matches;
    } catch (_) {
      return false;
    }
  }

  function scheduleRoll() {
    if (rollSettleTimerId != null) {
      clearTimeout(rollSettleTimerId);
      rollSettleTimerId = null;
    }
    if (rollEarlyHintTimerId != null) {
      clearTimeout(rollEarlyHintTimerId);
      rollEarlyHintTimerId = null;
    }
    earlyHintRevealPhase = false;
    hintRevealAlreadyPlayed = false;
    unlockAudioForRoll();
    isRolling = true;
    let finalNum;
    do {
      finalNum = randomInt(MIN_N, MAX_N);
    } while (usedRollNumbersThisRun.has(finalNum));
    usedRollNumbersThisRun.add(finalNum);
    renderSlots();

    const strip = rollStrip;
    const pool = [];
    const decoys = 22;
    /* Decoys must not repeat any value already used as a real draw this run (incl. this
       round’s finalNum), so the strip never shows the same integer twice before settle. */
    const stripTaken = new Set(usedRollNumbersThisRun);
    for (let k = 0; k < decoys; k++) {
      let d;
      let guard = 0;
      do {
        d = randomInt(MIN_N, MAX_N);
        guard++;
      } while (stripTaken.has(d) && guard < 6000);
      stripTaken.add(d);
      pool.push(d);
    }
    pool.push(finalNum);

    strip.innerHTML = "";
    pool.forEach((n) => {
      const el = document.createElement("div");
      el.className =
        "slot-roll-item text-6xl sm:text-7xl text-sky-700 dark:text-primary tabular-nums";
      el.textContent = String(n);
      strip.appendChild(el);
    });

    const itemPx = ITEM_H_REM * (parseFloat(getComputedStyle(document.documentElement).fontSize) || 16);
    const total = pool.length;
    const endY = -(total - 1) * itemPx;

    strip.style.transition = "none";
    strip.style.transform = "translateY(0px)";
    void strip.offsetHeight;
    strip.style.transition = `transform ${ROLL_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`;
    strip.style.transform = `translateY(${endY}px)`;

    prepareRollAudioThen(() => {
      startRollSound(Math.max(240, ROLL_MS - ROLL_SOUND_TRIM_MS), total);
    });

    let rollSettled = false;

    rollEarlyHintTimerId = window.setTimeout(() => {
      rollEarlyHintTimerId = null;
      if (rollSettled) return;
      if (!isCoarsePointer()) return;
      if (completedDrawCount > 0) return;
      if (!screenGame || screenGame.classList.contains("hidden")) return;
      hintRevealAlreadyPlayed = true;
      earlyHintRevealPhase = true;
      pendingMobileHintReveal = true;
      renderSlots();
      pendingMobileHintReveal = false;
    }, Math.max(0, ROLL_MS - HINT_REVEAL_LEAD_MS));

    const settleRoll = () => {
      if (rollSettled) return;
      rollSettled = true;
      rollSettleTimerId = null;
      if (rollEarlyHintTimerId != null) {
        clearTimeout(rollEarlyHintTimerId);
        rollEarlyHintTimerId = null;
      }
      earlyHintRevealPhase = false;
      stopRollSound();
      isRolling = false;
      if (!canPlaceCurrentSomewhere(locked, finalNum)) {
        currentNumber = finalNum;
        renderSlots();
        beep(380, 0.04);
        lastLossHintDraw = finalNum;
        gameOver("unwinnable-draw");
        return;
      }
      currentNumber = finalNum;
      const _dbgCoarse = isCoarsePointer();
      const isFirstDrawOfRun = completedDrawCount === 0;
      const doPlaceHintRevealAnim =
        _dbgCoarse && !hintRevealAlreadyPlayed && isFirstDrawOfRun;
      pendingMobileHintReveal = doPlaceHintRevealAnim;
      renderSlots();
      pendingMobileHintReveal = false;
      completedDrawCount += 1;
      beep(380, 0.04);
    };
    /* Use a fixed delay for game logic — some browsers fire transitionend early or twice,
       which unlocked the board before the roll animation finished and felt like instant Game Over. */
    rollSettleTimerId = window.setTimeout(settleRoll, ROLL_MS);
  }

  function clearRollSettleTimer() {
    if (rollSettleTimerId != null) {
      clearTimeout(rollSettleTimerId);
      rollSettleTimerId = null;
    }
  }

  function startGame() {
    clearAutoPlayAgainAfterLossTimer();
    const hooks = window.OneTo500Hooks;
    const isTwoPlayer = Boolean(hooks && hooks.skipRunStatsBump);
    trackUmami("game-run-start", { mode: isTwoPlayer ? "two-player" : "solo" });
    if (!hooks || !hooks.skipRunStatsBump) {
      bumpStatsRunStarted();
    }
    completedDrawCount = 0;
    usedRollNumbersThisRun = new Set();
    lossInsertionHint = null;
    lastLossHintDraw = null;
    isGameOverBoard = false;
    locked = Array(SLOT_COUNT).fill(null);
    currentNumber = null;
    previewIndex = null;
    isRolling = false;
    if (gameLossFlash) gameLossFlash.classList.remove("is-playing");
    screenStart.classList.add("hidden");
    screenGame.classList.remove("hidden");
    rollStrip.innerHTML = "";
    if (rollContainer) {
      rollContainer.classList.remove("roll-loss-pulse");
    }
    if (rollLossPulseClearTimer != null) {
      clearTimeout(rollLossPulseClearTimer);
      rollLossPulseClearTimer = null;
    }
    hidePostGameoverBar();
    resetRollDrawLabelGameOverStyle();
    const rollDrawLabel = $("#roll-draw-label");
    if (rollDrawLabel) {
      rollDrawLabel.removeAttribute("aria-live");
      if (!hooks || !hooks.skipRunStatsBump) {
        rollDrawLabel.textContent = "Current draw";
      }
    }
    resetGameTimerOverlayPauseState();
    startGameTimer();
    scheduleRoll();
  }

  function goHome() {
    clearAutoPlayAgainAfterLossTimer();
    const hooks = window.OneTo500Hooks;
    if (hooks && typeof hooks.onGoHomeFromGame === "function") {
      hooks.onGoHomeFromGame();
    }
    clearRollSettleTimer();
    if (rollEarlyHintTimerId != null) {
      clearTimeout(rollEarlyHintTimerId);
      rollEarlyHintTimerId = null;
    }
    if (rollLossPulseClearTimer != null) {
      clearTimeout(rollLossPulseClearTimer);
      rollLossPulseClearTimer = null;
    }
    if (rollContainer) rollContainer.classList.remove("roll-loss-pulse");
    earlyHintRevealPhase = false;
    isGameOverBoard = false;
    hidePostGameoverBar();
    resetRollDrawLabelGameOverStyle();
    const rollLblHome = $("#roll-draw-label");
    if (rollLblHome) rollLblHome.removeAttribute("aria-live");
    hideOverlay(overlayWin, $("#overlay-win-panel"));
    if (gameLossFlash) gameLossFlash.classList.remove("is-playing");
    screenGame.classList.add("hidden");
    screenStart.classList.remove("hidden");
    isRolling = false;
    currentNumber = null;
    previewIndex = null;
    resetGameTimerDisplay();
    refreshHighScoreUI();
    if (shouldOfferSpeedTip()) {
      requestAnimationFrame(() => openSpeedTipOverlay());
    }
  }

  function openModal(id) {
    const m = document.getElementById(id);
    if (!m) return;
    pauseGameTimerForOverlay();
    m.classList.add("is-open");
    m.setAttribute("aria-hidden", "false");
  }

  function closeModal(id) {
    const m = document.getElementById(id);
    if (!m) return;
    m.classList.remove("is-open");
    m.setAttribute("aria-hidden", "true");
    resumeGameTimerAfterOverlay();
  }

  function bind() {
    $("#btn-start-game").addEventListener("click", startGame);

    $("#btn-game-settings").addEventListener("click", () => {
      refreshSettingsPanel();
      openModal("modal-settings");
    });
    $("#btn-game-help").addEventListener("click", () => openModal("modal-help"));
    $("#btn-game-theme").addEventListener("click", toggleTheme);

    function restartGameNow() {
      const hooks = window.OneTo500Hooks;
      if (hooks && typeof hooks.abortTwoPlayerIfActive === "function") {
        hooks.abortTwoPlayerIfActive();
      }
      stopRollSound();
      startGame();
    }

    $("#btn-game-restart").addEventListener("click", () => {
      const inProgress =
        filledCount() > 0 ||
        currentNumber != null ||
        isRolling ||
        previewIndex != null ||
        isGameOverBoard;
      if (inProgress) {
        showOverlay(overlayRestartConfirm, overlayRestartPanel);
        return;
      }
      restartGameNow();
    });

    $("#btn-restart-confirm-yes").addEventListener("click", () => {
      hideOverlay(overlayRestartConfirm, overlayRestartPanel);
      restartGameNow();
    });
    $("#btn-restart-confirm-cancel").addEventListener("click", () => {
      hideOverlay(overlayRestartConfirm, overlayRestartPanel);
    });
    if (overlayRestartConfirm) {
      overlayRestartConfirm.addEventListener("click", (e) => {
        if (e.target === overlayRestartConfirm) hideOverlay(overlayRestartConfirm, overlayRestartPanel);
      });
    }

    slotsContainer.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-slot-index]");
      if (!btn || btn.disabled) return;
      onSlotClick(parseInt(btn.dataset.slotIndex, 10));
    });

    const btnPostGoRetry = $("#btn-post-go-retry");
    const btnPostGoHome = $("#btn-post-go-home");
    if (btnPostGoRetry) {
      btnPostGoRetry.addEventListener("click", () => {
        hidePostGameoverBar();
        startGame();
      });
    }
    if (btnPostGoHome) {
      btnPostGoHome.addEventListener("click", () => {
        hidePostGameoverBar();
        goHome();
      });
    }
    $("#btn-win-continue").addEventListener("click", () => {
      hideOverlay(overlayWin, $("#overlay-win-panel"));
      goHome();
    });

    document.querySelectorAll(".modal-close").forEach((b) => {
      b.addEventListener("click", () => closeModal(b.getAttribute("data-close")));
    });
    const modalStatistics = $("#modal-statistics");
    const modalHighscores = $("#modal-highscores");
    [modalHelp, modalSettings, modalStatistics, modalHighscores].forEach((m) => {
      if (!m) return;
      m.addEventListener("click", (e) => {
        if (e.target === m) closeModal(m.id);
      });
    });

    $("#btn-toggle-sound").addEventListener("click", () => {
      const on = localStorage.getItem(LS_SOUND) === "off";
      localStorage.setItem(LS_SOUND, on ? "on" : "off");
      setSoundLabel();
    });

    if (btnToggleAutoPlayAgain) {
      btnToggleAutoPlayAgain.addEventListener("click", () => {
        const nextOn = !isAutoPlayAgainOn();
        localStorage.setItem(LS_AUTO_PLAY_AGAIN, nextOn ? "on" : "off");
        setAutoPlayAgainLabel();
      });
    }

    const btnSpeedTipAuto = $("#btn-speed-tip-toggle-auto");
    if (btnSpeedTipAuto) {
      btnSpeedTipAuto.addEventListener("click", () => {
        const nextOn = !isAutoPlayAgainOn();
        localStorage.setItem(LS_AUTO_PLAY_AGAIN, nextOn ? "on" : "off");
        setAutoPlayAgainLabel();
      });
    }

    if (btnToggleIgnoreConfirm) {
      btnToggleIgnoreConfirm.addEventListener("click", () => {
        const nextOn = !isIgnoreConfirmOn();
        localStorage.setItem(LS_IGNORE_CONFIRM, nextOn ? "on" : "off");
        setIgnoreConfirmLabel();
        renderSlots();
      });
    }

    const btnSpeedTipIgnore = $("#btn-speed-tip-toggle-ignore");
    if (btnSpeedTipIgnore) {
      btnSpeedTipIgnore.addEventListener("click", () => {
        const nextOn = !isIgnoreConfirmOn();
        localStorage.setItem(LS_IGNORE_CONFIRM, nextOn ? "on" : "off");
        setIgnoreConfirmLabel();
        renderSlots();
      });
    }

    const btnSpeedTipDismiss = $("#btn-speed-tip-dismiss");
    if (btnSpeedTipDismiss) {
      btnSpeedTipDismiss.addEventListener("click", () => {
        dismissSpeedTipOverlay();
      });
    }
    if (overlaySpeedTip) {
      overlaySpeedTip.addEventListener("click", (e) => {
        if (e.target === overlaySpeedTip) dismissSpeedTipOverlay();
      });
    }

    $("#btn-reset-stats").addEventListener("click", () => {
      showOverlay(overlayResetStatsConfirm, overlayResetStatsPanel);
    });
    $("#btn-reset-stats-confirm-yes").addEventListener("click", () => {
      hideOverlay(overlayResetStatsConfirm, overlayResetStatsPanel);
      localStorage.removeItem(LS_STATS);
      localStorage.removeItem(LS_LEADERBOARD);
      try {
        localStorage.removeItem(LS_SPEED_TIP_SHOWN);
      } catch (_) {}
      refreshStatsDisplay();
      refreshLeaderboardTable();
      beep(300, 0.05);
    });
    $("#btn-reset-stats-confirm-cancel").addEventListener("click", () => {
      hideOverlay(overlayResetStatsConfirm, overlayResetStatsPanel);
    });
    if (overlayResetStatsConfirm) {
      overlayResetStatsConfirm.addEventListener("click", (e) => {
        if (e.target === overlayResetStatsConfirm) hideOverlay(overlayResetStatsConfirm, overlayResetStatsPanel);
      });
    }

    $("#btn-open-statistics").addEventListener("click", () => {
      refreshStatsDisplay();
      openModal("modal-statistics");
    });

    $("#btn-open-highscores").addEventListener("click", () => {
      refreshLeaderboardTable();
      openModal("modal-highscores");
    });

    $("#btn-install").addEventListener("click", async () => {
      if (!deferredInstall) return;
      deferredInstall.prompt();
      const { outcome } = await deferredInstall.userChoice;
      if (outcome === "accepted") deferredInstall = null;
      btnInstall.classList.add("hidden");
    });

    window.addEventListener("beforeinstallprompt", (e) => {
      e.preventDefault();
      deferredInstall = e;
      btnInstall.classList.remove("hidden");
    });

    document.addEventListener("visibilitychange", () => {
      if (document.hidden || !audioCtx) return;
      try {
        void audioCtx.resume();
      } catch (_) {}
    });
  }

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    });
  }

  loadTheme();
  refreshHighScoreUI();
  setSoundLabel();
  setAutoPlayAgainLabel();
  setIgnoreConfirmLabel();
  refreshStatsDisplay();
  refreshLeaderboardTable();
  bind();
  renderSlots();

  window.OneTo500Game = {
    startGame,
    goHome,
    formatGameElapsed,
    trackUmami,
    pauseTimerForOverlay: pauseGameTimerForOverlay,
    resumeTimerAfterOverlay: resumeGameTimerAfterOverlay,
    markTimerOverlayLayerReplace,
    resetTimerOverlayPauseState: resetGameTimerOverlayPauseState,
  };
})();
