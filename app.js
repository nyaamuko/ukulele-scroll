// Ukeflow Tuner MVP (G -> C -> E -> A) for mobile web
// Works on localhost / https. iPhone Safari requires user gesture to start microphone.

const STRINGS = ["G", "C", "E", "A"];

// In MVP, Low-G only changes the suggested octave label; detection is by note name (G/C/E/A).
const STORAGE_KEY = "ukeflow_tuner_mvp_v1";

const $ = (id) => document.getElementById(id);

const screens = {
  home: $("screenHome"),
  play: $("screenPlay"),
  summary: $("screenSummary"),
};

const topTitle = $("topTitle");
const btnBack = $("btnBack");
const btnSettings = $("btnSettings");

const toggleLowGHome = $("toggleLowGHome");
const toggleLowGPlay = $("toggleLowGPlay");

const btnStartSequence = $("btnStartSequence");
const btnReset = $("btnReset");

const stringCards = $("stringCards");
const summaryCards = $("summaryCards");

const targetLabel = $("targetLabel");
const currentNote = $("currentNote");
const freqText = $("freqText");
const needle = $("needle");
const statusText = $("statusText");

const btnMic = $("btnMic");
const btnHelp = $("btnHelp");
const btnRetry = $("btnRetry");
const btnNext = $("btnNext");
const helpBox = $("helpBox");

const btnToHome = $("btnToHome");
const btnToPractice = $("btnToPractice");

let state = loadState();
let currentIndex = 0;         // which string in sequence
let currentTarget = "G";      // "G"|"C"|"E"|"A"

// Audio
let audioCtx = null;
let analyser = null;
let micStream = null;
let rafId = null;
let lastGoodAt = 0;
let goodHoldMs = 500;         // OK hold time
let okThresholdCents = 18;    // meter OK window (approx)
let smoothedCents = 0;
let smoothing = 0.25;

// -------------------- UI helpers --------------------
function showScreen(name){
  Object.values(screens).forEach(el => el.classList.remove("screen--active"));
  screens[name].classList.add("screen--active");
  // Top title updates
  if (name === "home") topTitle.textContent = "チューニング";
  if (name === "play") topTitle.textContent = "チューニング中";
  if (name === "summary") topTitle.textContent = "完了";
  // Back button visibility
  btnBack.style.visibility = (name === "home") ? "hidden" : "visible";
}

function renderHomeCards(){
  stringCards.innerHTML = "";
  STRINGS.forEach((s) => {
    const done = !!state.done[s];
    const now = (s === STRINGS[currentIndex]) && state.mode === "sequence" && state.lastScreen === "play";
    const card = document.createElement("div");
    card.className = "string-card";
    card.innerHTML = `
      <div class="string-card__top">
        <div class="string-card__name">${s}弦</div>
        <span class="badge ${done ? "badge--ok" : (now ? "badge--now" : "")}">
          ${done ? "OK" : (now ? "NOW" : "未完")}
        </span>
      </div>
      <div class="string-card__sub">タップでこの弦をチューニング</div>
    `;
    card.addEventListener("click", () => {
      state.mode = "single";
      saveState();
      startTuningForString(s);
    });
    stringCards.appendChild(card);
  });
}

function renderSummary(){
  summaryCards.innerHTML = "";
  STRINGS.forEach((s) => {
    const done = !!state.done[s];
    const card = document.createElement("div");
    card.className = "string-card";
    card.innerHTML = `
      <div class="string-card__top">
        <div class="string-card__name">${s}弦</div>
        <span class="badge ${done ? "badge--ok" : ""}">${done ? "OK" : "—"}</span>
      </div>
      <div class="string-card__sub">${done ? "合わせました" : "未完"}</div>
    `;
    summaryCards.appendChild(card);
  });
}

function setStatus(text, kind){
  statusText.textContent = text;
  statusText.classList.remove("status--good","status--warn","status--bad");
  if (kind) statusText.classList.add(kind);
}

