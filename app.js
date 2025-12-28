// FIXED minimal version for iPhone/Web
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

const LANES = [
  { key: "G", hint: "4弦(G)" },
  { key: "C", hint: "3弦(C)" },
  { key: "E", hint: "2弦(E)" },
  { key: "A", hint: "1弦(A)" },
];

function bindTap(el, handler){
  if (!el) return;
  el.addEventListener("pointerdown", handler);
  el.addEventListener("touchstart", handler, { passive: true });
  el.addEventListener("click", handler);
}

let running = false;
let paused = false;
let score = 0;
let combo = 0;
let bpm = 90;

function setHUD(){
  scoreEl.textContent = score;
  comboEl.textContent = combo;
  bpmEl.textContent = bpm;
  runEl.textContent = running && !paused ? "ON" : "OFF";
}

function buildLanes(){
  laneGrid.innerHTML = "";
  LANES.forEach((l, i) => {
    const lane = document.createElement("div");
    lane.className = "lane";
    lane.innerHTML = `<div>${l.key}<br><small>${l.hint}</small></div>`;
    bindTap(lane, () => onHitLane(i));
    laneGrid.appendChild(lane);
  });
}

function buildPads(){
  pads.innerHTML = "";
  LANES.forEach((l, i) => {
    const p = document.createElement("div");
    p.className = "pad";
    p.textContent = l.key;
    bindTap(p, () => onHitLane(i));
    pads.appendChild(p);
  });
}

function onHitLane(i){
  if (!running || paused) return;
  combo++;
  score += 100;
  floating.textContent = `HIT ${LANES[i].key}`;
  setHUD();
}

function startGame(){
  running = true;
  paused = false;
  score = 0;
  combo = 0;
  btnPause.disabled = false;
  setHUD();
}

function togglePause(){
  if (!running) return;
  paused = !paused;
  setHUD();
}

function resetGame(){
  running = false;
  paused = false;
  score = 0;
  combo = 0;
  btnPause.disabled = true;
  setHUD();
}

bindTap(btnStart, startGame);
bindTap(btnPause, togglePause);
bindTap(btnReset, resetGame);

buildLanes();
buildPads();
setHUD();
