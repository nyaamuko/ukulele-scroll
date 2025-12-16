// app.js
// STAGE2 静的モック（iPhone縦 / アメコミ風）
// - 背景巨大コード文字（ふわふわ）
// - フレットボード表示（●=押さえる、○=開放）
// - 演出デモ（OK!! / MISS!）
// ※ 実際の判定・音検出は次ステップで実装

let state = {
  items: [],
  idx: 0,
  phaseIdx: 0,
  overlayStrong: false,
  wobble: true,
};

const bgCode = document.getElementById("bgCode");
const codeLabel = document.getElementById("codeLabel");
const fretboard = document.getElementById("fretboard");
const timerValue = document.getElementById("timerValue");
const debug = document.getElementById("debug");

const prevBtn = document.getElementById("prevBtn");
const nextBtn = document.getElementById("nextBtn");
const phaseBtn = document.getElementById("phaseBtn");
const toggleOverlayBtn = document.getElementById("toggleOverlayBtn");
const toggleWobbleBtn = document.getElementById("toggleWobbleBtn");
const demoOkBtn = document.getElementById("demoOkBtn");
const demoNgBtn = document.getElementById("demoNgBtn");

const phaseTitle = document.getElementById("phaseTitle");
const phaseText = document.getElementById("phaseText");

const burst = document.getElementById("burst");
const burstText = document.getElementById("burstText");

// phases (文字が速すぎないよう固定時間)
const PHASES = [
  { title: "READY!", text: "このコードを構えてね", seconds: 1.6 },
  { title: "SET!",   text: "指を置いたら深呼吸",   seconds: 1.2 },
  { title: "PLAY!",  text: "時間内に鳴らして！",   seconds: 4.0 }
];

// utilities
function safeText(s){ return (s ?? "").toString(); }

function setDebug(msg){
  debug.textContent = msg;
}

function renderPhase(){
  const ph = PHASES[state.phaseIdx];
  phaseTitle.textContent = ph.title;
  phaseText.textContent = ph.text;
  timerValue.textContent = ph.seconds.toFixed(1);
}

function applyOverlayOpacity(){
  const wrap = document.querySelector(".fretboardWrap");
  wrap.classList.toggle("strong", state.overlayStrong);
  wrap.classList.toggle("soft", !state.overlayStrong);
  toggleOverlayBtn.textContent = state.overlayStrong ? "表示：濃い" : "表示：うっすら";
}

function applyWobble(){
  bgCode.classList.toggle("wobble", state.wobble);
  toggleWobbleBtn.textContent = state.wobble ? "背景：ふわふわ ON" : "背景：ふわふわ OFF";
}

function buildFretNums(maxFret){
  // remove existing
  const old = fretboard.querySelector(".fretNums");
  if (old) old.remove();

  const nums = document.createElement("div");
  nums.className = "fretNums";
  for (let f=1; f<=maxFret; f++){
    const d = document.createElement("div");
    d.className = "fretNum";
    d.textContent = `F${f}`;
    nums.appendChild(d);
  }
  fretboard.appendChild(nums);
}

// Create a lane cell for each string x fret column
function laneCell(kind, text){
  const cell = document.createElement("div");

  if (kind === "tag"){
    cell.className = "stringTag";
    cell.innerHTML = text;
    return cell;
  }

  // kind === "lane"
  cell.className = "lane";
  return cell;
}

function marker(type, label){
  const m = document.createElement("div");
  m.className = "marker";
  if (type === "open") {
    m.classList.add("open");
    m.textContent = "○";
  } else if (type === "on") {
    m.classList.add("on");
    m.textContent = label ? label : "●";
  }
  return m;
}

/**
 * item.fingering:
 *  - strings: ["G","C","E","A"] fixed order (4->1)
 *  - frets: [0..max] where 0=open, 1..max fret
 *  - fingers: ["", "1","2","3"] optional label
 */
function renderFretboard(item){
  const maxFret = item.maxFret ?? 5;

  // reset grid template based on maxFret
  fretboard.style.gridTemplateColumns = `46px repeat(${maxFret}, 1fr)`;
  fretboard.innerHTML = "";

  buildFretNums(maxFret);

  const strings = item.strings; // array length 4: {name, note}
  const frets = item.frets;     // array length 4: 0..max
  const fingers = item.fingers || ["","","",""];

  // 4 rows (G,C,E,A)
  for (let r=0; r<4; r++){
    const s = strings[r];
    const tagHtml = `${safeText(s.name)}<small>${safeText(s.note)}</small>`;
    fretboard.appendChild(laneCell("tag", tagHtml));

    for (let f=1; f<=maxFret; f++){
      const lane = laneCell("lane", "");
      const fretNum = frets[r] ?? 0;

      // open marker is shown on fret 1 column (as a convention for mock)
      if (fretNum === 0 && f === 1){
        lane.appendChild(marker("open", ""));
      }

      if (fretNum === f){
        lane.appendChild(marker("on", fingers[r] || "●"));
      }

      fretboard.appendChild(lane);
    }
  }
}

function render(){
  if (!state.items.length){
    bgCode.textContent = "--";
    codeLabel.textContent = "--";
    setDebug("ERROR: notes.json が読み込めません");
    return;
  }

  const item = state.items[state.idx];
  bgCode.textContent = item.code;
  codeLabel.textContent = item.code;

  renderFretboard(item);
  renderPhase();
  applyOverlayOpacity();
  applyWobble();

  setDebug(`OK: notes.json 読込 / CODE=${item.code} / idx=${state.idx+1}/${state.items.length}`);
}

// Burst demo
function showBurst(text, isMiss=false){
  burstText.textContent = text;
  burst.hidden = false;
  burst.classList.toggle("miss", !!isMiss);

  // hide after
  window.clearTimeout(showBurst._t);
  showBurst._t = window.setTimeout(() => {
    burst.hidden = true;
  }, 900);
}

// Events
prevBtn.addEventListener("click", () => {
  state.idx = (state.idx - 1 + state.items.length) % state.items.length;
  render();
});
nextBtn.addEventListener("click", () => {
  state.idx = (state.idx + 1) % state.items.length;
  render();
});
phaseBtn.addEventListener("click", () => {
  state.phaseIdx = (state.phaseIdx + 1) % PHASES.length;
  renderPhase();
});
toggleOverlayBtn.addEventListener("click", () => {
  state.overlayStrong = !state.overlayStrong;
  applyOverlayOpacity();
});
toggleWobbleBtn.addEventListener("click", () => {
  state.wobble = !state.wobble;
  applyWobble();
});
demoOkBtn.addEventListener("click", () => showBurst("OK!!", false));
demoNgBtn.addEventListener("click", () => showBurst("MISS!", true));

// Load chord set from notes.json
async function init(){
  try{
    setDebug("loading notes.json…");
    const res = await fetch("./notes.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`fetch notes.json failed: ${res.status}`);
    const data = await res.json();
    state.items = data.stage2_chords || [];
    state.idx = 0;
    render();
  }catch(e){
    console.error(e);
    setDebug("ERROR: notes.json 読込失敗（https/localhost で開いているか確認）");
  }
}

init();
