// Ukeflow DDR Chords - FIX v5 (Right→Left flow over 4 lanes)
// 変更点：ノーツが「上→下」ではなく「右→左」に流れるように変更
//        レイアウト（4レーンの見た目）は崩さず、ノーツの移動軸だけ変更。

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

const LANES = [
  { key: "G", hint: "4弦(G)" },
  { key: "C", hint: "3弦(C)" },
  { key: "E", hint: "2弦(E)" },
  { key: "A", hint: "1弦(A)" },
];

// 二重発火ガード（touchstart→clickを1回にする）
function bindTap(el, handler, opts = {}) {
  if (!el) return;
  let last = 0;
  const wrapped = (e) => {
    const now = Date.now();
    if (now - last < 450) return;
    last = now;
    try { if (opts.preventDefault) e.preventDefault(); } catch (_) {}
    handler(e);
  };
  el.addEventListener("pointerdown", wrapped);
  el.addEventListener("touchstart", wrapped, { passive: !opts.preventDefault });
  el.addEventListener("click", wrapped);
}

// タップの視覚フィードバック（「押した感」）
function flash(el){
  if (!el) return;
  el.classList.add("tapFlash");
  setTimeout(() => el.classList.remove("tapFlash"), 120);
}

const COURSES = {
  gc: ["G","C"],
  gcea: ["G","C","E","A"],
  c_am_f_g: ["C","Am","F","G"],
};

let running = false;
let paused = false;
let score = 0;
let combo = 0;

let rafId = null;
let lastTs = 0;

let notes = []; // {id, chord, laneIndex, x, targetTimeMs, travelMs, hit, el}
let nextId = 1;
let songPosMs = 0;

let bpm = 90;
let flowSpeed = 1.0;           // 既存の「スピード」スライダを横移動にも使用
let hitWindowMs = 130;
let beatMs = 60000 / bpm;

let prog = ["G","C","E","A"];
let progIdx = 0;

let spawnAheadBeats = 3.0;     // 先読み（時間）
let spawnEveryBeats = 1.0;     // 生成間隔
let nextSpawnBeat = 0;

// 右→左：ノーツをレーン内の上部に固定して流す
const NOTE_Y = 46;             // lane内の上位置（見た目を崩さない範囲で固定）
const HIT_X = 26;              // lane内の「当たり位置」（左端寄り）

function clamp(n, a, b){ return Math.max(a, Math.min(b, n)); }

function setRun(on){ if (runEl) runEl.textContent = on ? "ON" : "OFF"; }

function setHUD(){
  scoreEl.textContent = String(score);
  comboEl.textContent = String(combo);
  bpmEl.textContent = String(bpm);
  setRun(running && !paused);
}

function showFloat(text){
  if (!floating) return;
  floating.textContent = text;
  try{
    if (typeof floating.animate === "function"){
      floating.animate([
        { opacity: 0, transform: "translateY(-10px)" },
        { opacity: 1, transform: "translateY(0)" },
        { opacity: 0, transform: "translateY(-10px)" },
      ], { duration: 900, easing: "ease-out" });
      return;
    }
  }catch(e){}
  floating.style.opacity = "1";
  floating.style.transform = "translateY(0)";
  clearTimeout(showFloat._t);
  showFloat._t = setTimeout(() => {
    floating.style.opacity = "0";
    floating.style.transform = "translateY(-8px)";
  }, 700);
}

function buildLanes(){
  if (!laneGrid) return;
  laneGrid.innerHTML = "";
  LANES.forEach((l, i) => {
    const lane = document.createElement("div");
    lane.className = "lane";
    lane.dataset.index = String(i);

    const header = document.createElement("div");
    header.className = "laneHeader";

    const label = document.createElement("div");
    label.className = "laneLabel";
    label.textContent = l.key;

    const hint = document.createElement("div");
    hint.className = "laneHint";
    hint.textContent = l.hint;

    header.appendChild(label);
    header.appendChild(hint);
    lane.appendChild(header);

    bindTap(lane, () => onHitLane(i));

    laneGrid.appendChild(lane);
  });
}

