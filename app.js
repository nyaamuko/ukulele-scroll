// Ukeflow DDR Chords (iPhone vertical practice UI)
const $ = (id) => document.getElementById(id);

const laneGrid = $("laneGrid");
const pads = $("pads");
const floating = $("floating");

const scoreEl = $("score");
const comboEl = $("combo");
const bpmEl = $("bpm");

const btnStart = $("btnStart");
const btnPause = $("btnPause");
const btnReset = $("btnReset");

const courseSel = $("course");
const speedRange = $("speed");
const bpmInput = $("bpmInput");
const windowInput = $("windowInput");
const customProg = $("customProg");

const LANES = [
  { key: "G", colorClass: "note--g", hint: "4弦(G)" },
  { key: "C", colorClass: "note--c", hint: "3弦(C)" },
  { key: "E", colorClass: "note--e", hint: "2弦(E)" },
  { key: "A", colorClass: "note--a", hint: "1弦(A)" },
];

function bindTap(el, handler, opts={}){
  // iOS/PC互換：pointer/touch/clickを全部拾う
  const h = (e) => {
    try{
      if (opts.preventDefault) e.preventDefault();
    }catch(_){}
    handler(e);
  };
  el.addEventListener("pointerdown", h);
  el.addEventListener("touchstart", h, { passive: !opts.preventDefault });
  el.addEventListener("click", h);
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

let notes = []; // {id, chord, laneIndex, y, targetTimeMs, travelMs, hit, el}
let nextId = 1;
let songPosMs = 0;

let bpm = 90;
let fallSpeed = 1.0;
let hitWindowMs = 130;
let beatMs = 60000 / bpm;

let prog = ["G","C","E","A"];
let progIdx = 0;
let spawnAheadBeats = 3.0;
let spawnEveryBeats = 1.0;
let nextSpawnBeat = 0;

function clamp(n, a, b){ return Math.max(a, Math.min(b, n)); }

function setHUD(){
  scoreEl.textContent = String(score);
  comboEl.textContent = String(combo);
  bpmEl.textContent = String(bpm);
}

function showFloat(text){
  // Safari互換：Web Animations未対応でも落ちないようにする
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
  }catch(e){
    // ignore
  }

  // Fallback: simple fade via style + timeout
  floating.style.opacity = "1";
  floating.style.transform = "translateY(0)";
  clearTimeout(showFloat._t);
  showFloat._t = setTimeout(() => {
    floating.style.opacity = "0";
    floating.style.transform = "translateY(-8px)";
  }, 700);
}

function buildLanes(){
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
      onHitLane(i);
    });

    laneGrid.appendChild(lane);
  });
}

function buildPads(){
  pads.innerHTML = "";
  LANES.forEach((l, i) => {
    const p = document.createElement("div");
    p.className = `pad pad--${i}`;
    p.textContent = l.key;
        bindTap(p, () => onHitLane(i));
      onHitLane(i);
    });
    pads.appendChild(p);
  });
}

function resolveProgression(){
  const v = courseSel.value;
  if (v === "custom"){
    const arr = customProg.value.split(",").map(s => s.trim()).filter(Boolean);
    return arr.length ? arr : ["G","C","E","A"];
  }
  return COURSES[v] || ["G","C","E","A"];
}