function setNeedleByCents(cents){
  // Map cents -50..+50 to 0..100% (clamped)
  const clamped = Math.max(-50, Math.min(50, cents));
  const pct = 50 + (clamped * 1.0); // -50=>0, +50=>100
  needle.style.left = `${pct}%`;
}

// -------------------- state --------------------
function loadState(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) throw new Error("empty");
    const parsed = JSON.parse(raw);
    return {
      done: parsed.done || {G:false,C:false,E:false,A:false},
      lowG: !!parsed.lowG,
      lastScreen: parsed.lastScreen || "home",
      mode: parsed.mode || "sequence",
    };
  }catch(e){
    return { done: {G:false,C:false,E:false,A:false}, lowG:false, lastScreen:"home", mode:"sequence" };
  }
}
function saveState(){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function resetAll(){
  stopAudioLoop();
  state.done = {G:false,C:false,E:false,A:false};
  state.mode = "sequence";
  state.lastScreen = "home";
  saveState();
  currentIndex = 0;
  renderHomeCards();
  showScreen("home");
}

// -------------------- tuning flow --------------------
function startSequence(){
  state.mode = "sequence";
  currentIndex = firstIncompleteIndex();
  if (currentIndex >= STRINGS.length) {
    showSummary();
    return;
  }
  startTuningForString(STRINGS[currentIndex]);
}

function firstIncompleteIndex(){
  for (let i=0;i<STRINGS.length;i++){
    if (!state.done[STRINGS[i]]) return i;
  }
  return STRINGS.length;
}

function startTuningForString(s){
  currentTarget = s;
  targetLabel.textContent = s;
  currentNote.textContent = "--";
  freqText.textContent = "-- Hz";
  smoothedCents = 0;
  lastGoodAt = 0;
  btnNext.disabled = true;
  setNeedleByCents(0);
  setStatus("Tap to Start", null);
  helpBox.hidden = true;

  state.lastScreen = "play";
  saveState();
  showScreen("play");
}

// After OK, proceed
function markOkAndAdvance(){
  state.done[currentTarget] = true;
  saveState();

  // If all complete, show summary
  const all = STRINGS.every(s => !!state.done[s]);
  if (all){
    showSummary();
    return;
  }

  if (state.mode === "sequence"){
    currentIndex = firstIncompleteIndex();
    startTuningForString(STRINGS[currentIndex]);
  } else {
    // single mode -> back to home
    stopAudioLoop();
    state.lastScreen = "home";
    saveState();
    renderHomeCards();
    showScreen("home");
  }
}

function showSummary(){
  stopAudioLoop();
  state.lastScreen = "summary";
  saveState();
  renderSummary();
  showScreen("summary");
}

// -------------------- audio & pitch detection --------------------
async function startMic(){
  if (audioCtx && micStream) return;

  try{
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      }
    });

    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const source = audioCtx.createMediaStreamSource(micStream);

    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.0;

    source.connect(analyser);

    setStatus("Listening…", null);
    btnMic.textContent = "Listening…";
    btnMic.disabled = true;

    startAudioLoop();
  }catch(err){
    console.error(err);
    setStatus("マイク許可が必要です（Safari設定をご確認ください）", "status--bad");
    btnMic.disabled = false;
  }
}

function stopAudioLoop(){
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

  btnMic.textContent = "録音を開始（Tap to Start）";
  btnMic.disabled = false;
}

