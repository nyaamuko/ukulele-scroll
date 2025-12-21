// app.js (v5)
let state = {
  stage: 2, // 1 or 2
  items: [],
  idx: 0,
  phaseIdx: 0,
  overlayLevel: 1,
  wobbleLevel: 2,
  lockFinger: null,
  chordFingers: new Set(),
};

const bgCode = document.getElementById("bgCode");
const codeLabel = document.getElementById("codeLabel");
const fretboard = document.getElementById("fretboard");
const timerValue = document.getElementById("timerValue");
const debug = document.getElementById("debug");
const fretWrap = document.getElementById("fretWrap");
const stage1Panel = document.getElementById("stage1Panel");
const tuneTestBtn = document.getElementById("tuneTestBtn");
const tuneResetBtn = document.getElementById("tuneResetBtn");
const tuneEls = {t1: document.getElementById("tune1"), t2: document.getElementById("tune2"), t3: document.getElementById("tune3"), t4: document.getElementById("tune4")};
const tuneStartBtn = document.getElementById("tuneStartBtn");
const ticker = document.getElementById("ticker");
const tickerTrack = document.getElementById("tickerTrack");
const tickerCode = document.getElementById("tickerCode");
const bigString = document.getElementById("bigString");
const bigStringLabel = document.getElementById("bigStringLabel");
const bigStringNote = document.getElementById("bigStringNote");
const bigStringHint = document.getElementById("bigStringHint");


const prevBtn = document.getElementById("prevBtn");
const nextBtn = document.getElementById("nextBtn");
const stageBtn = document.getElementById("stageBtn");
const phaseBtn = document.getElementById("phaseBtn");
const toggleOverlayBtn = document.getElementById("toggleOverlayBtn");
const toggleWobbleBtn = document.getElementById("toggleWobbleBtn");
const demoOkBtn = document.getElementById("demoOkBtn");
const demoNgBtn = document.getElementById("demoNgBtn");
const clearHoverBtn = document.getElementById("clearHoverBtn");
const micBtn = document.getElementById("micBtn");
const judgeBtn = document.getElementById("judgeBtn");
const levelBar = document.getElementById("levelBar");
const micStatus = document.getElementById("micStatus");

const phaseTitle = document.getElementById("phaseTitle");
const phaseText = document.getElementById("phaseText");
const stage2Prompt = document.getElementById("stage2Prompt");
const stage2Controls = document.getElementById("stage2Controls");

const burst = document.getElementById("burst");
const burstText = document.getElementById("burstText");

// 指先（絵）の光り
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

function setDebug(msg){ if (debug) debug.textContent = msg; }

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
  if (state.lockFinger){
    setFingerGlow(new Set([state.lockFinger]));
  } else {
    setFingerGlow(state.chordFingers);
  }
}

function addStringLines(){
  // 既存ラインを消す
  fretboard.querySelectorAll(".stringLine").forEach(n => n.remove());

  // CSSで行高/ギャップが変わるので、実測して中央にラインを置く
  const slots = Array.from(fretboard.querySelectorAll(".slot"));
  if (!slots.length) return;

  const fbRect = fretboard.getBoundingClientRect();
  const cols = (state.items?.[state.idx]?.maxFret ?? 5);

  for (let r=0; r<4; r++){
    const firstSlot = slots[r*cols];
    if (!firstSlot) continue;
    const rc = firstSlot.getBoundingClientRect();
    const centerY = (rc.top - fbRect.top) + rc.height/2;

    const line = document.createElement("div");
    line.className = "stringLine";
    line.style.top = `${centerY}px`;
    fretboard.appendChild(line);
  }
}

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

  fretboard.style.gridTemplateColumns = `44px repeat(${maxFret}, 1fr)`;
  fretboard.style.gridTemplateRows = `repeat(4, 48px)`;
  fretboard.innerHTML = "";

  buildFretNums(maxFret);

  const strings = item.strings;
  const frets = item.frets;
  const fingers = item.fingers || ["","","",""];

  state.chordFingers = getUsedFingers(fingers);
  state.lockFinger = null;
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

function applyStage(){
  const is1 = (state.stage === 1);
  if (stage1Panel) stage1Panel.hidden = !is1;
  if (fretWrap) fretWrap.hidden = is1;

  // stage2-only blocks
  if (stage2Prompt) stage2Prompt.hidden = is1;
  if (stage2Controls) stage2Controls.hidden = is1;

  if (stageBtn) stageBtn.textContent = is1 ? "STAGE2" : "STAGE1";
  const badge = document.querySelector(".badge");
  if (badge) badge.textContent = is1 ? "STAGE 1" : "STAGE 2";

  if (is1){
    if (phaseTitle) phaseTitle.textContent = "TUNING";
    if (phaseText) phaseText.textContent = "上のコードが左端に来たら、その音を鳴らしてね";
    if (timerValue) timerValue.textContent = "--";
  }else{
    // leaving stage1 -> stop any running flow
    try{ stopTuningFlow(); }catch(_){}
  }
}

