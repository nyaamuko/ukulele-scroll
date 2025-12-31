// Ukeflow - v18 (コード単位で同時到達 / 指〇ドット / 指板っぽい弦+フレット)
// A: C→Am→F→G を「コード単位」で流す（コード間に間隔）
//    ＝同じコード内の指は "同時" に判定ラインへ到達（フレット差は保持）
// B: BOXではなく、弦の横線上を指〇が流れる（フィンガーボード風）
//    判定ラインに来たら指〇が光る（今弾いて！が分かる）

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
  { key: "1", hint: "1弦" },
  { key: "2", hint: "2弦" },
  { key: "3", hint: "3弦" },
  { key: "4", hint: "4弦" },
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
  // 要望：C→Am→F→G（定番）
  lemon_basic: [
    { chord: "C", beats: 2 },
    { chord: "Am", beats: 2 },
    { chord: "F", beats: 2 },
    { chord: "G", beats: 2 },
  ],
  // 例
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

let running = false;
let paused = false;
let score = 0;
let combo = 0;

let rafId = null;
let lastTs = 0;
let songPosMs = 0;

let bpm = 90;
let flowSpeed = 1.0;
let hitWindowMs = 140;
let beatMs = 60000 / bpm;

// 判定ライン（左端付近）
const HIT_X = 26;

// 見せたいフレット数（縦線を描く）
const FRET_COUNT = 9;
const RIGHT_PADDING = 24;

// 譜面（[{chord, beats}]）
let scoreData = COURSES.lemon_basic.slice();
let stepIdx = 0;
let nextSpawnBeat = 0;
let spawnAheadBeats = 3.0;

let chordEvents = []; // {id, chord, targetTimeMs, hit, tokens:[]}
let nextEventId = 1;

let tokens = [];
  chordTokens = [];
let chordTokens = []; // {el,laneIndex,startX,targetX,targetTimeMs,travelMs,hit,ready}
let nowReady = false; // 「今弾いて」状態（判定ラインの発光用）

function setRun(on) {
  if (runEl) runEl.textContent = on ? "ON" : "OFF";
}

function setHUD() {
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

    // どの弦をタップしてもSTRUM
    bindTap(lane, () => strum(), { preventDefault: true });

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
  bindTap(str, () => strum(), { preventDefault: true });
  pads.appendChild(str);

  const next = document.createElement("div");
  next.className = "nextBox";
  next.innerHTML = `<div class="nextLabel">NEXT</div><div id="nextChord" class="nextChord">-</div>`;
  pads.appendChild(next);
}

function setNextChordLabel() {
  const el = $("nextChord");
  if (!el) return;
  const step = scoreData[stepIdx % scoreData.length];
  el.textContent = step?.chord || "-";
}