function startAudioLoop(){
  const buf = new Float32Array(analyser.fftSize);

  const tick = () => {
    if (!analyser) return;
    analyser.getFloatTimeDomainData(buf);

    const {freq, rms} = autoCorrelate(buf, audioCtx.sampleRate);

    if (rms < 0.010 || !freq){
      currentNote.textContent = "--";
      freqText.textContent = "-- Hz";
      setStatus("No input（弦をはっきり鳴らしてください）", "status--warn");
      btnNext.disabled = true;
      setNeedleByCents(0);
      lastGoodAt = 0;
      rafId = requestAnimationFrame(tick);
      return;
    }

    const noteInfo = freqToNote(freq);
    currentNote.textContent = noteInfo.name;
    freqText.textContent = `${freq.toFixed(1)} Hz`;

    // Target note is by name only (G/C/E/A)
    const targetName = currentTarget;

    // Compute cents difference to nearest target pitch (choose octave that minimizes cents)
    const cents = centsToNearestTarget(freq, targetName);
    smoothedCents = smoothedCents * (1 - smoothing) + cents * smoothing;
    setNeedleByCents(smoothedCents);

    // OK check
    const isOk = Math.abs(smoothedCents) <= okThresholdCents && noteInfo.name.replace("#","♯") .startsWith(targetName);
    // Note: noteInfo.name is like "G", "F#", etc; startsWith handles "G"
    if (isOk){
      if (!lastGoodAt) lastGoodAt = performance.now();
      const held = performance.now() - lastGoodAt;
      setStatus(`OK判定中… ${Math.min(100, Math.round(held / goodHoldMs * 100))}%`, "status--good");
      if (held >= goodHoldMs){
        setStatus("OK! 次の弦へ", "status--good");
        btnNext.disabled = false;
        // Auto-advance after a short beat
        setTimeout(() => {
          if (screens.play.classList.contains("screen--active")) {
            markOkAndAdvance();
          }
        }, 220);
        lastGoodAt = 0;
      }
    } else {
      lastGoodAt = 0;
      // Guidance
      if (smoothedCents < -okThresholdCents) setStatus("低い（少し上げる）", "status--warn");
      else if (smoothedCents > okThresholdCents) setStatus("高い（少し下げる）", "status--warn");
      else setStatus("合わせ中…", null);
      btnNext.disabled = true;
    }

    rafId = requestAnimationFrame(tick);
  };

  tick();
}

/**
 * Autocorrelation pitch detection (simple, fast MVP)
 * Returns {freq, rms}. freq may be null if unclear.
 */
function autoCorrelate(buf, sampleRate){
  // RMS for signal strength
  let rms = 0;
  for (let i=0;i<buf.length;i++){
    const v = buf[i];
    rms += v*v;
  }
  rms = Math.sqrt(rms / buf.length);

  // If too quiet, bail
  if (rms < 0.005) return {freq:null, rms};

  // Remove DC offset
  const size = buf.length;
  let mean = 0;
  for (let i=0;i<size;i++) mean += buf[i];
  mean /= size;

  // Copy to temp & window a bit (Hann)
  const x = new Float32Array(size);
  for (let i=0;i<size;i++){
    const w = 0.5 * (1 - Math.cos(2*Math.PI*i/(size-1)));
    x[i] = (buf[i] - mean) * w;
  }

  // Autocorrelation
  const minFreq = 60;   // ukulele lowest around ~196 (G3) but keep wider
  const maxFreq = 1200;
  const minLag = Math.floor(sampleRate / maxFreq);
  const maxLag = Math.floor(sampleRate / minFreq);

  let bestLag = -1;
  let best = 0;

  for (let lag = minLag; lag <= maxLag; lag++){
    let sum = 0;
    for (let i=0; i < size - lag; i++){
      sum += x[i] * x[i+lag];
    }
    if (sum > best){
      best = sum;
      bestLag = lag;
    }
  }

  if (bestLag === -1) return {freq:null, rms};

  // Parabolic interpolation for better precision
  const lag = bestLag;
  const c0 = corrAtLag(x, lag-1);
  const c1 = corrAtLag(x, lag);
  const c2 = corrAtLag(x, lag+1);
  const denom = (2*c1 - c0 - c2);
  let shift = 0;
  if (denom !== 0) shift = (c2 - c0) / (2*denom);
  const refinedLag = lag + shift;

  const freq = sampleRate / refinedLag;

  // Reject improbable freq
  if (!isFinite(freq) || freq < minFreq || freq > maxFreq) return {freq:null, rms};
  return {freq, rms};
}

function corrAtLag(x, lag){
  if (lag < 1) return 0;
  let sum = 0;
  for (let i=0; i < x.length - lag; i++){
    sum += x[i] * x[i+lag];
  }
  return sum;
}