function resetTuning(){
  stopTuningFlow();
  hideBigString();

  if (!tuneEls) return;
  Object.values(tuneEls).forEach(el=>{
    if (!el) return;
    el.textContent = "待機";
    el.classList.remove("ok");
  });
  setMicStatus(false);
}


let tuningRun = { running:false, step:0, duration:3800, cueShowAt:0.68, cueJudgeAt:0.86 };

const STAGE1_STEPS = [
  { key:"t4", strLabel:"4弦", note:"G", pc: 7 },
  { key:"t3", strLabel:"3弦", note:"C", pc: 0 },
  { key:"t2", strLabel:"2弦", note:"E", pc: 4 },
  { key:"t1", strLabel:"1弦", note:"A", pc: 9 },
];

function showBigString(step, mode="ready"){
  if (!bigString) return;
  bigString.hidden = false;
  bigStringLabel.textContent = step.strLabel;
  bigStringNote.textContent = step.note;
  bigStringHint.textContent = (mode === "judge") ? "今！鳴らして！" : "準備…";
}
function hideBigString(){
  if (!bigString) return;
  bigString.hidden = true;
}

function setTuneOK(stepKey){
  const el = tuneEls?.[stepKey];
  if (!el) return;
  el.textContent = "OK";
  el.classList.add("ok");
}
function setTuneWait(stepKey){
  const el = tuneEls?.[stepKey];
  if (!el) return;
  el.textContent = "待機";
  el.classList.remove("ok");
}

function setTickerNote(note){
  if (tickerCode) tickerCode.textContent = note;
  if (tickerTrack) tickerTrack.style.transform = "translateX(110%)";
}

async function judgeStage1TargetPC(targetPC, windowMs=700){
  if (!micStream || !analyser || !timeData || !audioCtx) return false;

  const started = performance.now();
  let hits = 0;

  while (performance.now() - started < windowMs){
    analyser.getFloatTimeDomainData(timeData);
    const {freq, rms} = autoCorrelateFloat(timeData, audioCtx.sampleRate);
    if (rms > 0.012 && freq){
      const pc = freqToPitchClass(freq);
      if (pc === targetPC) hits++;
    }
    await new Promise(r => setTimeout(r, 45));
  }
  return hits >= 3;
}

function stopTuningFlow(){
  tuningRun.running = false;
}

async function runTuningFlow(){
  if (tuningRun.running) return;

  state.stage = 1;
  applyStage();

  if (!micStream){
    alert("先に「🎤 マイク開始」を押してください（STAGE1チューニング用）");
    return;
  }

  tuningRun.running = true;
  tuningRun.step = 0;

  STAGE1_STEPS.forEach(s => setTuneWait(s.key));
  hideBigString();

  while (tuningRun.running && tuningRun.step < STAGE1_STEPS.length){
    const step = STAGE1_STEPS[tuningRun.step];
    setTickerNote(step.note);

    const start = performance.now();
    let shown = false;
    let ok = false;

    while (tuningRun.running){
      const t = performance.now();
      const p = (t - start) / tuningRun.duration;
      const clamped = Math.max(0, Math.min(1, p));

      if (tickerTrack){
        const x = 110 + (-40 - 110) * clamped; // 110% -> -40%
        tickerTrack.style.transform = `translateX(${x}%)`;
      }

      if (!shown && clamped >= tuningRun.cueShowAt){
        showBigString(step, "ready");
        shown = true;
      }

      if (clamped >= tuningRun.cueJudgeAt){
        showBigString(step, "judge");
        ok = await judgeStage1TargetPC(step.pc, Math.max(420, tuningRun.duration*(1 - tuningRun.cueJudgeAt)));
        break;
      }

      if (clamped >= 1) break;
      await new Promise(r => requestAnimationFrame(()=>r()));
    }

    if (!tuningRun.running) break;

    if (ok){
      setTuneOK(step.key);
      showBurst("OK!!", false);
      hideBigString();
      tuningRun.step += 1;
      await new Promise(r => setTimeout(r, 450));
    }else{
      showBurst("MISS!", true);
      await new Promise(r => setTimeout(r, 650));
    }
  }

  if (tuningRun.running && tuningRun.step >= STAGE1_STEPS.length){
    showBurst("CLEAR!", false);
    state.stage = 2;
    applyStage();
    render();
  }
  stopTuningFlow();
}

