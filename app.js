// app.js (UI + engine wiring)
// Ukeflow - v22 (engine split)

const $ = (id) => document.getElementById(id);

const laneGrid = $("laneGrid");
const pads = $("pads");
const floating = $("floating");

const scoreEl = $("score");
const comboEl = $("combo");
const bpmEl = $("bpm");
const runEl = $("run");

const btnStart = $("btnStart");
const btnPause = $("btnPause");
const btnReset = $("btnReset");

const courseSel = $("course");
const speedRange = $("speed");
const bpmInput = $("bpmInput");
const windowInput = $("windowInput");
const customProg = $("customProg");

// 上から 1弦(A) → 2弦(E) → 3弦(C) → 4弦(G)
const LANES = [
  { key: "A", hint: "1弦(A)" },
  { key: "E", hint: "2弦(E)" },
  { key: "C", hint: "3弦(C)" },
  { key: "G", hint: "4弦(G)" },
];

const FINGERS = { I: "人", M: "中", R: "薬", P: "小" };

// frets: [A,E,C,G]（0=開放, >0=押さえる）
// fingers: [A,E,C,G]（I/M/R/P もしくは null）
const CHORDS = {
  F: { frets: [0, 1, 0, 2], fingers: [null, "I", null, "M"] }, // E1=人 / G2=中
  C: { frets: [3, 0, 0, 0], fingers: ["R", null, null, null] }, // A3=薬
  Am: { frets: [0, 0, 0, 2], fingers: [null, null, null, "M"] }, // G2=中
  G: { frets: [2, 3, 2, 0], fingers: ["I", "R", "M", null] }, // A2=人 / E3=薬 / C2=中
};

// ★コースは「コード名」と「拍数」を持つ（コード間の間隔がこのbeatsで決まる）
const COURSES = {
  lemon_basic: [
    { chord: "C", beats: 2 },
    { chord: "Am", beats: 2 },
    { chord: "F", beats: 2 },
    { chord: "G", beats: 2 },
  ],
  gcea: [
    { chord: "Am", beats: 2 },
    { chord: "G", beats: 2 },
    { chord: "F", beats: 2 },
    { chord: "C", beats: 2 },
  ],
};

function bindTap(el, handler, opts = {}) {
  if (!el) return;
  let last = 0;
  const wrapped = (e) => {
    const now = Date.now();
    if (now - last < 450) return; // iOS: touch→click二重発火対策
    last = now;
    try {
      if (opts.preventDefault) e.preventDefault();
    } catch (_) {}
    handler(e);
  };
  el.addEventListener("pointerdown", wrapped);
  el.addEventListener("touchstart", wrapped, { passive: !opts.preventDefault });
  el.addEventListener("click", wrapped);
}

