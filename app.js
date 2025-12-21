// Ukulele Scroll - Comic Tuning (G C E A) - root deploy files
// Keep deploy flow the same (index.html / styles.css / app.js at repo root).

const STRINGS = ["G","C","E","A"];
const STORAGE_KEY = "ukulele_scroll_tuner_v2";

const $ = (id) => document.getElementById(id);

const hudStep = $("hudStep");
const btnPrev = $("btnPrev");
const btnNext = $("btnNext");
const btnReset = $("btnReset");
const btnHome = $("btnHome");
const toggleLowG = $("toggleLowG");

const stringsEl = $("strings");
const fretsEl = $("frets");
const targetPuck = $("targetPuck");

const targetBadge = $("targetBadge");
const rangeBadge = $("rangeBadge");
const currentNote = $("currentNote");
const freqText = $("freqText");
const needle = $("needle");
const btnMic = $("btnMic");
const statusText = $("statusText");

let state = loadState();
let idx = state.idx ?? 0;

let audioCtx = null;
let analyser = null;
let micStream = null;
let rafId = null;

let lastGoodAt = 0;
const goodHoldMs = 520;
const okThresholdCents = 18;

let smoothedCents = 0;
const smoothing = 0.22;

function loadState(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) throw new Error("empty");
    const s = JSON.parse(raw);
    return {
      lowG: !!s.lowG,
      done: s.done || {G:false,C:false,E:false,A:false},
      idx: typeof s.idx === "number" ? s.idx : 0,
    };
  }catch(e){
    return { lowG:false, done:{G:false,C:false,E:false,A:false}, idx:0 };
  }
}
function saveState(){
  state.idx = idx;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function buildFrets(){
  fretsEl.innerHTML = "";
  for (let i=0;i<16;i++){
    const d = document.createElement("div");
    d.className = "fret";
    fretsEl.appendChild(d);
  }
}

function buildStrings(){
  stringsEl.innerHTML = "";
  STRINGS.forEach((s, i) => {
    const row = document.createElement("div");
    row.className = "stringRow";
    row.dataset.string = s;

    const badge = document.createElement("div");
    badge.className = "stringBadge";
    badge.textContent = s;

    const line = document.createElement("div");
    line.className = "stringLine";

    row.appendChild(badge);
    row.appendChild(line);

    row.addEventListener("click", () => {
      idx = i;
      lastGoodAt = 0;
      smoothedCents = 0;
      updateUI(true);
    });

    stringsEl.appendChild(row);
  });
}

function setStatus(text, kind){
  statusText.textContent = text;
  statusText.classList.remove("status--good","status--warn","status--bad");
  if (kind) statusText.classList.add(kind);
}

function setNeedleByCents(cents){
  // Map cents -50..+50 to degrees -45..+45
  const clamped = Math.max(-50, Math.min(50, cents));
  const deg = (clamped / 50) * 45;
  needle.style.transform = `rotate(${deg}deg)`;
}

function updateUI(persist=false){
  const target = STRINGS[idx];

  hudStep.textContent = `/${idx+1}`;

  btnPrev.disabled = idx <= 0;
  btnNext.disabled = true; // only enabled on OK

  toggleLowG.checked = state.lowG;
  rangeBadge.textContent = state.lowG ? "Low G" : "High G";

  targetBadge.textContent = target;

  [...document.querySelectorAll(".stringRow")].forEach((row, i) => {
    const s = STRINGS[i];
    row.classList.toggle("stringRow--active", i === idx);
    row.classList.toggle("stringRow--done", !!state.done[s]);
  });

  const activeRow = document.querySelector(`.stringRow[data-string="${target}"]`);
  if (activeRow){
    const rect = activeRow.getBoundingClientRect();
    const boardRect = document.querySelector(".board").getBoundingClientRect();
    const y = (rect.top + rect.height/2) - boardRect.top;
    targetPuck.style.top = `${Math.max(80, Math.min(boardRect.height-40, y))}px`;
  }

  if (persist) saveState();
}

function resetAll(){
  stopAudio();
  state.done = {G:false,C:false,E:false,A:false};
  idx = 0;
  lastGoodAt = 0;
  smoothedCents = 0;
  currentNote.textContent = "--";
  freqText.textContent = "-- Hz";
  setNeedleByCents(0);
  btnMic.disabled = false;
  btnMic.textContent = "Tap to Start";
  setStatus("マイクを開始してください", null);
  updateUI(true);
}

async function startMic(){
  if (audioCtx && micStream) return;
  try{
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation:false, noiseSuppression:false, autoGainControl:false }
    });
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioCtx.createMediaStreamSource(micStream);

    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.0;

    source.connect(analyser);

    btnMic.disabled = true;
    btnMic.textContent = "Listening…";
    setStatus("Listening…（弦を鳴らしてね）", null);
    startLoop();
  }catch(err){
    console.error(err);
    setStatus("マイク許可が必要です（Safari設定を確認）", "status--bad");
    btnMic.disabled = false;
    btnMic.textContent = "Tap to Start";
  }
}