function resolveScore() {
  const v = courseSel?.value || "lemon_basic";

  // 既存セレクトの value と一致しない場合もfallback
  if (COURSES[v]) return COURSES[v].slice();

  if (v === "custom") {
    const arr = (customProg?.value || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    // beatsは一旦2固定（後でUIで beats 入れられるように拡張）
    const steps = arr.map((ch) => ({ chord: ch, beats: 2 }));
    return steps.length ? steps : COURSES.lemon_basic.slice();
  }

  return COURSES.lemon_basic.slice();
}

// フレット番号→X座標（等間隔）
function fretToX(laneEl, fret) {
  const w = laneEl.getBoundingClientRect().width;
  const usable = Math.max(100, w - HIT_X - RIGHT_PADDING);
  const step = usable / (FRET_COUNT + 1);
  const x1 = HIT_X + step; // 1F
  return x1 + (fret - 1) * step;
}

function resetGame() {
  stopLoop();
  running = false;
  paused = false;

  score = 0;
  combo = 0;

  bpm = clamp(parseInt(bpmInput?.value || "90", 10), 60, 200);
  beatMs = 60000 / bpm;
  flowSpeed = clamp(parseFloat(speedRange?.value || "1.0"), 0.7, 1.8);
  hitWindowMs = clamp(parseInt(windowInput?.value || "140", 10), 60, 280);

  scoreData = resolveScore();
  stepIdx = 0;

  tokens.forEach((t) => t.el?.remove());
  tokens = [];
  chordTokens = [];
  chordEvents = [];
  nextEventId = 1;

  songPosMs = 0;
  nextSpawnBeat = 0;
  nowReady = false;

  if (btnPause) {
    btnPause.disabled = true;
    btnPause.textContent = "⏸ PAUSE";
  }
  if (btnStart) btnStart.disabled = false;

  setHUD();
  setNextChordLabel();
  showFloat("READY!");
}

function startGame() {
  if (running) return;
  resetGame();
  running = true;
  paused = false;

  if (btnPause) btnPause.disabled = false;
  if (btnStart) btnStart.disabled = true;

  setHUD();
  showFloat("START!");
  startLoop();
}

function togglePause() {
  if (!running) return;
  paused = !paused;
  if (btnPause) btnPause.textContent = paused ? "▶ RESUME" : "⏸ PAUSE";
  setHUD();
  if (!paused) {
    lastTs = performance.now();
    startLoop();
  }
}

function stopLoop() {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;
  lastTs = 0;
}

function startLoop() {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(tick);
}

// ★コードイベント生成：同じコード内の指は "同じ targetTimeMs"
function spawnChordEvent(chord, beatAt) {
  const def = CHORDS[chord];
  if (!def) return;

  const targetTimeMs = beatAt * beatMs;

  const ev = { id: nextEventId++, chord, targetTimeMs, hit: false, tokens: [] };
  chordEvents.push(ev);

  for (let laneIndex = 0; laneIndex < 4; laneIndex++) {
    const fret = def.frets[laneIndex];
    const finger = def.fingers[laneIndex];
    if (!fret || fret <= 0) continue;

    const laneEl = laneGrid?.children?.[laneIndex];
    if (!laneEl) continue;

    const el = document.createElement("div");
    el.className = "fingerDot";
    el.innerHTML = `<span class="fingerChar">${FINGERS[finger] || "?"}</span>`;
    laneEl.appendChild(el);

    const laneW = laneEl.getBoundingClientRect().width;
    const startX = laneW + 80;
    const targetX = fretToX(laneEl, fret);
    // ★出現時点からフレット差（例: F=1F/2F, G=2F/3F）を見せるためのオフセット
    //   到達点(targetX)は変えないので判定位置はそのまま
    const x1 = fretToX(laneEl, 1);
    const fretOffset = (targetX - x1);

    // 先読み分だけ飛ばして "同時に" 到達するように travelMs を共通化
    const travelMs = (beatMs * spawnAheadBeats) / flowSpeed;

    const token = {
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
    tokens.push(token);
    ev.tokens.push(token);
  }

  // Create one chord label that travels with this event (centered under its fingers)
  if (chordStreamEl) {
    const activeXs = ev.tokens.map(t => t.targetX);
    const avgX = activeXs.length ? activeXs.reduce((a,b)=>a+b,0) / activeXs.length : HIT_X;
    const tag = document.createElement("div");
    tag.className = "chordTag";
    tag.textContent = chordName;
    chordStreamEl.appendChild(tag);
    const startX = laneW + 80;
    tag.style.left = startX + "px";
    chordTokens.push({ el: tag, startAt: now, startX, targetX: avgX, travelMs, done: false });
  }
}

function judge(deltaMs) {
  const ad = Math.abs(deltaMs);
  if (ad <= hitWindowMs * 0.45) return "PERFECT";
  if (ad <= hitWindowMs * 0.85) return "GREAT";
  if (ad <= hitWindowMs) return "OK";
  return "MISS";
}

function award(result) {
  if (result === "PERFECT") {
    score += 300;
    combo += 1;
    showFloat("PERFECT✨");
  } else if (result === "GREAT") {
    score += 200;
    combo += 1;
    showFloat("GREAT!");
  } else if (result === "OK") {
    score += 120;
    combo += 1;
    showFloat("OK");
  } else {
    combo = 0;
    showFloat("MISS…");
  }
  setHUD();
}

// STRUM（弾く）判定：最も近い未ヒットのコードイベントを判定（コード単位）
function strum() {
  flash(pads);

  if (!running || paused) {
    showFloat("STRUM");
    return;
  }

  const nowMs = songPosMs;

  let best = null;
  let bestAbs = Infinity;

  for (const ev of chordEvents) {
    if (ev.hit) continue;
    const delta = nowMs - ev.targetTimeMs;
    const ad = Math.abs(delta);
    if (ad < bestAbs) {
      bestAbs = ad;
      best = { ev, delta };
    }
  }

  if (!best) {
    award("MISS");
    return;
  }

  const res = judge(best.delta);
  if (res === "MISS") {
    award("MISS");
    return;
  }

  best.ev.hit = true;
  for (const t of best.ev.tokens) {
    t.hit = true;
    if (t.el) {
      t.el.classList.remove("ready");
      t.el.classList.add("hit");
      setTimeout(() => t.el.remove(), 140);
    }
  }

  award(res);
  setNextChordLabel();
}

function tick(ts) {
  if (!running) return;
  if (paused) {
    stopLoop();
    return;
  }

  if (!lastTs) lastTs = ts;
  const dt = ts - lastTs;
  lastTs = ts;
  songPosMs += dt;

  // 先読み生成：コード単位で生成、beats分だけ間隔を空ける
  const currentBeat = songPosMs / beatMs;

  while (nextSpawnBeat <= currentBeat + spawnAheadBeats) {
    const step = scoreData[stepIdx % scoreData.length];
    const chord = step?.chord;
    const beats = clamp(parseFloat(step?.beats ?? 2), 0.5, 16);

    spawnChordEvent(chord, nextSpawnBeat + spawnAheadBeats);

    stepIdx++;
    nextSpawnBeat += beats; // ★ここが「Cの後に間隔をあけてAm…」の正体
    setNextChordLabel();
  }

  // トークン移動（右→左） + 判定ライン付近で発光
  nowReady = false;

  for (let i = tokens.length - 1; i >= 0; i--) {
    const t = tokens[i];
    if (!t.el) {
      tokens.splice(i, 1);
      continue;
    }

    const timeToTarget = t.targetTimeMs - songPosMs;
    const p = 1 - timeToTarget / t.travelMs; // 0→1
    const xBase = t.startX + p * (t.targetX - t.startX);
    // ★同時に出現（startX共通）しつつ、出現直後からフレット差を見せる
    //    p=0(出現直後)で最大、p→1(判定付近)で0に収束
    const x = xBase + (1 - p) * (t.fretOffset || 0);

    t.el.style.transform = `translateX(${x}px) translateY(-50%)`;

    // ★判定ラインに来たら光る（今弾いて！）
    const near = Math.abs(x - HIT_X) <= 10;
    if (!t.hit && near) {
      nowReady = true;
      if (!t.ready) {
        t.ready = true;
        t.el.classList.add("ready");
      }
    } else {
      if (t.ready) {
        t.ready = false;
        t.el.classList.remove("ready");
      }
    }

    // 左抜けで消す（表示上のmiss）
    if (!t.hit && x < HIT_X - 120) {
      t.hit = true;
      t.el.classList.remove("ready");
      t.el.classList.add("miss");
      setTimeout(() => t.el.remove(), 160);
    }

    if (t.hit && x < HIT_X - 170) {
      tokens.splice(i, 1);
    }
  }


  // chord label stream (moves with the same timing as notes)
  for (const c of chordTokens) {
    const t = (now - c.startAt) / c.travelMs;
    const x = c.startX + (c.targetX - c.startX) * Math.min(1, Math.max(0, t));
    c.el.style.left = x + "px";
    if (x < HIT_X - 180) c.done = true;
  }
  chordTokens = chordTokens.filter((c) => {
    if (c.done) {
      c.el.remove();
      return false;
    }
    return true;
  });

  // 判定ライン自体も「今弾いて」状態で発光
  if (laneGrid) laneGrid.classList.toggle("nowReady", nowReady);

  rafId = requestAnimationFrame(tick);
}

// ---- controls ----
bindTap(btnStart, startGame);
bindTap(btnPause, togglePause);
bindTap(btnReset, resetGame);

// ---- settings ----
[bpmInput, speedRange, windowInput, customProg, courseSel].forEach((el) => {
  if (!el) return;
  el.addEventListener("change", () => {
    bpm = clamp(parseInt(bpmInput?.value || "90", 10), 60, 200);
    beatMs = 60000 / bpm;
    flowSpeed = clamp(parseFloat(speedRange?.value || "1.0"), 0.7, 1.8);
    hitWindowMs = clamp(parseInt(windowInput?.value || "140", 10), 60, 280);
    bpmEl.textContent = String(bpm);

    // コース変更は停止中に即反映
    if (!running) {
      scoreData = resolveScore();
      stepIdx = 0;
      nextSpawnBeat = 0;
      setNextChordLabel();
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

window.__UKEFLOW = { start: startGame, pause: togglePause, reset: resetGame, chords: CHORDS };
