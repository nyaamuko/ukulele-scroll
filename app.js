// app.js (v2)
let state = {
  items: [],
  idx: 0,
  phaseIdx: 0,
  overlayStrong: false,
  wobbleLevel: 2, // 1..3
  toneLevel: 1,   // 1..3
};

const bgCode = document.getElementById("bgCode");
const codeLabel = document.getElementById("codeLabel");
const fretboard = document.getElementById("fretboard");
const fretboardWrap = document.getElementById("fretboardWrap");
const timerValue = document.getElementById("timerValue");
const debug = document.getElementById("debug");

const prevBtn = document.getElementById("prevBtn");
const nextBtn = document.getElementById("nextBtn");
const phaseBtn = document.getElementById("phaseBtn");
const toggleOverlayBtn = document.getElementById("toggleOverlayBtn");
const toggleWobbleBtn = document.getElementById("toggleWobbleBtn");
const bgToneBtn = document.getElementById("bgToneBtn");
const demoOkBtn = document.getElementById("demoOkBtn");
const demoNgBtn = document.getElementById("demoNgBtn");

const phaseTitle = document.getElementById("phaseTitle");
const phaseText = document.getElementById("phaseText");

const fingerDots = document.getElementById("fingerDots");

const burst = document.getElementById("burst");
const burstText = document.getElementById("burstText");

const PHASES = [
  { title: "READY!", text: "このコードを構えてね", seconds: 1.6 },
  { title: "SET!",   text: "指を置いたら深呼吸",   seconds: 1.2 },
  { title: "PLAY!",  text: "時間内に鳴らして！",   seconds: 4.0 }
];

function setDebug(msg){ debug.textContent = msg; }

function renderPhase(){
  const ph = PHASES[state.phaseIdx];
  phaseTitle.textContent = ph.title;
  phaseText.textContent = ph.text;
  timerValue.textContent = ph.seconds.toFixed(1);
}

function applyOverlayOpacity(){
  fretboardWrap.classList.toggle("strong", state.overlayStrong);
  fretboardWrap.classList.toggle("soft", !state.overlayStrong);
  toggleOverlayBtn.textContent = state.overlayStrong ? "表示：濃い" : "表示：うっすら";
}

function applyWobble(){
  bgCode.classList.remove("wobble1","wobble2","wobble3");
  bgCode.classList.add(`wobble${state.wobbleLevel}`);
  toggleWobbleBtn.textContent = state.wobbleLevel === 1 ? "背景：ふわふわ 弱"
                         : state.wobbleLevel === 2 ? "背景：ふわふわ 強"
                         : "背景：ふわふわ 激";
}

function applyTone(){
  bgCode.classList.remove("tone2","tone3");
  if (state.toneLevel === 2) bgCode.classList.add("tone2");
  if (state.toneLevel === 3) bgCode.classList.add("tone3");
  bgToneBtn.textContent = state.toneLevel === 1 ? "背景文字：濃く"
                  : state.toneLevel === 2 ? "背景文字：もっと濃く"
                  : "背景文字：標準";
}

function buildFretNums(maxFret){
  const old = fretboard.querySelector(".fretNums");
  if (old) old.remove();

  const nums = document.createElement("div");
  nums.className = "fretNums";
  nums.style.gridTemplateColumns = `repeat(${maxFret}, 1fr)`;

  for (let f=1; f<=maxFret; f++){
    const d = document.createElement("div");
    d.className = "fretNum";
    d.textContent = `F${f}`;
    nums.appendChild(d);
  }
  fretboard.appendChild(nums);
}

function laneCell(kind, html){
  const cell = document.createElement("div");
  if (kind === "tag"){
    cell.className = "stringTag";
    cell.innerHTML = html;
  } else {
    cell.className = "lane";
  }
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

function ensureFingerDots(){
  fingerDots.innerHTML = "";
  for (let i=1; i<=4; i++){
    const d = document.createElement("div");
    d.className = "fingerDot";
    d.textContent = String(i);
    d.dataset.finger = String(i);
    fingerDots.appendChild(d);
  }
}

function updateFingerDots(item){
  const used = new Set();
  (item.fingers || []).forEach(v => {
    const s = (v ?? "").toString().trim();
    if (["1","2","3","4"].includes(s)) used.add(s);
  });

  fingerDots.querySelectorAll(".fingerDot").forEach(el => {
    const f = el.dataset.finger;
    el.classList.toggle("on", used.has(f));
  });
}

function addRowLine(rowIndex){
  const line = document.createElement("div");
  line.className = "rowLine";
  const top = (rowIndex * (56 + 10)) + 28; // row center
  line.style.top = `${top}px`;
  fretboard.appendChild(line);
}

function renderFretboard(item){
  const maxFret = item.maxFret ?? 5;

  fretboard.style.gridTemplateColumns = `46px repeat(${maxFret}, 1fr)`;
  fretboard.style.gridTemplateRows = `repeat(4, 56px)`;
  fretboard.innerHTML = "";

  buildFretNums(maxFret);

  for (let r=0; r<4; r++) addRowLine(r);

  const strings = item.strings; // 1弦→4弦（上から）
  const frets = item.frets;
  const fingers = item.fingers || ["","","",""];

  for (let r=0; r<4; r++){
    const s = strings[r];
    const tagHtml = `${(s.name||"")}<small>${(s.note||"")}</small>`;
    fretboard.appendChild(laneCell("tag", tagHtml));

    for (let f=1; f<=maxFret; f++){
      const lane = laneCell("lane", "");
      const fretNum = frets[r] ?? 0;

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

function showBurst(text, isMiss=false){
  burstText.textContent = text;
  burst.hidden = false;
  burst.classList.toggle("miss", !!isMiss);
  window.clearTimeout(showBurst._t);
  showBurst._t = window.setTimeout(() => {
    burst.hidden = true;
  }, 900);
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
  updateFingerDots(item);

  renderPhase();
  applyOverlayOpacity();
  applyWobble();
  applyTone();

  setDebug(`OK: notes.json 読込 / CODE=${item.code} / idx=${state.idx+1}/${state.items.length}`);
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
  state.wobbleLevel = (state.wobbleLevel % 3) + 1;
  applyWobble();
});
bgToneBtn.addEventListener("click", () => {
  state.toneLevel = (state.toneLevel % 3) + 1;
  applyTone();
});
demoOkBtn.addEventListener("click", () => showBurst("OK!!", false));
demoNgBtn.addEventListener("click", () => showBurst("MISS!", true));

async function init(){
  ensureFingerDots();
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