function stopAudio(){
  if (rafId) cancelAnimationFrame(rafId);
  rafId = null;
  if (audioCtx){
    try{ audioCtx.close(); }catch(_){}
  }
  audioCtx = null;
  analyser = null;
  if (micStream){
    micStream.getTracks().forEach(t => t.stop());
  }
  micStream = null;
}

function markOk(){
  const target = STRINGS[idx];
  state.done[target] = true;
  saveState();

  btnNext.disabled = false;
  setStatus("OK！つぎ！", "status--good");

  setTimeout(() => {
    if (idx < STRINGS.length-1){
      idx += 1;
      lastGoodAt = 0;
      smoothedCents = 0;
      updateUI(true);
    }else{
      setStatus("4本ぜんぶOK！", "status--good");
      btnMic.disabled = false;
      btnMic.textContent = "もう一回やる？";
      stopAudio();
    }
  }, 260);
}

function startLoop(){
  const buf = new Float32Array(analyser.fftSize);

  const tick = () => {
    if (!analyser || !audioCtx) return;
    analyser.getFloatTimeDomainData(buf);

    const {freq, rms} = autoCorrelate(buf, audioCtx.sampleRate);

    if (!freq || rms < 0.010){
      currentNote.textContent = "--";
      freqText.textContent = "-- Hz";
      setNeedleByCents(0);
      lastGoodAt = 0;
      setStatus("（小さい）もっとはっきり鳴らしてね", "status--warn");
      rafId = requestAnimationFrame(tick);
      return;
    }

    const note = freqToNote(freq).name;
    currentNote.textContent = note.replace("#","♯");
    freqText.textContent = `${freq.toFixed(1)} Hz`;

    const target = STRINGS[idx];
    const cents = centsToNearestTarget(freq, target);
    smoothedCents = smoothedCents * (1 - smoothing) + cents * smoothing;
    setNeedleByCents(smoothedCents);

    const isNameOk = note.startsWith(target);
    const isOk = isNameOk && Math.abs(smoothedCents) <= okThresholdCents;

    if (isOk){
      if (!lastGoodAt) lastGoodAt = performance.now();
      const held = performance.now() - lastGoodAt;
      setStatus(`OK判定… ${Math.min(100, Math.round(held / goodHoldMs * 100))}%`, "status--good");
      if (held >= goodHoldMs){
        markOk();
        lastGoodAt = 0;
      }
    } else {
      lastGoodAt = 0;
      if (smoothedCents < -okThresholdCents) setStatus("低い（ちょい上げ）", "status--warn");
      else if (smoothedCents > okThresholdCents) setStatus("高い（ちょい下げ）", "status--warn");
      else setStatus("合わせ中…", null);
    }

    rafId = requestAnimationFrame(tick);
  };

  tick();
}

