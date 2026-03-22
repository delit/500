(function () {
  "use strict";

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
  /** "off" disables haptics; default on when supported (PWA / mobile use same localStorage). */
  const LS_VIBRATION = "1to500_vibration";
  /** { runs, wins, losses, playTimeMs } — device-local, offline-safe. */
  const LS_STATS = "1to500_stats";

  // #region agent log
  function __agentDbg(loc, msg, data, hypothesisId) {
    fetch("http://127.0.0.1:7806/ingest/4aa1dc08-b460-47ce-ab0e-0e12506a41ab", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "5bbcbd" },
      body: JSON.stringify({
        sessionId: "5bbcbd",
        location: loc,
        message: msg,
        data: data || {},
        hypothesisId: hypothesisId || "",
        timestamp: Date.now(),
      }),
    }).catch(function () {});
  }
  // #endregion

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
  const vibrationState = $("#vibration-state");
  const vibrationSwitchTrack = $("#vibration-switch-track");
  const vibrationSwitchKnob = $("#vibration-switch-knob");
  const btnToggleVibration = $("#btn-toggle-vibration");
  const gameTimerEl = $("#game-timer");
  const postGameoverBar = $("#post-gameover-bar");

  function hidePostGameoverBar() {
    if (postGameoverBar) postGameoverBar.classList.add("hidden");
  }

  function showPostGameoverBar() {
    if (postGameoverBar) postGameoverBar.classList.remove("hidden");
  }

  function formatGameElapsed(ms) {
    const sec = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  function tickGameTimer() {
    if (!gameTimerEl || !gameStartMs) return;
    gameTimerEl.textContent = formatGameElapsed(Date.now() - gameStartMs);
  }

  function startGameTimer() {
    stopGameTimer();
    gameStartMs = Date.now();
    if (gameTimerEl) {
      gameTimerEl.textContent = "0:00";
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
    if (gameStartMs && gameTimerEl) {
      gameTimerEl.textContent = formatGameElapsed(Date.now() - gameStartMs);
    }
  }

  function resetGameTimerDisplay() {
    stopGameTimer();
    gameStartMs = 0;
    if (gameTimerEl) gameTimerEl.textContent = "0:00";
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

  function setSoundLabel() {
    const on = isSoundOn();
    if (soundState) soundState.textContent = on ? "On" : "Off";
    if (btnToggleSound) btnToggleSound.setAttribute("aria-checked", on ? "true" : "false");
    if (soundSwitchTrack && soundSwitchKnob) {
      const st = soundSwitchTrack;
      st.classList.remove(
        "bg-slate-400",
        "dark:bg-white/25",
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
        st.classList.add("bg-slate-400", "dark:bg-white/25", "shadow-inner");
      }
      soundSwitchKnob.style.transform = on ? "translateX(1.25rem)" : "translateX(0)";
    }
  }

  function canVibrate() {
    return typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
  }

  function isVibrationSettingOn() {
    return localStorage.getItem(LS_VIBRATION) !== "off";
  }

  function setVibrationLabel() {
    if (!vibrationState || !btnToggleVibration) return;
    if (!canVibrate()) {
      vibrationState.textContent = "N/A";
      vibrationState.classList.remove("text-primary");
      vibrationState.classList.add("text-slate-400", "dark:text-on-surface/45");
      btnToggleVibration.disabled = true;
      btnToggleVibration.setAttribute("aria-disabled", "true");
      btnToggleVibration.setAttribute("aria-checked", "false");
      if (vibrationSwitchTrack && vibrationSwitchKnob) {
        const vt = vibrationSwitchTrack;
        vt.classList.remove(
          "bg-gradient-to-r",
          "from-[#a6c9f8]",
          "to-[#6285b0]",
          "shadow-md",
          "shadow-sky-400/20",
          "bg-slate-400",
          "dark:bg-white/25",
          "shadow-inner"
        );
        vt.classList.add("bg-slate-300", "dark:bg-white/10", "opacity-60", "shadow-inner");
        vibrationSwitchKnob.style.transform = "translateX(0)";
      }
      return;
    }
    btnToggleVibration.disabled = false;
    btnToggleVibration.removeAttribute("aria-disabled");
    vibrationState.classList.remove("text-slate-400", "dark:text-on-surface/45");
    const on = isVibrationSettingOn();
    vibrationState.textContent = on ? "On" : "Off";
    btnToggleVibration.setAttribute("aria-checked", on ? "true" : "false");
    if (vibrationSwitchTrack && vibrationSwitchKnob) {
      const vt = vibrationSwitchTrack;
      vt.classList.remove("bg-slate-300", "dark:bg-white/10", "opacity-60");
      vt.classList.remove(
        "bg-slate-400",
        "dark:bg-white/25",
        "bg-gradient-to-r",
        "from-[#a6c9f8]",
        "to-[#6285b0]",
        "shadow-inner",
        "shadow-md",
        "shadow-sky-400/20"
      );
      if (on) {
        vt.classList.add("bg-gradient-to-r", "from-[#a6c9f8]", "to-[#6285b0]", "shadow-md", "shadow-sky-400/20");
      } else {
        vt.classList.add("bg-slate-400", "dark:bg-white/25", "shadow-inner");
      }
      vibrationSwitchKnob.style.transform = on ? "translateX(1.25rem)" : "translateX(0)";
    }
  }

  /** @param {number | number[]} pattern */
  function haptic(pattern) {
    if (!isVibrationSettingOn() || !canVibrate()) return;
    try {
      navigator.vibrate(pattern);
    } catch (_) {}
  }

  function hapticSelect() {
    haptic(14);
  }

  function hapticRollLand() {
    haptic(20);
  }

  function hapticConfirm() {
    haptic(26);
  }

  function hapticWin() {
    haptic([35, 55, 35, 55, 45]);
  }

  function hapticGameOver() {
    haptic([110, 45, 130]);
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

  function bumpStatsRunStarted() {
    const s = loadStats();
    s.runs = (s.runs || 0) + 1;
    saveStats(s);
  }

  function recordStatsRunEnd(won, elapsedMs) {
    const s = loadStats();
    if (won) s.wins = (s.wins || 0) + 1;
    else s.losses = (s.losses || 0) + 1;
    s.playTimeMs = (s.playTimeMs || 0) + Math.max(0, Math.round(elapsedMs || 0));
    saveStats(s);
  }

  function refreshStatsDisplay() {
    const s = loadStats();
    const runs = s.runs || 0;
    const wins = s.wins || 0;
    const losses = s.losses || 0;
    const elRuns = $("#stat-runs");
    const elWins = $("#stat-wins");
    const elLosses = $("#stat-losses");
    const elWr = $("#stat-winrate");
    const elPt = $("#stat-playtime");
    if (elRuns) elRuns.textContent = String(runs);
    if (elWins) elWins.textContent = String(wins);
    if (elLosses) elLosses.textContent = String(losses);
    if (elWr) elWr.textContent = runs > 0 ? `${Math.round((wins / runs) * 100)}%` : "—";
    if (elPt) elPt.textContent = formatGameElapsed(s.playTimeMs || 0);
  }

  function refreshSettingsPanel() {
    setSoundLabel();
    setVibrationLabel();
    refreshStatsDisplay();
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

  function renderSlots() {
    slotsContainer.innerHTML = "";
    const coarsePointer = isCoarsePointer();
    let emptyHintStagger = 0;
    for (let i = 0; i < SLOT_COUNT; i++) {
      const row = document.createElement("div");
      row.className = `min-h-0 flex items-stretch${isGameOverBoard ? " slot-row-go-pulse" : ""}`;
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
        btn.innerHTML = `
          <div class="flex items-center gap-3 sm:gap-4 min-w-0">
            <span class="font-headline font-bold text-sm text-sky-800/40 dark:text-white/35 shrink-0 tabular-nums">${String(i + 1).padStart(2, "0")}</span>
            <div class="h-8 w-px bg-sky-300/80 dark:bg-white/25 shrink-0"></div>
            <span class="font-headline font-extrabold text-2xl sm:text-3xl text-sky-900 dark:text-white tracking-tight tabular-nums">${currentNumber}</span>
          </div>
          <div class="flex items-center gap-2 bg-primary text-[#033258] px-4 py-2.5 rounded-lg text-sm font-bold uppercase tracking-wide animate-pulse shrink-0 shadow-md">
            <span>Confirm</span>
            <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>
          </div>`;
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
        if (useHintRevealAnim) {
          // #region agent log
          __agentDbg(
            "app.js:renderSlots",
            "hint_reveal_anim_row",
            {
              row: i,
              pendingMobileHintReveal: pendingMobileHintReveal,
              completedDrawCount: completedDrawCount,
              showPlaceHint: showPlaceHint,
              coarsePointer: coarsePointer,
              isRolling: isRolling,
              earlyHintRevealPhase: earlyHintRevealPhase,
            },
            "H3-H5"
          );
          // #endregion
        }
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

    if (previewIndex === index) {
      tryConfirm();
      return;
    }

    if (previewIndex != null && previewIndex !== index) {
      previewIndex = index;
      beepRowSelect();
      hapticSelect();
      renderSlots();
      return;
    }

    previewIndex = index;
    beepRowSelect();
    hapticSelect();
    renderSlots();
  }

  function tryConfirm() {
    if (isRolling) return;
    if (previewIndex == null || currentNumber == null) return;
    const i = previewIndex;
    const v = currentNumber;

    if (!validatePlacement(i, v)) {
      gameOver("invalid");
      return;
    }

    locked[i] = v;
    previewIndex = null;
    hapticConfirm();

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
    "unwinnable-board":
      "The open slots no longer have enough room in 1–500 to stay strictly ascending.",
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
    }, 1550);
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

  function gameOver(reason = "invalid") {
    clearRollSettleTimer();
    hidePostGameoverBar();
    const elapsedMs = gameStartMs ? Date.now() - gameStartMs : 0;
    freezeGameTimer();
    isGameOverBoard = true;
    currentNumber = null;
    previewIndex = null;
    isRolling = false;
    const score = filledCount();
    recordStatsRunEnd(false, elapsedMs);
    recordBestTimeForScore(score, elapsedMs);
    const best = getHighScore();
    if (score > best) setHighScore(score);
    else refreshHighScoreUI();
    if (goScore) goScore.textContent = String(score);
    if (goMessage) {
      const text = GO_MSG[reason] ?? "";
      goMessage.textContent = text;
      const hide = !text.trim();
      goMessage.classList.toggle("hidden", hide);
      goMessage.setAttribute("aria-hidden", hide ? "true" : "false");
    }
    showPostGameoverBar();
    hapticGameOver();
    playGameOverSound();
    renderSlots();
    triggerRollLossPulse();
  }

  function win() {
    isGameOverBoard = false;
    const elapsedMs = gameStartMs ? Date.now() - gameStartMs : 0;
    freezeGameTimer();
    recordStatsRunEnd(true, elapsedMs);
    recordBestTimeForScore(SLOT_COUNT, elapsedMs);
    setHighScore(10);
    const winTimeEl = $("#win-time-elapsed");
    if (winTimeEl) winTimeEl.textContent = formatGameElapsed(elapsedMs);
    showOverlay(overlayWin, $("#overlay-win-panel"));
    hapticWin();
    playWinFanfare();
    fireConfetti();
  }

  function showOverlay(overlay, panel) {
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
    // #region agent log
    __agentDbg(
      "app.js:scheduleRoll",
      "scheduleRoll_after_reset",
      {
        completedDrawCount: completedDrawCount,
        hintRevealAlreadyPlayed: hintRevealAlreadyPlayed,
        coarse: isCoarsePointer(),
      },
      "H1-H2"
    );
    // #endregion
    unlockAudioForRoll();
    isRolling = true;
    const finalNum = randomInt(MIN_N, MAX_N);
    renderSlots();

    const strip = rollStrip;
    const pool = [];
    const decoys = 22;
    for (let k = 0; k < decoys; k++) pool.push(randomInt(MIN_N, MAX_N));
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
      // #region agent log
      __agentDbg(
        "app.js:earlyTimer",
        "earlyTimer_entry",
        {
          rollSettled: rollSettled,
          coarse: isCoarsePointer(),
          completedDrawCount: completedDrawCount,
          hintPlayed: hintRevealAlreadyPlayed,
        },
        "H1-H2-H4"
      );
      // #endregion
      if (rollSettled) {
        // #region agent log
        __agentDbg("app.js:earlyTimer", "earlyTimer_skip", { reason: "rollSettled" }, "H2");
        // #endregion
        return;
      }
      if (!isCoarsePointer()) {
        // #region agent log
        __agentDbg("app.js:earlyTimer", "earlyTimer_skip", { reason: "not_coarse" }, "H4");
        // #endregion
        return;
      }
      if (completedDrawCount > 0) {
        // #region agent log
        __agentDbg("app.js:earlyTimer", "earlyTimer_skip", { reason: "draw_count_gt_0" }, "H1-H2");
        // #endregion
        return;
      }
      if (!screenGame || screenGame.classList.contains("hidden")) {
        // #region agent log
        __agentDbg("app.js:earlyTimer", "earlyTimer_skip", { reason: "screen_hidden" }, "H2");
        // #endregion
        return;
      }
      hintRevealAlreadyPlayed = true;
      earlyHintRevealPhase = true;
      pendingMobileHintReveal = true;
      renderSlots();
      pendingMobileHintReveal = false;
      // #region agent log
      __agentDbg("app.js:earlyTimer", "earlyTimer_applied_stagger", { completedDrawCount: completedDrawCount }, "H2");
      // #endregion
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
        gameOver("unwinnable-draw");
        return;
      }
      currentNumber = finalNum;
      const _dbgCoarse = isCoarsePointer();
      const isFirstDrawOfRun = completedDrawCount === 0;
      const doPlaceHintRevealAnim =
        _dbgCoarse && !hintRevealAlreadyPlayed && isFirstDrawOfRun;
      // #region agent log
      __agentDbg(
        "app.js:settleRoll",
        "settle_success",
        {
          coarse: _dbgCoarse,
          hintRevealAlreadyPlayed: hintRevealAlreadyPlayed,
          completedDrawCount: completedDrawCount,
          doPlaceHintRevealAnim: doPlaceHintRevealAnim,
        },
        "H1-H3-H4"
      );
      // #endregion
      pendingMobileHintReveal = doPlaceHintRevealAnim;
      renderSlots();
      pendingMobileHintReveal = false;
      completedDrawCount += 1;
      // #region agent log
      __agentDbg(
        "app.js:settleRoll",
        "settle_after_render",
        { completedDrawCount: completedDrawCount, didAnim: doPlaceHintRevealAnim },
        "H1-H3"
      );
      // #endregion
      hapticRollLand();
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
    bumpStatsRunStarted();
    completedDrawCount = 0;
    // #region agent log
    __agentDbg("app.js:startGame", "startGame_reset_draw_count", { completedDrawCount: 0 }, "H1");
    // #endregion
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
    startGameTimer();
    scheduleRoll();
  }

  function goHome() {
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
    hideOverlay(overlayWin, $("#overlay-win-panel"));
    if (gameLossFlash) gameLossFlash.classList.remove("is-playing");
    screenGame.classList.add("hidden");
    screenStart.classList.remove("hidden");
    isRolling = false;
    currentNumber = null;
    previewIndex = null;
    resetGameTimerDisplay();
    refreshHighScoreUI();
  }

  function openModal(id) {
    const m = document.getElementById(id);
    if (!m) return;
    m.classList.add("is-open");
    m.setAttribute("aria-hidden", "false");
  }

  function closeModal(id) {
    const m = document.getElementById(id);
    if (!m) return;
    m.classList.remove("is-open");
    m.setAttribute("aria-hidden", "true");
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

    $("#btn-post-go-retry").addEventListener("click", () => {
      hidePostGameoverBar();
      startGame();
    });
    $("#btn-post-go-home").addEventListener("click", () => {
      hidePostGameoverBar();
      goHome();
    });
    $("#btn-win-continue").addEventListener("click", () => {
      hideOverlay(overlayWin, $("#overlay-win-panel"));
      goHome();
    });

    document.querySelectorAll(".modal-close").forEach((b) => {
      b.addEventListener("click", () => closeModal(b.getAttribute("data-close")));
    });
    [modalHelp, modalSettings].forEach((m) => {
      m.addEventListener("click", (e) => {
        if (e.target === m) closeModal(m.id);
      });
    });

    $("#btn-toggle-sound").addEventListener("click", () => {
      const on = localStorage.getItem(LS_SOUND) === "off";
      localStorage.setItem(LS_SOUND, on ? "on" : "off");
      setSoundLabel();
    });

    $("#btn-toggle-vibration").addEventListener("click", () => {
      if (!canVibrate()) return;
      const on = localStorage.getItem(LS_VIBRATION) === "off";
      localStorage.setItem(LS_VIBRATION, on ? "on" : "off");
      setVibrationLabel();
      if (on) haptic(28);
    });

    $("#btn-reset-stats").addEventListener("click", () => {
      localStorage.removeItem(LS_STATS);
      refreshStatsDisplay();
      beep(300, 0.05);
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
  setVibrationLabel();
  refreshStatsDisplay();
  bind();
  renderSlots();
})();
