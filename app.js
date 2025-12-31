// app.js (UI + engine wiring)
// Ukeflow - v22 (engine split) - UI Step A: Fingerboard Layout

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

// NEXT 表示を「右から出てきた瞬間」に合わせる（新しい chordEventId の最初の spawn で更新）
let __lastNextChordEventId = 0;

// 上から 1弦(A) → 2弦(E) → 3弦(C) → 4弦(G)
const LANES = [
  { key: "1", hint: "1弦(A)" },
  { key: "2", hint: "2弦(E)" },
  { key: "3", hint: "3弦(C)" },
  { key: "4", hint: "4弦(G)" },
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
  const st = mapFloatToSticker(text);
  if (st) showSticker(st.kind, st.label);
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

// ===== B: Comic HIT sticker =====
let __stickerTimer = null;

function showSticker(kind, text) {
  const sticker = $("hitSticker");
  const txt = $("hitStickerText");
  if (!sticker || !txt) return;

  txt.textContent = text;

  sticker.classList.remove("perfect","great","ok","miss","show","pop","fade");
  if (kind) sticker.classList.add(kind);
  sticker.classList.add("show","pop");

  clearTimeout(__stickerTimer);
  __stickerTimer = setTimeout(() => {
    sticker.classList.remove("pop");
    sticker.classList.add("fade");
    setTimeout(() => {
      sticker.classList.remove("show","fade");
    }, 260);
  }, 420);
}

function mapFloatToSticker(text) {
  if (!text) return null;
  if (text.includes("PERFECT")) return { kind:"perfect", label:"PERFECT!" };
  if (text.includes("GREAT"))   return { kind:"great",   label:"GREAT!" };
  if (text === "OK")            return { kind:"ok",      label:"OK!" };
  if (text.includes("MISS"))    return { kind:"miss",    label:"MISS..." };
  if (text === "START!")        return { kind:"great",   label:"START!" };
  return null;
}

// 判定ライン（左端付近）
const HIT_X = 26;

// 見せたいフレット数
const FRET_COUNT = 12;
const RIGHT_PADDING = 24;
  }

  // --- flicker guard (stable for N ms) ---
  if (bestChord !== __currentChordShown) {
    const now = performance.now();
    if (__pendingChord !== bestChord) {
      __pendingChord = bestChord;
      __pendingSince = now;
      return;
    }
    if (now - __pendingSince < __CHORD_STABLE_MS) return;

    __currentChordShown = bestChord;
    __pendingChord = null;
    setNextChordLabel(bestChord);
  } else {
    __pendingChord = null;
  }
}


// フレット番号→X座標（等間隔）
function fretToX(laneEl, fret) {
  const w = laneEl.getBoundingClientRect().width;
  const usable = Math.max(160, w - HIT_X - RIGHT_PADDING);
  const step = usable / (FRET_COUNT + 1);
  const x1 = HIT_X + step; // 1F
  return x1 + (fret - 1) * step;
}

function buildFretRuler() {
  const ruler = $("fretRuler");
  if (!ruler) return;
  ruler.innerHTML = "";
  // 1..12
  for (let i = 1; i <= FRET_COUNT; i++) {
    const d = document.createElement("div");
    d.className = "fretNum";
    d.textContent = String(i);
    ruler.appendChild(d);
  }
}

function buildLanes() {
  if (!laneGrid) return;
  laneGrid.innerHTML = "";

  LANES.forEach((l, i) => {
    const lane = document.createElement("div");
    lane.className = "lane lane--string fretGrid";
    lane.dataset.index = String(i);

    // 左のラベル（弦名）
    const header = document.createElement("div");
    header.className = "laneHeader";
    header.innerHTML = `<div class="laneLabel">${l.key}</div><div class="laneHint">${l.hint}</div>`;
    lane.appendChild(header);

    // どの弦をタップしてもSTRUM
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
}

function setNextChordLabel(chordText) {
  const v = chordText || "-";
  const el1 = $("nextChord");
  if (el1) el1.textContent = v;
  const el2 = $("nextChordBoard");
  if (el2) el2.textContent = v;
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
  onNextChord: (_ch) => {}, // NEXTはspawn瞬間で更新する
  onFlashPads: () => flash(pads),

  onNowReady: (isReady) => {
    const board = $("fretboard");
    if (board) board.classList.toggle("nowReady", !!isReady);
  },

  spawnToken: ({ laneIndex, fret, finger, chord, chordEventId, targetTimeMs, travelMs }) => {
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

    const obj = {
      el,
      laneIndex,
      startX,
      targetX,
      fretOffset,
      targetTimeMs,
      travelMs,
      hit: false,
      ready: false,
      chordName: chord || "-",
      chordEventId: chordEventId || 0,
      x: null,
    };

    
    // 初回spawn時は即更新（右から出た瞬間の表示）
    
    return obj;
  },

  renderToken: (t, x) => {
    if (!t?.el) return;
    t.x = x;
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
    t.el.classList.add("burst");
    setTimeout(() => t.el?.remove(), 140);
  },

  onTokenMiss: (t) => {
    if (!t?.el) return;
    t.el.classList.remove("ready");
    t.el.classList.add("miss");
    t.el.classList.add("burst");
    setTimeout(() => t.el?.remove(), 160);
  },

  removeToken: (t) => {
    try {  } catch (_) {}
    try { t?.el?.remove(); } catch (_) {}
    
  },

  isTokenAlive: (t) => !!t?.el,
};

// ---- create engine ----
const engine = window.UkeflowEngine.createEngine(adapter);

// ---- controls ----
function resetGame() {
  __lastNextChordEventId = 0;
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

    if (!engine.isRunning()) resetGame();
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
buildFretRuler();
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