function passTuningAll(){
  if (!tuneEls) return;
  [["t4","OK"],["t3","OK"],["t2","OK"],["t1","OK"]].forEach(([k,txt])=>{
    const el = tuneEls[k];
    if (!el) return;
    el.textContent = txt;
    el.classList.add("ok");
  });
  showBurst("OK!!", false);
  // TESTで全OK → STAGE2へ
  state.stage = 2;
  applyStage();
  render();
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

  setDebug(`OK: CODE=${item.code} / ${state.idx+1}/${state.items.length}`);
  applyStage();
}

function showBurst(text, isMiss=false){
  burstText.textContent = text;
  burst.hidden = false;
  burst.classList.toggle("miss", !!isMiss);

  window.clearTimeout(showBurst._t);
  showBurst._t = window.setTimeout(() => { burst.hidden = true; }, 950);
}

function resetRealtime(){
  state.lockFinger = null;
  applyCurrentGlow();
  clearMarkerGlow();
}

prevBtn.addEventListener("click", () => {
  state.idx = (state.idx - 1 + state.items.length) % state.items.length;
  render();
});
nextBtn.addEventListener("click", () => {
  state.idx = (state.idx + 1) % state.items.length;
  render();
});
if (stageBtn){
  stageBtn.addEventListener("click", () => {
    state.stage = (state.stage === 1) ? 2 : 1;
    applyStage();
    if (state.stage === 2) {
      render();
    }
  });
}
if (tuneStartBtn){ tuneStartBtn.addEventListener("click", () => runTuningFlow()); }
if (tuneTestBtn){ tuneTestBtn.addEventListener("click", () => passTuningAll()); }
if (tuneResetBtn){ tuneResetBtn.addEventListener("click", () => resetTuning()); }

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

// 手の絵：タップでロック
document.querySelectorAll(".fbtn").forEach(btn => {
  btn.addEventListener("click", () => {
    const f = btn.dataset.f || "";
    if (!f) return;
    state.lockFinger = (state.lockFinger === f) ? null : f;
    applyCurrentGlow();
    setMarkerGlow(state.lockFinger || "");
    if (!state.lockFinger) clearMarkerGlow();
  });
});

// フレット側：触ると即発光＆強調
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
  state.lockFinger = null;
  applyCurrentGlow();
  clearMarkerGlow();
});
fretboard.addEventListener("click", (e) => {
  const m = e.target.closest(".marker.on");
  if (!m) return;
  const f = m.dataset.finger || "";
  if (!f) return;
  state.lockFinger = (state.lockFinger === f) ? null : f;
  applyCurrentGlow();
  setMarkerGlow(state.lockFinger || "");
  if (!state.lockFinger) clearMarkerGlow();
});
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


// ==== Mic & Judge (v13) ====
let audioCtx = null;
let micStream = null;
let analyser = null;
let timeData = null;
let rafId = null;

function setMicStatus(on, msg=""){
  if (!micStatus) return;
  micStatus.textContent = on ? `MIC: ON ${msg}` : `MIC: OFF ${msg}`;
}
function setLevel(v){
  if (!levelBar) return;
  const pct = Math.max(0, Math.min(1, v));
  levelBar.style.width = `${(pct*100).toFixed(0)}%`;
}
function computeRms(buf){
  let s = 0;
  for (let i=0;i<buf.length;i++){ const x=buf[i]; s += x*x; }
  return Math.sqrt(s / buf.length);
}
function corrAt(buf, lag){
  let c = 0;
  for (let i=0;i<buf.length-lag;i++){ c += buf[i]*buf[i+lag]; }
  return c;
}
function autoCorrelateFloat(buf, sampleRate){
  let mean = 0;
  for (let i=0;i<buf.length;i++) mean += buf[i];
  mean /= buf.length;
  for (let i=0;i<buf.length;i++) buf[i] -= mean;

  const rms = computeRms(buf);
  if (rms < 0.012) return {freq:null, rms};

  const SIZE = buf.length;
  const MIN_F = 80;
  const MAX_F = 1200;
  const minLag = Math.floor(sampleRate / MAX_F);
  const maxLag = Math.floor(sampleRate / MIN_F);

  let bestLag = -1, best = 0;
  for (let lag=minLag; lag<=maxLag; lag++){
    let c = 0;
    for (let i=0;i<SIZE-lag;i++) c += buf[i]*buf[i+lag];
    if (c > best){ best=c; bestLag=lag; }
  }
  if (bestLag === -1) return {freq:null, rms};

  const lag = bestLag;
  const a = lag>1 ? corrAt(buf, lag-1) : best;
  const b = corrAt(buf, lag);
  const c = corrAt(buf, lag+1);
  const denom = (a - 2*b + c);
  let shift = 0;
  if (denom !== 0) shift = 0.5*(a-c)/denom;

  const refined = lag + shift;
  const freq = sampleRate / refined;
  if (freq < MIN_F || freq > MAX_F) return {freq:null, rms};
  return {freq, rms};
}