// Convert frequency to nearest equal-tempered note
function freqToNote(freq){
  // A4 = 440, midi 69
  const noteNum = 69 + 12 * Math.log2(freq / 440);
  const midi = Math.round(noteNum);
  const name = midiToName(midi);
  return {midi, name};
}

function midiToName(midi){
  const names = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
  const n = ((midi % 12) + 12) % 12;
  return names[n];
}

// Compute cents difference between freq and nearest target pitch for given note name (G/C/E/A) across octaves.
function centsToNearestTarget(freq, targetName){
  // Candidate target midis for a reasonable range of octaves
  const targets = [];
  for (let octave = 1; octave <= 7; octave++){
    const midi = nameToMidi(targetName, octave);
    if (midi != null) targets.push(midi);
  }
  // find nearest in cents
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
  // Clamp to meter range
  return Math.max(-50, Math.min(50, bestCents));
}

function nameToMidi(name, octave){
  const map = {"C":0,"C#":1,"D":2,"D#":3,"E":4,"F":5,"F#":6,"G":7,"G#":8,"A":9,"A#":10,"B":11};
  const v = map[name];
  if (v == null) return null;
  // MIDI: C-1=0 => C4=60 => octave*12 + 12
  return (octave + 1) * 12 + v;
}

function midiToFreq(midi){
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// -------------------- events --------------------
btnBack.addEventListener("click", () => {
  if (screens.play.classList.contains("screen--active")){
    stopAudioLoop();
    state.lastScreen = "home";
    saveState();
    renderHomeCards();
    showScreen("home");
  } else if (screens.summary.classList.contains("screen--active")){
    state.lastScreen = "home";
    saveState();
    renderHomeCards();
    showScreen("home");
  }
});

btnSettings.addEventListener("click", () => {
  // MVP: settings is just Low-G toggle; in future open bottom sheet.
  if (screens.home.classList.contains("screen--active")){
    toggleLowGHome.click();
  } else if (screens.play.classList.contains("screen--active")){
    toggleLowGPlay.click();
  }
});

toggleLowGHome.addEventListener("change", () => {
  state.lowG = toggleLowGHome.checked;
  toggleLowGPlay.checked = state.lowG;
  saveState();
});

toggleLowGPlay.addEventListener("change", () => {
  state.lowG = toggleLowGPlay.checked;
  toggleLowGHome.checked = state.lowG;
  saveState();
});

btnStartSequence.addEventListener("click", startSequence);

btnReset.addEventListener("click", resetAll);

btnMic.addEventListener("click", startMic);

btnHelp.addEventListener("click", () => {
  helpBox.hidden = !helpBox.hidden;
});

btnRetry.addEventListener("click", () => {
  // keep current string but reset hold
  lastGoodAt = 0;
  smoothedCents = 0;
  btnNext.disabled = true;
  setNeedleByCents(0);
  setStatus("もう一度鳴らしてください", null);
});

btnNext.addEventListener("click", () => {
  markOkAndAdvance();
});

btnToHome.addEventListener("click", () => {
  // Reset done states for a new run
  state.mode = "sequence";
  state.done = {G:false,C:false,E:false,A:false};
  state.lastScreen = "home";
  saveState();
  currentIndex = 0;
  renderHomeCards();
  showScreen("home");
});

// -------------------- init --------------------
function init(){
  toggleLowGHome.checked = state.lowG;
  toggleLowGPlay.checked = state.lowG;

  // Home cards always render based on state
  renderHomeCards();

  // Restore last screen lightly
  if (state.lastScreen === "play"){
    // Return to home to avoid auto mic prompts; user must start intentionally.
    state.lastScreen = "home";
    saveState();
  }
  if (STRINGS.every(s => !!state.done[s])){
    renderSummary();
    showScreen("summary");
  } else {
    showScreen("home");
  }
}

window.addEventListener("pagehide", () => {
  stopAudioLoop();
});

init();
