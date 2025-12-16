// app.js (v3)
// 目的：左手の指先発光を “リアルタイム” にする
// - コードが切り替わったら「使う指」を自動発光
// - フレット上のマーカー（人/中/薬/小）を “触る/ホバー/タップ” すると、その指が即発光
// - 左手の指（人/中/薬/小）をタップしても発光（練習用）
// - 発光リセットで「コードが要求する指」に戻す

let state = {
  items: [],
  idx: 0,
  phaseIdx: 0,
  overlayLevel: 1, // 0=soft,1=mid,2=strong
  wobbleLevel: 2,  // 0=off,1=mid,2=strong
  // realtime highlight
  lockFinger: null, // "人"|"中"|"薬"|"小"|null
  chordFingers: new Set(), // current chord used fingers
};

const bgCode = document.getElementById("bgCode");
const codeLabel = document.getElementById("codeLabel");
const fretboard = document.getElementById("fretboard");
const timerValue = document.getElementById("timerValue");
const debug = document.getElementById("debug");
const fretWrap = document.getElementById("fretWrap");

const prevBtn = document.getElementById("prevBtn");
const nextBtn = document.getElementById("nextBtn");
const phaseBtn = document.getElementById("phaseBtn");
const toggleOverlayBtn = document.getElementById("toggleOverlayBtn");
const toggleWobbleBtn = document.getElementById("toggleWobbleBtn");
const demoOkBtn = document.getElementById("demoOkBtn");
const demoNgBtn = document.getElementById("demoNgBtn");
const clearHoverBtn = document.getElementById("clearHoverBtn");

const phaseTitle = document.getElementById("phaseTitle");
const phaseText = document.getElementById("phaseText");

const burst = document.getElementById("burst");
const burstText = document.getElementById("burstText");

const tipEls = {
  "人": document.getElementById("tip-人"),
  "中": document.getElementById("tip-中"),
  "薬": document.getElementById("tip-薬"),
  "小": document.getElementById("tip-小"),
};

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

function applyOverlay(){
  fretWrap.classList.remove("soft","mid","strong");
  fretWrap.classList.add(["soft","mid","strong"][state.overlayLevel]);
  toggleOverlayBtn.textContent = ["濃さ：薄","濃さ：中","濃さ：濃"][state.overlayLevel];
}

function applyWobble(){
  bgCode.classList.remove("wobbleOff","wobbleMid","wobbleStrong");
  bgCode.classList.add(["wobbleOff","wobbleMid","wobbleStrong"][state.wobbleLevel]);
  toggleWobbleBtn.textContent = ["揺れ：OFF","揺れ：中","揺れ：強"][state.wobbleLevel];
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

function marker(type, label, finger){
  const m = document.createElement("div");
  m.className = "marker";
  if (type === "open") {
    m.classList.add("open");
    m.textContent = "○";
    m.dataset.finger = "";
  } else {
    m.classList.add("on");
    m.textContent = label || "●";
    m.dataset.finger = finger || "";
    m.setAttribute("role","button");
    m.setAttribute("tabindex","0");
    m.title = `指：${finger}`;
  }
  return m;
}

function setFingerGlow(activeSet){
  Object.entries(tipEls).forEach(([k, el]) => {
    if (!el) return;
    el.classList.toggle("on", activeSet.has(k));
  });
}

function getUsedFingers(arr){
  const s = new Set();
  for (const x of (arr || [])){
    if (x) s.add(x);
  }
  return s;
}

function applyCurrentGlow(){
  // lockFinger has priority
  if (state.lockFinger){
    setFingerGlow(new Set([state.lockFinger]));
  } else {
    setFingerGlow(state.chordFingers);
  }
}

function addStringLines(){
  fretboard.querySelectorAll(".stringLine").forEach(n => n.remove());

  const rowH = 56;
  const gap = 10;
  for (let r=0; r<4; r++){
    const y = r*(rowH+gap) + rowH/2;
    const line = document.createElement("div");
    line.className = "stringLine";
    line.style.top = `${y}px`;
    fretboard.appendChild(line);
  }
}

// highlight markers belonging to a finger (visual)
function setMarkerGlow(finger){
  fretboard.querySelectorAll(".marker.on").forEach(m => {
    const f = m.dataset.finger || "";
    m.classList.toggle("glow", finger && f === finger);
  });
}

function clearMarkerGlow(){
  fretboard.querySelectorAll(".marker.on").forEach(m => m.classList.remove("glow"));
}

function renderFretboard(item){
  const maxFret = item.maxFret ?? 5;

  fretboard.style.gridTemplateColumns = `50px repeat(${maxFret}, 1fr)`;
  fretboard.style.gridTemplateRows = `repeat(4, 56px)`;
  fretboard.innerHTML = "";

  buildFretNums(maxFret);

  const strings = item.strings; // 1弦→4弦
  const frets = item.frets;
  const fingers = item.fingers || ["","","",""];

  state.chordFingers = getUsedFingers(fingers);
  state.lockFinger = null; // chord change resets lock
  applyCurrentGlow();

  for (let r=0; r<4; r++){
    const s = strings[r];
    const tag = document.createElement("div");
    tag.className = "stringTag";
    tag.innerHTML = `${s.name}<small>${s.note}</small>`;
    fretboard.appendChild(tag);

    for (let f=1; f<=maxFret; f++){
      const slot = document.createElement("div");
      slot.className = "slot";

      const fretNum = frets[r] ?? 0;
      const fingerLabel = fingers[r] || "";

      if (fretNum === 0 && f === 1) slot.appendChild(marker("open","",""));
      if (fretNum === f) slot.appendChild(marker("on", fingerLabel || "●", fingerLabel));

      fretboard.appendChild(slot);
    }
  }

  addStringLines();
  clearMarkerGlow();
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
  applyOverlay();
  applyWobble();

  setDebug(`OK: notes.json 読込 / CODE=${item.code} / idx=${state.idx+1}/${state.items.length}`);
}

function showBurst(text, isMiss=false){
  burstText.textContent = text;
  burst.hidden = false;
  burst.classList.toggle("miss", !!isMiss);

  window.clearTimeout(showBurst._t);
  showBurst._t = window.setTimeout(() => { burst.hidden = true; }, 950);
}

function setRealtimeFinger(finger, lock=false){
  if (!finger) return;
  if (lock){
    state.lockFinger = (state.lockFinger === finger) ? null : finger;
  } else {
    // temporary highlight while hovering/touching (only if not locked)
    if (state.lockFinger) return;
    state.lockFinger = finger;
    // but don't keep it: this is for "touchstart" w/out lock? We'll clear on pointerup/cancel
  }
  applyCurrentGlow();
  setMarkerGlow(state.lockFinger || "");
}

function resetRealtime(){
  state.lockFinger = null;
  applyCurrentGlow();
  clearMarkerGlow();
}

// ---- Events
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
  state.overlayLevel = (state.overlayLevel + 1) % 3;
  applyOverlay();
});
toggleWobbleBtn.addEventListener("click", () => {
  state.wobbleLevel = (state.wobbleLevel + 1) % 3;
  applyWobble();
});
demoOkBtn.addEventListener("click", () => showBurst("OK!!", false));
demoNgBtn.addEventListener("click", () => showBurst("MISS!", true));
clearHoverBtn.addEventListener("click", () => resetRealtime());