const NOTE_NAMES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
const NOTE_TO_PC = Object.fromEntries(NOTE_NAMES.map((n,i)=>[n,i]));

function freqToPitchClass(freq){
  if (!freq) return null;
  const midi = 69 + 12 * Math.log2(freq / 440);
  return ((Math.round(midi) % 12) + 12) % 12;
}
function chordTargetPCs(item){
  const pcs = new Set();
  for (let i=0;i<4;i++){
    const baseNote = item.strings[i]?.note;
    const fret = item.frets?.[i] ?? 0;
    const basePc = NOTE_TO_PC[baseNote];
    if (basePc === undefined) continue;
    pcs.add((basePc + fret) % 12);
  }
  return pcs;
}
function pcsToLabel(set){
  const arr = [...set].sort((a,b)=>a-b).map(pc => NOTE_NAMES[pc]);
  return arr.join(",");
}

async function startMic(){
  if (micStream) return;
  try{
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation:false, noiseSuppression:false, autoGainControl:false }
    });
    micStream = stream;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const src = audioCtx.createMediaStreamSource(stream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.2;
    src.connect(analyser);
    timeData = new Float32Array(analyser.fftSize);

    setMicStatus(true);
    if (micBtn) micBtn.textContent = "🎤 マイク停止";
    tickLevel();
  }catch(e){
    console.error(e);
    setMicStatus(false, "(権限NG)");
    alert("マイク権限が必要です（SafariはHTTPSで動作します）");
  }
}
function stopMic(){
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;
  if (micStream) micStream.getTracks().forEach(t=>t.stop());
  micStream = null; analyser = null; timeData = null;
  if (audioCtx) audioCtx.close();
  audioCtx = null;
  setLevel(0);
  setMicStatus(false);
  if (micBtn) micBtn.textContent = "🎤 マイク開始";
}
function tickLevel(){
  if (!analyser || !timeData) return;
  analyser.getFloatTimeDomainData(timeData);
  const rms = computeRms(timeData);
  setLevel(Math.min(1, rms * 6.5));
  rafId = requestAnimationFrame(tickLevel);
}

async function judgeOnce(){
  if (!micStream || !analyser){
    alert("先に「🎤 マイク開始」してください");
    return;
  }
  const item = state.items[state.idx];
  const target = chordTargetPCs(item);
  const need = Math.max(2, Math.min(3, target.size));

  const found = new Map();
  const started = performance.now();

  while (performance.now() - started < 900){
    analyser.getFloatTimeDomainData(timeData);
    const {freq, rms} = autoCorrelateFloat(timeData, audioCtx.sampleRate);
    if (rms > 0.012){
      const pc = freqToPitchClass(freq);
      if (pc !== null) found.set(pc, (found.get(pc)||0)+1);
    }
    await new Promise(r => setTimeout(r, 45));
  }

  const hitPCs = new Set();
  for (const [pc,cnt] of found.entries()){
    if (cnt >= 2) hitPCs.add(pc);
  }
  let hit = 0;
  for (const pc of target) if (hitPCs.has(pc)) hit++;

  const msg = `target=[${pcsToLabel(target)}] found=[${pcsToLabel(hitPCs)}] hit=${hit}/${target.size}`;
  if (hit >= need){
    showBurst("OK!!", false);
    setMicStatus(true, "(OK)");
  }else{
    showBurst("MISS!", true);
    setMicStatus(true, "(MISS)");
  }
  if (debug) debug.textContent = msg;
}

if (micBtn){
  micBtn.addEventListener("click", () => micStream ? stopMic() : startMic());
}
if (judgeBtn){
  judgeBtn.addEventListener("click", () => judgeOnce());
}


// Load
async function init(){
  try{
    setDebug("loading…");
    const res = await fetch("./notes.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`fetch notes.json failed: ${res.status}`);
    const data = await res.json();
    state.items = data.stage2_chords || [];
    state.idx = 0;
    render();
    resetTuning();
    applyStage();
  }catch(e){
    console.error(e);
    setDebug("ERROR: notes.json 読込失敗");
  }
}
init();