function chordToLaneIndex(chord){
  const root = chord.replace(/[^A-G#]/g, "");
  const base = (root.startsWith("G")) ? "G"
            : (root.startsWith("C")) ? "C"
            : (root.startsWith("E")) ? "E"
            : (root.startsWith("A")) ? "A"
            : null;
  if (!base) return 3;
  return LANES.findIndex(l => l.key === base);
}

function resetGame(){
  stopLoop();
  running = false;
  paused = false;

  score = 0;
  combo = 0;

  bpm = clamp(parseInt(bpmInput.value || "90", 10), 60, 200);
  beatMs = 60000 / bpm;
  fallSpeed = clamp(parseFloat(speedRange.value || "1.0"), 0.7, 1.8);
  hitWindowMs = clamp(parseInt(windowInput.value || "130", 10), 60, 260);

  prog = resolveProgression();
  progIdx = 0;

  notes.forEach(n => n.el?.remove());
  notes = [];
  nextId = 1;

  songPosMs = 0;
  nextSpawnBeat = 0;

  btnPause.disabled = true;
  btnPause.textContent = "⏸ PAUSE";
  btnStart.disabled = false;

  setHUD();
  showFloat("READY!");
}

function startGame(){
  if (running) return;
  resetGame();
  running = true;
  paused = false;

  btnPause.disabled = false;
  btnStart.disabled = true;

  showFloat("START!");
  startLoop();
}

function togglePause(){
  if (!running) return;
  paused = !paused;
  btnPause.textContent = paused ? "▶ RESUME" : "⏸ PAUSE";
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

function spawnNote(chord, beatAt){
  const laneIndex = chordToLaneIndex(chord);
  const laneEl = laneGrid.children[laneIndex];
  if (!laneEl) return;

  const el = document.createElement("div");
  const laneClass = (LANES[laneIndex].key === "G") ? "note--g"
                 : (LANES[laneIndex].key === "C") ? "note--c"
                 : (LANES[laneIndex].key === "E") ? "note--e"
                 : (LANES[laneIndex].key === "A") ? "note--a"
                 : "note--other";
  el.className = `note ${laneClass}`;
  el.dataset.id = String(nextId);
  el.innerHTML = `<div>${chord}</div><div class="noteSmall">tap</div>`;
  laneEl.appendChild(el);

  const travelMs = beatMs * spawnAheadBeats / fallSpeed;

  const note = {
    id: nextId++,
    chord,
    laneIndex,
    y: -70,
    el,
    targetTimeMs: beatAt * beatMs,
    travelMs,
    hit:false,
  };
  notes.push(note);
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


// FIX v3: visual tap feedback
function flash(el){
  if (!el) return;
  el.classList.add("tapFlash");
  setTimeout(() => el.classList.remove("tapFlash"), 120);
}
function onHitLane(laneIndex){
  const laneEl = laneGrid && laneGrid.children ? laneGrid.children[laneIndex] : null;
  const padEl  = pads && pads.children ? pads.children[laneIndex] : null;
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

  for (let i=notes.length-1; i>=0; i--){
    const n = notes[i];
    if (!n.el){ notes.splice(i,1); continue; }

    const laneEl = laneGrid.children[n.laneIndex];
    const laneH = laneEl.getBoundingClientRect().height;
    const hitY = laneH - 90;

    const timeToTarget = n.targetTimeMs - songPosMs;
    const p = 1 - (timeToTarget / n.travelMs);
    const y = (-70) + p * (hitY + 70);
    n.y = y;

    n.el.style.transform = `translateY(${y}px)`;

    if (!n.hit && y > hitY + 46){
      n.hit = true;
      n.el.style.opacity = "0.15";
      setTimeout(() => n.el.remove(), 120);
      combo = 0;
      setHUD();
    }

    if (n.hit && y > hitY + 80){
      notes.splice(i,1);
    }
  }

  rafId = requestAnimationFrame(tick);
}

bindTap(btnStart, startGame);
bindTap(btnPause, togglePause);
bindTap(btnReset, resetGame);

[bpmInput, speedRange, windowInput, customProg].forEach(el => {
  el.addEventListener("change", () => {
    bpm = clamp(parseInt(bpmInput.value || "90", 10), 60, 200);
    beatMs = 60000 / bpm;
    fallSpeed = clamp(parseFloat(speedRange.value || "1.0"), 0.7, 1.8);
    hitWindowMs = clamp(parseInt(windowInput.value || "130", 10), 60, 260);
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

buildLanes();
buildPads();
resetGame();


window.addEventListener("error", (e) => {
  try{
    floating.textContent = "JSエラー: " + (e.message || "unknown");
    floating.style.opacity = "1";
  }catch(_){}
});


const runEl = document.getElementById("run");
function setRun(on){
  if (!runEl) return;
  runEl.textContent = on ? "ON" : "OFF";
}
window.__UKEFLOW = {
  start: () => { try{ startGame(); }catch(e){ showFloat("START ERR"); console.error(e);} },
  pause: () => { try{ togglePause(); }catch(e){ showFloat("PAUSE ERR"); console.error(e);} },
  reset: () => { try{ resetGame(); }catch(e){ showFloat("RESET ERR"); console.error(e);} },
};

// override set in reset/start
const _resetGame = resetGame;
resetGame = function(){
  _resetGame();
  setRun(false);
};
const _startGame = startGame;
startGame = function(){
  _startGame();
  setRun(true);
};
const _togglePause = togglePause;
togglePause = function(){
  _togglePause();
  setRun(running && !paused);
};

let _tickCounter = 0;
const _tick = tick;
tick = function(ts){
  _tick(ts);
  // prove animation loop is running (update once per ~20 frames)
  _tickCounter++;
  if (runEl && (_tickCounter % 20 === 0)){
    runEl.textContent = (running && !paused) ? ("ON " + Math.floor(songPosMs/1000)) : "OFF";
  }
};


function hardWireButtons(){
  const s = document.getElementById("btnStart");
  const p = document.getElementById("btnPause");
  const r = document.getElementById("btnReset");
  if (s){
    s.addEventListener("touchstart", () => window.__UKEFLOW && window.__UKEFLOW.start(), { passive: true });
    s.addEventListener("click", () => window.__UKEFLOW && window.__UKEFLOW.start());
  }
  if (p){
    p.addEventListener("touchstart", () => window.__UKEFLOW && window.__UKEFLOW.pause(), { passive: true });
    p.addEventListener("click", () => window.__UKEFLOW && window.__UKEFLOW.pause());
  }
  if (r){
    r.addEventListener("touchstart", () => window.__UKEFLOW && window.__UKEFLOW.reset(), { passive: true });
    r.addEventListener("click", () => window.__UKEFLOW && window.__UKEFLOW.reset());
  }
}
hardWireButtons();

let __hb = null;
function startHeartbeat(){
  const runEl = document.getElementById("run");
  if (__hb) clearInterval(__hb);
  __hb = setInterval(() => {
    if (!runEl) return;
    if (running && !paused) runEl.textContent = "ON " + Math.floor(songPosMs/1000);
  }, 500);
}
startHeartbeat();