// Left hand buttons = lock toggle
document.querySelectorAll(".finger").forEach(btn => {
  btn.addEventListener("click", () => {
    const f = btn.dataset.f || "";
    if (!f) return;
    // lock/unlock
    state.lockFinger = (state.lockFinger === f) ? null : f;
    applyCurrentGlow();
    setMarkerGlow(state.lockFinger || "");
    if (!state.lockFinger) clearMarkerGlow();
  });
});

// Fretboard marker interactions
fretboard.addEventListener("pointerover", (e) => {
  const m = e.target.closest(".marker.on");
  if (!m) return;
  const f = m.dataset.finger || "";
  if (!f) return;
  if (state.lockFinger) return;
  state.lockFinger = f;
  applyCurrentGlow();
  setMarkerGlow(f);
});
fretboard.addEventListener("pointerout", (e) => {
  const m = e.target.closest(".marker.on");
  if (!m) return;
  if (state.lockFinger) {
    // if locked by finger buttons or click, don't clear on out
    // We can't perfectly distinguish; use heuristic: if any finger button is "locked", keep.
    // We'll treat lock only when marker click toggles; for hover we set lockFinger but clear here.
    // So clear only if the out came from hover-mode: we clear always when pointerout and no marker click happened.
  }
  // Clear to chord fingers unless user has locked via finger buttons (handled above) -> lockFinger will not be null in that case.
  // For hover-mode we always clear.
  state.lockFinger = null;
  applyCurrentGlow();
  clearMarkerGlow();
});

// Tap/click a marker -> lock toggle to that finger
fretboard.addEventListener("click", (e) => {
  const m = e.target.closest(".marker.on");
  if (!m) return;
  const f = m.dataset.finger || "";
  if (!f) return;
  // toggle lock finger
  state.lockFinger = (state.lockFinger === f) ? null : f;
  applyCurrentGlow();
  setMarkerGlow(state.lockFinger || "");
  if (!state.lockFinger) clearMarkerGlow();
});

// Keyboard (enter/space) on focused marker
fretboard.addEventListener("keydown", (e) => {
  if (e.key !== "Enter" && e.key !== " ") return;
  const m = e.target.closest(".marker.on");
  if (!m) return;
  const f = m.dataset.finger || "";
  if (!f) return;
  e.preventDefault();
  state.lockFinger = (state.lockFinger === f) ? null : f;
  applyCurrentGlow();
  setMarkerGlow(state.lockFinger || "");
  if (!state.lockFinger) clearMarkerGlow();
});

// Load notes.json
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