function buildPads(){
  if (!pads) return;
  pads.innerHTML = "";
  LANES.forEach((l, i) => {
    const p = document.createElement("div");
    p.className = `pad pad--${i}`;
    p.textContent = l.key;
    bindTap(p, () => onHitLane(i));
    pads.appendChild(p);
  });
}

function resolveProgression(){
  if (!courseSel) return ["G","C","E","A"];
  const v = courseSel.value;
  if (v === "custom"){
    const arr = (customProg?.value || "")
      .split(",").map(s => s.trim()).filter(Boolean);
    return arr.length ? arr : ["G","C","E","A"];
  }
  return COURSES[v] || ["G","C","E","A"];
}

function chordToLaneIndex(chord){
  const root = (chord || "").replace(/[^A-G#]/g, "");
  const base = root.startsWith("G") ? "G"
            : root.startsWith("C") ? "C"
            : root.startsWith("E") ? "E"
            : root.startsWith("A") ? "A"
            : null;
  if (!base) return 3;
  return LANES.findIndex(l => l.key === base);
}

function stopLoop(){
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;
  lastTs = 0;
}

function startLoop(){
  if (rafId) cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(tick);
}

function resetGame(){
  stopLoop();
  running = false;
  paused = false;
  score = 0;
  combo = 0;

  bpm = clamp(parseInt(bpmInput?.value || "90", 10), 60, 200);
  beatMs = 60000 / bpm;
  flowSpeed = clamp(parseFloat(speedRange?.value || "1.0"), 0.7, 1.8);
  hitWindowMs = clamp(parseInt(windowInput?.value || "130", 10), 60, 260);

  prog = resolveProgression();
  progIdx = 0;

  notes.forEach(n => n.el?.remove());
  notes = [];
  nextId = 1;

  songPosMs = 0;
  nextSpawnBeat = 0;

  if (btnPause){
    btnPause.disabled = true;
    btnPause.textContent = "⏸ PAUSE";
  }
  if (btnStart) btnStart.disabled = false;

  setHUD();
  showFloat("READY!");
}

function startGame(){
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

function togglePause(){
  if (!running) return;
  paused = !paused;
  if (btnPause) btnPause.textContent = paused ? "▶ RESUME" : "⏸ PAUSE";
  setHUD();
  if (!paused){
    lastTs = performance.now();
    startLoop();
  }
}

function spawnNote(chord, beatAt){
  const laneIndex = chordToLaneIndex(chord);
  const laneEl = laneGrid?.children?.[laneIndex];
  if (!laneEl) return;

  const el = document.createElement("div");
  const laneKey = LANES[laneIndex].key;
  const laneClass = laneKey === "G" ? "note--g"
                 : laneKey === "C" ? "note--c"
                 : laneKey === "E" ? "note--e"
                 : laneKey === "A" ? "note--a"
                 : "note--other";
  el.className = `note ${laneClass}`;
  el.dataset.id = String(nextId);
  el.innerHTML = `<div>${chord}</div><div class="noteSmall">tap</div>`;

  // 右→左：lane内の上部に配置
  el.style.top = `${NOTE_Y}px`;

  laneEl.appendChild(el);

  const travelMs = (beatMs * spawnAheadBeats) / flowSpeed;

  // レーン幅に応じて右端からスタート
  const laneW = laneEl.getBoundingClientRect().width;
  const startX = laneW + 60; // 右外から
  const targetX = HIT_X;     // 左の当たり位置

  notes.push({
    id: nextId++,
    chord,
    laneIndex,
    x: startX,
    startX,
    targetX,
    el,
    targetTimeMs: beatAt * beatMs,
    travelMs,
    hit: false,
  });
}

function judge(deltaMs){
  const ad = Math.abs(deltaMs);
  if (ad <= hitWindowMs * 0.45) return "PERFECT";
  if (ad <= hitWindowMs * 0.85) return "GREAT";
  if (ad <= hitWindowMs) return "OK";
  return "MISS";
}

function award(result){
  if (result === "PERFECT"){ score += 300; combo += 1; showFloat("PERFECT✨"); }
  else if (result === "GREAT"){ score += 200; combo += 1; showFloat("GREAT!"); }
  else if (result === "OK"){ score += 120; combo += 1; showFloat("OK"); }
  else { combo = 0; showFloat("MISS…"); }
  setHUD();
}

function onHitLane(laneIndex){
  // 視覚フィードバックは「常に」出す（running前でも反応が分かる）
  const laneEl = laneGrid?.children?.[laneIndex];
  const padEl  = pads?.children?.[laneIndex];
  flash(laneEl);
  flash(padEl);

  if (!running || paused) return;

  const nowMs = songPosMs;
  let best = null;
  let bestAbs = Infinity;

  for (const n of notes){
    if (n.hit) continue;
    if (n.laneIndex !== laneIndex) continue;
    const delta = nowMs - n.targetTimeMs;
    const ad = Math.abs(delta);
    if (ad < bestAbs){
      bestAbs = ad;
      best = { n, delta };
    }
  }

  if (!best){ award("MISS"); return; }
  const res = judge(best.delta);
  if (res === "MISS"){ award("MISS"); return; }

  best.n.hit = true;
  best.n.el.style.opacity = "0.25";
  setTimeout(() => best.n.el.remove(), 80);
  award(res);
}

function tick(ts){
  if (!running) return;
  if (paused){ stopLoop(); return; }

  if (!lastTs) lastTs = ts;
  const dt = ts - lastTs;
  lastTs = ts;
  songPosMs += dt;

  const currentBeat = songPosMs / beatMs;
  while (nextSpawnBeat <= currentBeat + spawnAheadBeats){
    const chord = prog[progIdx % prog.length];
    spawnNote(chord, nextSpawnBeat + spawnAheadBeats);
    progIdx++;
    nextSpawnBeat += spawnEveryBeats;
  }

  // 右→左：時間に基づき X を補間
  for (let i = notes.length - 1; i >= 0; i--){
    const n = notes[i];
    if (!n.el){ notes.splice(i,1); continue; }

    const timeToTarget = n.targetTimeMs - songPosMs;
    const p = 1 - (timeToTarget / n.travelMs); // 0→1
    const x = n.startX + p * (n.targetX - n.startX);
    n.x = x;

    n.el.style.transform = `translateX(${x}px)`;

    // 通り過ぎMISS（左外へ）
    if (!n.hit && x < (HIT_X - 90)){
      n.hit = true;
      n.el.style.opacity = "0.15";
      setTimeout(() => n.el.remove(), 120);
      combo = 0;
      setHUD();
    }

    if (n.hit && x < (HIT_X - 140)){
      notes.splice(i,1);
    }
  }

  rafId = requestAnimationFrame(tick);
}

// ---- controls ----
bindTap(btnStart, startGame);
bindTap(btnPause, togglePause);
bindTap(btnReset, resetGame);

// ---- settings ----
[bpmInput, speedRange, windowInput, customProg].forEach(el => {
  if (!el) return;
  el.addEventListener("change", () => {
    bpm = clamp(parseInt(bpmInput?.value || "90", 10), 60, 200);
    beatMs = 60000 / bpm;
    flowSpeed = clamp(parseFloat(speedRange?.value || "1.0"), 0.7, 1.8);
    hitWindowMs = clamp(parseInt(windowInput?.value || "130", 10), 60, 260);
    bpmEl.textContent = String(bpm);
    if (running) showFloat("SET!");
  });
});

// iOS double-tap zoom prevention
let lastTouch = 0;
document.addEventListener("touchend", (e) => {
  const now = Date.now();
  if (now - lastTouch <= 300) e.preventDefault();
  lastTouch = now;
}, { passive: false });

// 起動
showFloat("JS OK");
buildLanes();
buildPads();
resetGame();

window.addEventListener("error", (e) => {
  try{
    floating.textContent = "JSエラー: " + (e.message || "unknown");
    floating.style.opacity = "1";
  }catch(_){}
});

window.__UKEFLOW = { start: startGame, pause: togglePause, reset: resetGame };
