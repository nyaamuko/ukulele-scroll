// Ukeflow - v7 (指記号を弦レーンに流す / フレット等間隔グリッド)
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

const FINGERS = { I:"人", M:"中", R:"薬", P:"小" };

// frets: [A,E,C,G]
const CHORDS = {
  "F":  { frets:[0,1,0,2], fingers:[null,"I",null,"M"] },
  "C":  { frets:[3,0,0,0], fingers:["R",null,null,null] },
  "Am": { frets:[0,0,0,2], fingers:[null,null,null,"M"] },
  "G":  { frets:[2,3,2,0], fingers:["I","R","M",null] },
  "Dm": { frets:[0,1,2,2], fingers:[null,"I","M","R"] },
  "Em": { frets:[2,3,4,0], fingers:["I","M","R",null] },
};

const COURSES = {
  gc: ["F","C","F","C"],
  gcea: ["Am","G","F","C"],
  c_am_f_g: ["C","Am","F","G"],
};

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

function flash(el){
  if (!el) return;
  el.classList.add("tapFlash");
  setTimeout(() => el.classList.remove("tapFlash"), 120);
}

function clamp(n, a, b){ return Math.max(a, Math.min(b, n)); }

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

const HIT_X = 26;
const FRET_COUNT = 7;
const RIGHT_PADDING = 24;

let prog = ["F","C","F","C"];
let progIdx = 0;

let spawnAheadBeats = 3.0;
let spawnEveryBeats = 1.0;
let nextSpawnBeat = 0;

let chordEvents = []; // {id, chord, targetTimeMs, hit, tokens:[]}
let nextEventId = 1;
let tokens = []; // {el,laneIndex,startX,targetX,targetTimeMs,travelMs,hit}

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
    lane.className = "lane lane--strip fretGrid";
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

    bindTap(lane, () => strum());

    laneGrid.appendChild(lane);
  });
}

function buildPads(){
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

function setNextChordLabel(){
  const el = $("nextChord");
  if (!el) return;
  const chord = prog[progIdx % prog.length] || "-";
  el.textContent = chord;
}

function resolveProgression(){
  if (!courseSel) return ["F","C","F","C"];
  const v = courseSel.value;
  if (v === "custom"){
    const arr = (customProg?.value || "")
      .split(",").map(s => s.trim()).filter(Boolean);
    return arr.length ? arr : ["F","C","F","C"];
  }
  return COURSES[v] || ["F","C","F","C"];
}

function fretToX(laneEl, fret){
  const w = laneEl.getBoundingClientRect().width;
  const usable = Math.max(80, w - HIT_X - RIGHT_PADDING);
  const step = usable / (FRET_COUNT + 1);
  const x1 = HIT_X + step;
  return x1 + (fret - 1) * step;
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
  hitWindowMs = clamp(parseInt(windowInput?.value || "140", 10), 60, 280);

  prog = resolveProgression();
  progIdx = 0;

  tokens.forEach(t => t.el?.remove());
  tokens = [];
  chordEvents = [];
  nextEventId = 1;

  songPosMs = 0;
  nextSpawnBeat = 0;

  if (btnPause){
    btnPause.disabled = true;
    btnPause.textContent = "⏸ PAUSE";
  }
  if (btnStart) btnStart.disabled = false;

  setHUD();
  setNextChordLabel();
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

function stopLoop(){
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;
  lastTs = 0;
}

function startLoop(){
  if (rafId) cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(tick);
}

function spawnChordEvent(chord, beatAt){
  const def = CHORDS[chord];
  if (!def) return;

  const targetTimeMs = beatAt * beatMs;
  const ev = { id: nextEventId++, chord, targetTimeMs, hit:false, tokens: [] };
  chordEvents.push(ev);

  for (let laneIndex = 0; laneIndex < 4; laneIndex++){
    const fret = def.frets[laneIndex];
    const finger = def.fingers[laneIndex];
    if (!fret || fret <= 0) continue;

    const laneEl = laneGrid?.children?.[laneIndex];
    if (!laneEl) continue;

    const el = document.createElement("div");
    el.className = "fingerToken";
    el.innerHTML = `<div class="finger">${FINGERS[finger] || "?"}</div><div class="fret">${fret}</div>`;
    laneEl.appendChild(el);

    const laneW = laneEl.getBoundingClientRect().width;
    const startX = laneW + 80;
    const targetX = fretToX(laneEl, fret);

    const travelMs = (beatMs * spawnAheadBeats) / flowSpeed;

    const token = { el, laneIndex, startX, targetX, targetTimeMs, travelMs, hit:false, chord };
    tokens.push(token);
    ev.tokens.push(token);
  }
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

function strum(){
  flash(pads);
  if (!running || paused) { showFloat("STRUM"); return; }

  const nowMs = songPosMs;

  let best = null;
  let bestAbs = Infinity;
  for (const ev of chordEvents){
    if (ev.hit) continue;
    const delta = nowMs - ev.targetTimeMs;
    const ad = Math.abs(delta);
    if (ad < bestAbs){
      bestAbs = ad;
      best = { ev, delta };
    }
  }

  if (!best){ award("MISS"); return; }
  const res = judge(best.delta);
  if (res === "MISS"){ award("MISS"); return; }

  best.ev.hit = true;
  for (const t of best.ev.tokens){
    t.hit = true;
    if (t.el){
      t.el.style.opacity = "0.25";
      setTimeout(() => t.el.remove(), 120);
    }
  }
  award(res);
  setNextChordLabel();
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
    spawnChordEvent(chord, nextSpawnBeat + spawnAheadBeats);
    progIdx++;
    nextSpawnBeat += spawnEveryBeats;
    setNextChordLabel();
  }

  for (let i = tokens.length - 1; i >= 0; i--){
    const t = tokens[i];
    if (!t.el){ tokens.splice(i,1); continue; }

    const timeToTarget = t.targetTimeMs - songPosMs;
    const p = 1 - (timeToTarget / t.travelMs);
    const x = t.startX + p * (t.targetX - t.startX);

    t.el.style.transform = `translateX(${x}px) translateY(-50%)`;

    if (!t.hit && x < (HIT_X - 110)){
      t.hit = true;
      t.el.style.opacity = "0.15";
      setTimeout(() => t.el.remove(), 140);
    }

    if (t.hit && x < (HIT_X - 150)){
      tokens.splice(i,1);
    }
  }

  rafId = requestAnimationFrame(tick);
}

bindTap(btnStart, startGame);
bindTap(btnPause, togglePause);
bindTap(btnReset, resetGame);

[bpmInput, speedRange, windowInput, customProg].forEach(el => {
  if (!el) return;
  el.addEventListener("change", () => {
    bpm = clamp(parseInt(bpmInput?.value || "90", 10), 60, 200);
    beatMs = 60000 / bpm;
    flowSpeed = clamp(parseFloat(speedRange?.value || "1.0"), 0.7, 1.8);
    hitWindowMs = clamp(parseInt(windowInput?.value || "140", 10), 60, 280);
    bpmEl.textContent = String(bpm);
    if (running) showFloat("SET!");
  });
});

let lastTouch = 0;
document.addEventListener("touchend", (e) => {
  const now = Date.now();
  if (now - lastTouch <= 300) e.preventDefault();
  lastTouch = now;
}, { passive: false });

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

window.__UKEFLOW = { start: startGame, pause: togglePause, reset: resetGame, chords: CHORDS };