/** Autocorrelation pitch detection (simple) */
function autoCorrelate(buf, sampleRate){
  let rms = 0;
  for (let i=0;i<buf.length;i++){
    const v = buf[i];
    rms += v*v;
  }
  rms = Math.sqrt(rms / buf.length);
  if (rms < 0.005) return {freq:null, rms};

  const size = buf.length;
  let mean = 0;
  for (let i=0;i<size;i++) mean += buf[i];
  mean /= size;

  const x = new Float32Array(size);
  for (let i=0;i<size;i++){
    const w = 0.5 * (1 - Math.cos(2*Math.PI*i/(size-1)));
    x[i] = (buf[i] - mean) * w;
  }

  const minFreq = 60;
  const maxFreq = 1200;
  const minLag = Math.floor(sampleRate / maxFreq);
  const maxLag = Math.floor(sampleRate / minFreq);

  let bestLag = -1;
  let best = 0;

  for (let lag=minLag; lag<=maxLag; lag++){
    let sum = 0;
    for (let i=0; i<size-lag; i++){
      sum += x[i] * x[i+lag];
    }
    if (sum > best){
      best = sum;
      bestLag = lag;
    }
  }
  if (bestLag === -1) return {freq:null, rms};

  const lag = bestLag;
  const c0 = corrAtLag(x, lag-1);
  const c1 = corrAtLag(x, lag);
  const c2 = corrAtLag(x, lag+1);
  const denom = (2*c1 - c0 - c2);
  let shift = 0;
  if (denom !== 0) shift = (c2 - c0) / (2*denom);
  const refinedLag = lag + shift;
  const freq = sampleRate / refinedLag;

  if (!isFinite(freq) || freq < minFreq || freq > maxFreq) return {freq:null, rms};
  return {freq, rms};
}
function corrAtLag(x, lag){
  if (lag < 1) return 0;
  let sum = 0;
  for (let i=0; i<x.length-lag; i++){
    sum += x[i] * x[i+lag];
  }
  return sum;
}
function freqToNote(freq){
  const noteNum = 69 + 12 * Math.log2(freq / 440);
  const midi = Math.round(noteNum);
  return { midi, name: midiToName(midi) };
}
function midiToName(midi){
  const names = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
  const n = ((midi % 12) + 12) % 12;
  return names[n];
}
function nameToMidi(name, octave){
  const map = {"C":0,"C#":1,"D":2,"D#":3,"E":4,"F":5,"F#":6,"G":7,"G#":8,"A":9,"A#":10,"B":11};
  const v = map[name];
  if (v == null) return null;
  return (octave + 1) * 12 + v;
}
function midiToFreq(midi){
  return 440 * Math.pow(2, (midi - 69) / 12);
}
function centsToNearestTarget(freq, targetName){
  const targets = [];
  for (let octave=1; octave<=7; octave++){
    const midi = nameToMidi(targetName, octave);
    if (midi != null) targets.push(midi);
  }
  let bestCents = 0;
  let bestAbs = Infinity;
  for (const midi of targets){
    const tf = midiToFreq(midi);
    const cents = 1200 * Math.log2(freq / tf);
    const abs = Math.abs(cents);
    if (abs < bestAbs){
      bestAbs = abs;
      bestCents = cents;
    }
  }
  return Math.max(-50, Math.min(50, bestCents));
}

// events
btnMic.addEventListener("click", async () => {
  if (!micStream) await startMic();
  else {
    resetAll();
    await startMic();
  }
});
btnPrev.addEventListener("click", () => {
  if (idx > 0){ idx -= 1; lastGoodAt = 0; smoothedCents = 0; updateUI(true); }
});
btnNext.addEventListener("click", () => {
  if (idx < STRINGS.length-1){ idx += 1; lastGoodAt = 0; smoothedCents = 0; updateUI(true); }
});
btnReset.addEventListener("click", resetAll);
btnHome.addEventListener("click", () => { idx = 0; lastGoodAt = 0; smoothedCents = 0; updateUI(true); });
toggleLowG.addEventListener("change", () => { state.lowG = toggleLowG.checked; saveState(); updateUI(false); });
window.addEventListener("pagehide", () => stopAudio());

// init
function init(){
  buildFrets();
  buildStrings();
  toggleLowG.checked = state.lowG;
  currentNote.textContent = "--";
  freqText.textContent = "-- Hz";
  setNeedleByCents(0);
  setStatus("マイクを開始してください", null);
  updateUI(true);
}
init();