function flash(el) {
  if (!el) return;
  el.classList.add("tapFlash");
  setTimeout(() => el.classList.remove("tapFlash"), 120);
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function setRun(on) {
  if (runEl) runEl.textContent = on ? "ON" : "OFF";
}

function setHUD({ score, combo, bpm, running, paused }) {
  scoreEl.textContent = String(score);
  comboEl.textContent = String(combo);
  bpmEl.textContent = String(bpm);
  setRun(running && !paused);
}

function showFloat(text) {
  if (!floating) return;
  floating.textContent = text;
  try {
    if (typeof floating.animate === "function") {
      floating.animate(
        [
          { opacity: 0, transform: "translateY(-10px)" },
          { opacity: 1, transform: "translateY(0)" },
          { opacity: 0, transform: "translateY(-10px)" },
        ],
        { duration: 900, easing: "ease-out" }
      );
      return;
    }
  } catch (e) {}
  floating.style.opacity = "1";
  floating.style.transform = "translateY(0)";
  clearTimeout(showFloat._t);
  showFloat._t = setTimeout(() => {
    floating.style.opacity = "0";
    floating.style.transform = "translateY(-8px)";
  }, 700);
}

// 判定ライン（左端付近）
const HIT_X = 26;

// 見せたいフレット数（縦線を描く）
const FRET_COUNT = 9;
const RIGHT_PADDING = 24;

// フレット番号→X座標（等間隔）
function fretToX(laneEl, fret) {
  const w = laneEl.getBoundingClientRect().width;
  const usable = Math.max(100, w - HIT_X - RIGHT_PADDING);
  const step = usable / (FRET_COUNT + 1);
  const x1 = HIT_X + step; // 1F
  return x1 + (fret - 1) * step;
}

function buildLanes() {
  if (!laneGrid) return;
  laneGrid.innerHTML = "";

  LANES.forEach((l, i) => {
    const lane = document.createElement("div");
    lane.className = "lane lane--strip fretGrid";
    lane.dataset.index = String(i);

    const header = document.createElement("div");
    header.className = "laneHeader";
    header.innerHTML = `<div class="laneLabel">${l.key}</div><div class="laneHint">${l.hint}</div>`;
    lane.appendChild(header);

    bindTap(lane, () => engine.handleInput({ type: "STRUM" }), { preventDefault: true });

    laneGrid.appendChild(lane);
  });
}

function buildPads() {
  if (!pads) return;
  pads.innerHTML = "";

  const str = document.createElement("button");
  str.className = "btn btn--green btn--strum";
  str.id = "btnStrum";
  str.textContent = "🎵 STRUM";
  bindTap(str, () => engine.handleInput({ type: "STRUM" }), { preventDefault: true });
  pads.appendChild(str);

  const next = document.createElement("div");
  next.className = "nextBox";
  next.innerHTML = `<div class="nextLabel">NEXT</div><div id="nextChord" class="nextChord">-</div>`;
  pads.appendChild(next);
}

function setNextChordLabel(chordText) {
  const el = $("nextChord");
  if (!el) return;
  el.textContent = chordText || "-";
}

function resolveScore() {
  const v = courseSel?.value || "lemon_basic";

  if (COURSES[v]) return COURSES[v].slice();

  if (v === "custom") {
    const arr = (customProg?.value || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const steps = arr.map((ch) => ({ chord: ch, beats: 2 }));
    return steps.length ? steps : COURSES.lemon_basic.slice();
  }

  return COURSES.lemon_basic.slice();
}

// ---- engine adapter ----
const adapter = {
  HIT_X,

  getChordDef: (chord) => CHORDS[chord] || null,

  getDefaultScoreData: () => COURSES.lemon_basic.slice(),

  onHUD: (s) => setHUD(s),

  onRun: (on) => setRun(on),

  onFloat: (text) => showFloat(text),

  onNextChord: (ch) => setNextChordLabel(ch),

  onFlashPads: () => flash(pads),

  onNowReady: (isReady) => {
    if (laneGrid) laneGrid.classList.toggle("nowReady", !!isReady);
  },

  spawnToken: ({ laneIndex, fret, finger, targetTimeMs, travelMs }) => {
    const laneEl = laneGrid?.children?.[laneIndex];
    if (!laneEl) return null;

    const el = document.createElement("div");
    el.className = "fingerDot";
    el.innerHTML = `<span class="fingerChar">${FINGERS[finger] || "?"}</span>`;

    const laneW = laneEl.getBoundingClientRect().width;
    const startX = laneW + 80;

    el.style.transform = `translate3d(${startX}px,0,0)`;
    el.style.visibility = "hidden";
    laneEl.appendChild(el);
    requestAnimationFrame(() => {
      el.style.visibility = "visible";
    });

    const targetX = fretToX(laneEl, fret);

    const x1 = fretToX(laneEl, 1);
    const fretOffset = targetX - x1;

    return {
      el,
      laneIndex,
      startX,
      targetX,
      fretOffset,
      targetTimeMs,
      travelMs,
      hit: false,
      ready: false,
    };
  },

  renderToken: (t, x) => {
    if (!t?.el) return;
    t.el.style.transform = `translateX(${x}px) translateY(-50%)`;
  },

  onTokenReady: (t, isReady) => {
    if (!t?.el) return;
    t.el.classList.toggle("ready", !!isReady);
  },

  onTokenHit: (t) => {
    if (!t?.el) return;
    t.el.classList.remove("ready");
    t.el.classList.add("hit");
    setTimeout(() => t.el?.remove(), 140);
  },

  onTokenMiss: (t) => {
    if (!t?.el) return;
    t.el.classList.remove("ready");
    t.el.classList.add("miss");
    setTimeout(() => t.el?.remove(), 160);
  },

  removeToken: (t) => {
    try {
      t?.el?.remove();
    } catch (_) {}
  },

  isTokenAlive: (t) => !!t?.el,
};

// ---- create engine ----
const engine = window.UkeflowEngine.createEngine(adapter);

// ---- controls ----
function resetGame() {
  const bpm = clamp(parseInt(bpmInput?.value || "90", 10), 60, 200);
  const flowSpeed = clamp(parseFloat(speedRange?.value || "1.0"), 0.7, 1.8);
  const hitWindowMs = clamp(parseInt(windowInput?.value || "140", 10), 60, 280);
  const scoreData = resolveScore();

  if (btnPause) {
    btnPause.disabled = true;
    btnPause.textContent = "⏸ PAUSE";
  }
  if (btnStart) btnStart.disabled = false;

  engine.reset({ bpm, flowSpeed, hitWindowMs, scoreData });
}

function startGame() {
  resetGame();

  if (btnPause) btnPause.disabled = false;
  if (btnStart) btnStart.disabled = true;

  engine.handleInput({ type: "START" });
}

function togglePause() {
  if (!engine.isRunning()) return;

  engine.handleInput({ type: "PAUSE_TOGGLE" });

  if (btnPause) btnPause.textContent = engine.isPaused() ? "▶ RESUME" : "⏸ PAUSE";
}

bindTap(btnStart, startGame);
bindTap(btnPause, togglePause);
bindTap(btnReset, resetGame);

// ---- settings ----
[bpmInput, speedRange, windowInput, customProg, courseSel].forEach((el) => {
  if (!el) return;
  el.addEventListener("change", () => {
    const bpm = clamp(parseInt(bpmInput?.value || "90", 10), 60, 200);
    bpmEl.textContent = String(bpm);

    if (!engine.isRunning()) {
      resetGame();
    }
    showFloat("SET!");
  });
});

// iOS double-tap zoom prevention
let lastTouch = 0;
document.addEventListener(
  "touchend",
  (e) => {
    const now = Date.now();
    if (now - lastTouch <= 300) e.preventDefault();
    lastTouch = now;
  },
  { passive: false }
);

// 起動
showFloat("JS OK");
buildLanes();
buildPads();
resetGame();

window.addEventListener("error", (e) => {
  try {
    floating.textContent = "JSエラー: " + (e.message || "unknown");
    floating.style.opacity = "1";
  } catch (_) {}
});

window.__UKEFLOW = { start: startGame, pause: togglePause, reset: resetGame, chords: CHORDS, engine };
