// UkeFlow Pulse Trainer - Stage System (Forced tuning order G->C->E->A) + Big comic stage splash
// Stage 1: Tuning (must clear G then C then E then A)
// Stage 2: Pulse Game (after clearing all strings)

const cv = document.getElementById("cv");
const ctx = cv.getContext("2d");

const btnLoad = document.getElementById("btnLoad");
const btnMic  = document.getElementById("btnMic");
const btnCal  = document.getElementById("btnCal");
const btnStart= document.getElementById("btnStart");
const btnStop = document.getElementById("btnStop");

const sensSlider = document.getElementById("sensSlider");
const sensVal = document.getElementById("sensVal");
const winSlider = document.getElementById("winSlider");
const winVal = document.getElementById("winVal");
const diffSelect = document.getElementById("diffSelect");
const sfxToggle = document.getElementById("sfxToggle");

const statusEl = document.getElementById("status");
const scoreEl = document.getElementById("score");
const comboEl = document.getElementById("combo");
const accEl = document.getElementById("acc");

const meterBar = document.getElementById("meterBar");
const meterTxt = document.getElementById("meterTxt");
const lifeFill = document.getElementById("lifeFill");
const judgeFloat = document.getElementById("judgeFloat");

const comic = document.getElementById("comic");
const comicBoom = document.getElementById("comicBoom");
const comicBubble = document.getElementById("comicBubble");

const resultOverlay = document.getElementById("resultOverlay");
const resultGrade = document.getElementById("resultGrade");
const resultStats = document.getElementById("resultStats");
const btnRestart = document.getElementById("btnRestart");
const btnCloseResult = document.getElementById("btnCloseResult");

// ===== Canvas =====
let dpr = 1;
function resizeCanvas(){
  const rect = cv.getBoundingClientRect();
  dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
  cv.width = Math.floor(rect.width * dpr);
  cv.height = Math.floor(rect.height * dpr);
}
window.addEventListener("resize", resizeCanvas);
resizeCanvas();

function clamp(x,a,b){ return Math.max(a, Math.min(b,x)); }
function setStatus(t){ statusEl.textContent = t; }

// ===== Audio =====
let audioCtx = null;
let analyser = null;
let micStream = null;
let dataTime = null;
let sampleRate = 48000;

async function initMic(){
  try{
    if(!audioCtx){
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    await audioCtx.resume();

    micStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation:true, noiseSuppression:true, autoGainControl:true },
      video: false
    });

    sampleRate = audioCtx.sampleRate;

    const src = audioCtx.createMediaStreamSource(micStream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    dataTime = new Float32Array(analyser.fftSize);
    src.connect(analyser);

    setStatus("マイクOK（次はキャリブレーション）");
    btnCal.disabled = false;
    btnStart.disabled = !chartLoaded;
    beep(520, 60, "sine", 0.04);
    return true;
  }catch(e){
    console.error(e);
    setStatus("マイクNG（https/Safari/許可を確認）");
    return false;
  }
}

function getRms(){
  if(!analyser) return 0;
  analyser.getFloatTimeDomainData(dataTime);
  let sum = 0;
  for(let i=0;i<dataTime.length;i++){
    const v = dataTime[i];
    sum += v*v;
  }
  return Math.sqrt(sum / dataTime.length);
}

// ===== SFX =====
function beep(freq, durMs, type="sine", gain=0.05){
  if(!audioCtx || !sfxToggle.checked) return;
  const t0 = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.value = 0.0001;
  osc.connect(g).connect(audioCtx.destination);
  osc.start(t0);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + durMs/1000);
  osc.stop(t0 + durMs/1000 + 0.03);
}

// ===== Calibration & strum trigger =====
let noiseFloor = 0.010;
let triggerRms = 0.030;
let calibrated = false;

let sensitivity = parseInt(sensSlider.value, 10);
let windowMs = parseInt(winSlider.value, 10);
sensVal.textContent = String(sensitivity);
winVal.textContent = String(windowMs);

function recomputeTrigger(){
  const margin = 0.040 - (sensitivity/30) * 0.032; // 0.040..0.008
  triggerRms = noiseFloor + margin;
}
function isStrum(rms){ return rms > triggerRms; }

sensSlider.addEventListener("input", () => {
  sensitivity = parseInt(sensSlider.value, 10);
  sensVal.textContent = String(sensitivity);
  recomputeTrigger();
});
winSlider.addEventListener("input", () => {
  windowMs = parseInt(winSlider.value, 10);
  winVal.textContent = String(windowMs);
});
diffSelect.addEventListener("change", () => applyDifficulty(diffSelect.value));

function applyDifficulty(mode){
  if(mode === "easy") windowMs = 240;
  else if(mode === "hard") windowMs = 140;
  else windowMs = 180;
  winSlider.value = String(windowMs);
  winVal.textContent = String(windowMs);
}

async function calibrate(){
  if(!analyser){ setStatus("先にマイク許可"); return; }
  setStatus("キャリブレーション中（静かに…）");
  const samples = [];
  const t0 = performance.now();
  while(performance.now() - t0 < 900){
    samples.push(getRms());
    await new Promise(r => setTimeout(r, 20));
  }
  samples.sort((a,b)=>a-b);
  const p85 = samples[Math.floor(samples.length * 0.85)] || 0.010;
  noiseFloor = clamp(p85, 0.003, 0.060);
  calibrated = true;
  recomputeTrigger();
  setStatus(`完了（noise=${noiseFloor.toFixed(3)} / trig=${triggerRms.toFixed(3)}）`);
  beep(660, 80, "triangle", 0.05);
}

// ===== Chart =====
let chartTitle = "No Pattern";
let notes = []; // {t,label, judged:false, rank:null}
let chartLoaded = false;

async function loadChart(){
  try{
    const res = await fetch("./notes.json", { cache:"no-store" });
    if(!res.ok) throw new Error("notes.json fetch failed");
    const json = await res.json();
    chartTitle = json.title || "Untitled";
    notes = (json.notes || []).map(n => ({ t:Number(n.t), label:String(n.label||""), judged:false, rank:null }));
    chartLoaded = notes.length > 0;
    setStatus(`パターンOK：${chartTitle}（${notes.length}）`);
    btnStart.disabled = !chartLoaded || !analyser;
    beep(520, 70, "sine", 0.04);
  }catch(e){
    console.error(e);
    setStatus("パターンNG：notes.jsonが読めません");
  }
}

// ===== Comic =====
let comicUntil = 0;
function showComic(boom, bubble, isStageSplash=false){
  comicBoom.textContent = boom;
  comicBubble.textContent = bubble;
  comic.classList.toggle("stageSplash", !!isStageSplash);

  comic.classList.remove("show");
  comic.setAttribute("aria-hidden","false");
  void comic.offsetWidth;
  comic.classList.add("show");
  comicUntil = performance.now() + (isStageSplash ? 900 : 750);
}
function updateComic(){
  if(comicUntil && performance.now() > comicUntil){
    comic.classList.remove("show");
    comic.setAttribute("aria-hidden","true");
    comicUntil = 0;
  }
}

// ===== Stage =====
const STAGE = { TUNING: 1, GAME: 2 };
let stage = STAGE.TUNING;

// ===== Tuning (forced order) =====
const TUNING_TARGETS = [
  { name:"G", freq:392.00 },
  { name:"C", freq:261.63 },
  { name:"E", freq:329.63 },
  { name:"A", freq:440.00 }
];
let tuneIdx = 0;               // 0..3 -> G,C,E,A
const TUNE_TOL_CENTS = 12;     // ±12 cents
const TUNE_NEED_MS  = 900;     // stable duration per string
let tuneHoldMs = 0;
let lastTuneTs = 0;

function resetTuning(){
  tuneIdx = 0;
  tuneHoldMs = 0;
  lastTuneTs = 0;
}

function freqToCents(freq, targetHz){
  return 1200 * Math.log2(freq / targetHz);
}

// Autocorrelation pitch detection (simple)
function detectPitchHz(buf, sr){
  // remove DC
  let mean = 0;
  for(let i=0;i<buf.length;i++) mean += buf[i];
  mean /= buf.length;

  let rms = 0;
  const x = new Float32Array(buf.length);
  for(let i=0;i<buf.length;i++){
    const v = buf[i] - mean;
    x[i] = v;
    rms += v*v;
  }
  rms = Math.sqrt(rms / buf.length);
  if(rms < 0.008) return null;

  const size = x.length;
  const maxLag = Math.min(Math.floor(sr / 80), size - 1);
  const minLag = Math.max(2, Math.floor(sr / 1000));

  let bestLag = -1;
  let bestVal = 0;

  for(let lag=minLag; lag<=maxLag; lag++){
    let sum = 0;
    for(let i=0;i<size-lag;i++){
      sum += x[i] * x[i+lag];
    }
    if(sum > bestVal){
      bestVal = sum;
      bestLag = lag;
    }
  }
  if(bestLag <= 0) return null;
  const freq = sr / bestLag;
  if(freq < 80 || freq > 1000) return null;
  return freq;
}

function nearestName(freq){
  // used only to display "今の音は◯っぽい"
  let best = null;
  for(const t of TUNING_TARGETS){
    const cents = freqToCents(freq, t.freq);
    const abs = Math.abs(cents);
    if(!best || abs < best.abs){
      best = { name: t.name, abs };
    }
  }
  return best ? best.name : "?";
}

// ===== Game stats =====
let running = false;
let startTs = 0;
let rafId = null;

let score = 0, combo = 0, maxCombo = 0;
let totalJudged = 0, totalHit = 0, sumAbsDt = 0;
let perfect = 0, great = 0, okc = 0, miss = 0;
let life = 1.0;

function setLife(v){
  life = clamp(v, 0, 1);
  lifeFill.style.width = `${Math.round(life*100)}%`;
  lifeFill.style.opacity = (life < 0.35) ? "0.7" : "1.0";
}

function setHUD(){
  scoreEl.textContent = `SCORE: ${score}`;
  comboEl.textContent = `COMBO: ${combo}`;
  if(totalJudged > 0){
    const acc = clamp((totalHit / totalJudged) * 100, 0, 100);
    accEl.textContent = `ACC: ${acc.toFixed(1)}%`;
  }else{
    accEl.textContent = `ACC: --%`;
  }
}

function resetGame(){
  score = 0; combo = 0; maxCombo = 0;
  totalJudged = 0; totalHit = 0; sumAbsDt = 0;
  perfect = 0; great = 0; okc = 0; miss = 0;
  setLife(1.0);
  setHUD();
  for(const n of notes){ n.judged=false; n.rank=null; }
}

function nowSec(ts){ return (ts - startTs) / 1000.0; }

function showJudge(text){
  judgeFloat.textContent = text;
  judgeFloat.classList.remove("show");
  void judgeFloat.offsetWidth;
  judgeFloat.classList.add("show");
}

// Particles
let particles = [];
function spawnBurst(x,y, power=1){
  const n = Math.floor(14 * power);
  for(let i=0;i<n;i++){
    const a = Math.random() * Math.PI * 2;
    const sp = (0.6 + Math.random()*1.6) * power;
    particles.push({ x, y, vx: Math.cos(a)*sp, vy: Math.sin(a)*sp, life: 1.0 });
  }
}
function stepParticles(){
  for(const p of particles){
    p.x += p.vx * dpr;
    p.y += p.vy * dpr;
    p.vx *= 0.98;
    p.vy *= 0.98;
    p.life -= 0.04;
  }
  particles = particles.filter(p => p.life > 0);
}

function drawHex(x,y,r, fill, stroke){
  ctx.save();
  ctx.beginPath();
  for(let k=0;k<6;k++){
    const a = (Math.PI/3)*k + Math.PI/6;
    const px = x + Math.cos(a)*r;
    const py = y + Math.sin(a)*r;
    if(k===0) ctx.moveTo(px,py); else ctx.lineTo(px,py);
  }
  ctx.closePath();
  ctx.fillStyle = fill; ctx.fill();
  ctx.strokeStyle = stroke; ctx.lineWidth = 2*dpr; ctx.stroke();
  ctx.restore();
}

function rankForDt(absDt, win){
  const r = absDt / win;
  if(r <= 0.25) return "perfect";
  if(r <= 0.50) return "great";
  if(r <= 1.00) return "ok";
  return "miss";
}
function addScore(rank){
  const mult = 1 + Math.floor(combo / 10) * 0.2;
  let base = 0;
  if(rank === "perfect") base = 120;
  else if(rank === "great") base = 90;
  else if(rank === "ok") base = 60;
  score += Math.round(base * mult);
}

function applyHit(rank){
  totalJudged++;
  if(rank === "miss"){
    miss++; combo = 0;
    setLife(life - 0.14);
    showJudge("MISS");
    beep(220, 90, "sawtooth", 0.03);
  }else{
    totalHit++;
    if(rank === "perfect"){ perfect++; combo++; setLife(life + 0.05); showJudge("PERFECT"); beep(1040, 60, "sine", 0.05); }
    else if(rank === "great"){ great++; combo++; setLife(life + 0.035); showJudge("GREAT"); beep(880, 60, "sine", 0.045); }
    else { okc++; combo++; setLife(life + 0.02); showJudge("OK"); beep(660, 60, "sine", 0.04); }
    maxCombo = Math.max(maxCombo, combo);
    addScore(rank);
    if(combo === 10) showComic("WHAM!", "10 COMBO! その調子！");
    if(combo === 20) showComic("KAPOW!", "20 COMBO! 指が勝手に動いてる！");
  }
  setHUD();
}

function judgeAtTime(curT, didStrum){
  const win = windowMs / 1000.0;

  let bestIdx = -1;
  let bestDtSigned = 1e9;

  for(let i=0;i<notes.length;i++){
    const n = notes[i];
    if(n.judged) continue;
    const dtSigned = n.t - curT;
    if(Math.abs(dtSigned) < Math.abs(bestDtSigned)){
      bestDtSigned = dtSigned;
      bestIdx = i;
    }
  }

  if(didStrum && bestIdx >= 0 && Math.abs(bestDtSigned) <= win){
    const n = notes[bestIdx];
    n.judged = true;
    const absDt = Math.abs(bestDtSigned);
    const rank = rankForDt(absDt, win);
    n.rank = rank;
    sumAbsDt += absDt;
    applyHit(rank);
  }

  for(const n of notes){
    if(n.judged) continue;
    if(curT - n.t > win){
      n.judged = true;
      n.rank = "miss";
      applyHit("miss");
    }
  }
}

// ===== Result =====
function gradeFor(acc, mcombo){
  if(acc >= 96 && mcombo >= 20) return "S";
  if(acc >= 92) return "A";
  if(acc >= 85) return "B";
  if(acc >= 75) return "C";
  return "D";
}
function openResult(){
  const acc = (totalJudged > 0) ? (totalHit / totalJudged) * 100 : 0;
  const g = gradeFor(acc, maxCombo);
  resultGrade.textContent = g;

  const avgMs = (totalHit > 0) ? (sumAbsDt / totalHit) * 1000 : 0;
  resultStats.textContent = [
    `SCORE: ${score}`,
    `ACC:   ${acc.toFixed(1)}%`,
    `MAX COMBO: ${maxCombo}`,
    ``,
    `PERFECT: ${perfect}`,
    `GREAT:   ${great}`,
    `OK:      ${okc}`,
    `MISS:    ${miss}`,
    ``,
    `AVG |dt|: ${avgMs.toFixed(0)} ms`
  ].join("\n");

  resultOverlay.classList.add("show");
  resultOverlay.setAttribute("aria-hidden","false");
}

// ===== Drawing =====
function roundRect(x,y,w,h,r, fill, stroke){
  const rr = Math.min(r, w/2, h/2);
  ctx.beginPath();
  ctx.moveTo(x+rr,y);
  ctx.arcTo(x+w,y,x+w,y+h,rr);
  ctx.arcTo(x+w,y+h,x,y+h,rr);
  ctx.arcTo(x,y+h,x,y,rr);
  ctx.arcTo(x,y,x+w,y,rr);
  ctx.closePath();
  if(fill) ctx.fill();
  if(stroke) ctx.stroke();
}

function drawBackground(){
  const w = cv.width, h = cv.height;
  ctx.save();
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = "rgba(255,255,255,0.10)";
  for(let i=0;i<70;i++){
    const x = (i*97 % 997) / 997 * w;
    const y = (i*233 % 991) / 991 * h;
    const r = ((i*19)%7 + 1) * dpr * 0.35;
    ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.fill();
  }
  ctx.restore();
}

function drawTuningUI(freq){
  const w = cv.width, h = cv.height;
  const cx = w*0.52;
  const cy = h*0.56;

  const target = TUNING_TARGETS[tuneIdx];
  const cents = freq ? freqToCents(freq, target.freq) : 0;
  const c = clamp(cents, -50, 50);

  // Stage label
  ctx.save();
  ctx.fillStyle = "rgba(234,240,255,0.92)";
  ctx.font = `${16*dpr}px system-ui, -apple-system, sans-serif`;
  ctx.fillText("STAGE 1 : TUNING", 14*dpr, 28*dpr);
  ctx.restore();

  // ring
  ctx.save();
  ctx.strokeStyle = "rgba(124,92,255,0.24)";
  ctx.lineWidth = 2*dpr;
  ctx.beginPath(); ctx.arc(cx,cy, 120*dpr, 0, Math.PI*2); ctx.stroke();
  ctx.restore();

  // required string
  ctx.save();
  ctx.fillStyle = "rgba(234,240,255,0.95)";
  ctx.font = `${46*dpr}px system-ui, -apple-system, sans-serif`;
  ctx.textAlign = "center";
  ctx.fillText(target.name, cx, cy - 18*dpr);
  ctx.restore();

  // progress small text (G->C->E->A)
  ctx.save();
  ctx.fillStyle = "rgba(152,170,204,0.95)";
  ctx.font = `${13*dpr}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace`;
  ctx.textAlign = "center";
  ctx.fillText(`TARGET: ${target.name}   (${tuneIdx+1}/4)`, cx, cy - 56*dpr);
  ctx.restore();

  // cents bar
  const barW = 360*dpr, barH = 16*dpr;
  const bx = cx - barW/2, by = cy + 24*dpr;

  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  ctx.strokeStyle = "rgba(255,255,255,0.10)";
  ctx.lineWidth = 1*dpr;
  roundRect(bx, by, barW, barH, 999*dpr, true, true);

  // center line
  ctx.strokeStyle = "rgba(34,211,238,0.35)";
  ctx.beginPath();
  ctx.moveTo(cx, by-10*dpr);
  ctx.lineTo(cx, by+barH+10*dpr);
  ctx.stroke();

  // pointer
  const px = bx + ((c + 50) / 100) * barW;
  ctx.strokeStyle = "rgba(234,240,255,0.85)";
  ctx.lineWidth = 3*dpr;
  ctx.beginPath();
  ctx.moveTo(px, by-8*dpr);
  ctx.lineTo(px, by+barH+8*dpr);
  ctx.stroke();
  ctx.restore();

  // info text
  const heard = freq ? nearestName(freq) : "—";
  const txt = freq
    ? `${freq.toFixed(1)} Hz  (${cents>=0?"+":""}${cents.toFixed(1)} cents)   heard:${heard}`
    : `音を鳴らしてください（いまは ${target.name}）`;

  ctx.save();
  ctx.fillStyle = "rgba(152,170,204,0.95)";
  ctx.font = `${13*dpr}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace`;
  ctx.textAlign = "center";
  ctx.fillText(txt, cx, by + 46*dpr);
  ctx.restore();

  // hold progress
  const p = clamp(tuneHoldMs / TUNE_NEED_MS, 0, 1);
  const pw = 360*dpr, ph = 10*dpr;
  const px0 = cx - pw/2, py0 = by + 66*dpr;

  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.06)";
  ctx.strokeStyle = "rgba(255,255,255,0.10)";
  roundRect(px0, py0, pw, ph, 999*dpr, true, true);
  ctx.fillStyle = "rgba(34,211,238,0.55)";
  roundRect(px0, py0, pw*p, ph, 999*dpr, true, false);

  ctx.fillStyle = "rgba(152,170,204,0.95)";
  ctx.font = `${12*dpr}px system-ui, -apple-system, sans-serif`;
  ctx.textAlign = "center";
  ctx.fillText(`安定チェック ${Math.round(p*100)}%`, cx, py0 + 26*dpr);
  ctx.restore();

  // footer hint
  ctx.save();
  ctx.fillStyle = "rgba(152,170,204,0.92)";
  ctx.font = `${12*dpr}px system-ui, -apple-system, sans-serif`;
  ctx.textAlign = "center";
  ctx.fillText("順番固定：G → C → E → A（1本ずつOKにして進みます）", cx, h - 22*dpr);
  ctx.restore();
}

function drawGameUI(ts){
  const w = cv.width, h = cv.height;
  const curT = running ? nowSec(ts) : 0;

  ctx.save();
  ctx.fillStyle = "rgba(234,240,255,0.90)";
  ctx.font = `${16*dpr}px system-ui, -apple-system, sans-serif`;
  ctx.fillText("STAGE 2 : PULSE GAME", 14*dpr, 28*dpr);
  ctx.fillStyle = "rgba(152,170,204,0.90)";
  ctx.font = `${13*dpr}px system-ui, -apple-system, sans-serif`;
  ctx.fillText(chartTitle, 14*dpr, 48*dpr);
  ctx.restore();

  const cx = w*0.52, cy = h*0.56;
  const pulse = running ? (Math.sin(curT * Math.PI * 2) * 0.5 + 0.5) : 0.2;

  ctx.save();
  ctx.strokeStyle = "rgba(124,92,255,0.22)";
  ctx.lineWidth = 2*dpr;
  ctx.beginPath(); ctx.arc(cx,cy, 92*dpr, 0, Math.PI*2); ctx.stroke();
  ctx.restore();

  const coreR = (26 + 12*pulse) * dpr;
  ctx.save();
  ctx.fillStyle = "rgba(124,92,255,0.18)";
  ctx.beginPath(); ctx.arc(cx,cy, coreR, 0, Math.PI*2); ctx.fill();
  ctx.strokeStyle = "rgba(34,211,238,0.33)";
  ctx.lineWidth = 2*dpr;
  ctx.beginPath(); ctx.arc(cx,cy, coreR*0.78, 0, Math.PI*2); ctx.stroke();
  ctx.restore();

  stepParticles();
  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  for(const p of particles){
    ctx.globalAlpha = 0.55 * p.life;
    ctx.beginPath(); ctx.arc(p.x,p.y, 2.2*dpr, 0, Math.PI*2); ctx.fill();
  }
  ctx.restore();

  // notes flow
  const LOOKAHEAD = 5.0, LOOKBEHIND = 1.0;
  const outerR = Math.min(w,h) * 0.42;
  const innerR = 40 * dpr;

  function radiusForTime(t){
    const dt = t - curT;
    const pp = clamp(1 - (dt/LOOKAHEAD), 0, 1);
    return outerR - pp * (outerR - innerR);
  }

  for(let i=0;i<notes.length;i++){
    const n = notes[i];
    const dt = n.t - curT;
    if(dt < -LOOKBEHIND || dt > LOOKAHEAD) continue;

    const ang = (i * 0.85) + (curT * 0.25);
    const r = radiusForTime(n.t);
    const x = cx + Math.cos(ang) * r;
    const y = cy + Math.sin(ang) * r;

    let fill = "rgba(255,255,255,0.06)";
    let stroke = "rgba(124,92,255,0.62)";
    let text = "rgba(234,240,255,0.92)";
    if(n.rank === "perfect"){ stroke="rgba(44,255,154,0.82)"; fill="rgba(44,255,154,0.14)"; }
    else if(n.rank === "great"){ stroke="rgba(34,211,238,0.75)"; fill="rgba(34,211,238,0.10)"; }
    else if(n.rank === "ok"){ stroke="rgba(124,92,255,0.78)"; fill="rgba(124,92,255,0.12)"; }
    else if(n.rank === "miss"){ stroke="rgba(255,77,109,0.82)"; fill="rgba(255,77,109,0.10)"; text="rgba(255,220,228,0.95)"; }

    drawHex(x,y, 34*dpr, fill, stroke);

    ctx.save();
    ctx.fillStyle = text;
    ctx.font = `${14*dpr}px system-ui, -apple-system, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(n.label, x, y);
    ctx.restore();
  }
}

// ===== Main loop =====
let lastHitTs = 0;

function startRun(){
  resultOverlay.classList.remove("show");
  resultOverlay.setAttribute("aria-hidden","true");

  stage = STAGE.TUNING;
  resetTuning();
  resetGame();

  running = true;
  startTs = performance.now();
  lastHitTs = 0;

  btnStart.disabled = true;
  btnStop.disabled = false;

  showComic("STAGE 1", "TUNING  (G→C→E→A)", true);
  setStatus("開始：STAGE 1 チューニング（Gから）");
  beep(880, 120, "triangle", 0.06);

  loop();
}

function stopRun(){
  running = false;
  btnStart.disabled = false;
  btnStop.disabled = true;
  setStatus("停止");
}

function loop(ts){
  if(!running) return;

  const rms = getRms();
  const level = clamp(rms / 0.12, 0, 1);
  meterBar.style.width = `${Math.round(level*100)}%`;
  meterTxt.textContent = rms.toFixed(3);

  ctx.clearRect(0,0,cv.width,cv.height);
  drawBackground();

  if(stage === STAGE.TUNING){
    const freq = detectPitchHz(dataTime, sampleRate);

    const now = performance.now();
    if(!lastTuneTs) lastTuneTs = now;
    const dt = now - lastTuneTs;
    lastTuneTs = now;

    const target = TUNING_TARGETS[tuneIdx];

    if(freq){
      const cents = freqToCents(freq, target.freq);
      const abs = Math.abs(cents);

      if(abs <= TUNE_TOL_CENTS){
        tuneHoldMs += dt;
        if(tuneHoldMs > 240 && Math.abs(tuneHoldMs % 420) < 30) beep(780, 35, "sine", 0.02);
      }else{
        tuneHoldMs = Math.max(0, tuneHoldMs - dt*1.9);
      }
    }else{
      tuneHoldMs = Math.max(0, tuneHoldMs - dt*2.2);
    }

    drawTuningUI(freq);

    if(tuneHoldMs >= TUNE_NEED_MS){
      // string cleared
      const cleared = TUNING_TARGETS[tuneIdx].name;
      tuneHoldMs = 0;

      if(tuneIdx < 3){
        tuneIdx += 1;
        const next = TUNING_TARGETS[tuneIdx].name;
        showComic("BAM!", `${cleared} OK!  NEXT: ${next}`, false);
        beep(980, 90, "triangle", 0.06);
        setStatus(`チューニングOK：${cleared} → 次は ${next}`);
      }else{
        // all clear -> stage 2
        showComic("STAGE 2", "PULSE GAME  START!", true);
        beep(1040, 140, "triangle", 0.07);
        setStatus("STAGE 2：中心で鳴らしてコンボを繋ぐ！");

        // switch after splash
        setTimeout(() => {
          if(!running) return;
          stage = STAGE.GAME;
          startTs = performance.now();
        }, 700);
      }
    }

  }else{
    const curT = nowSec(ts);

    const canHit = (performance.now() - lastHitTs) > 120;
    const didStrum = isStrum(rms) && canHit;
    if(didStrum){
      lastHitTs = performance.now();
      spawnBurst(cv.width*0.52, cv.height*0.56, 1.0);
    }

    judgeAtTime(curT, didStrum);
    drawGameUI(ts);

    if(life <= 0.001){
      setStatus("GAME OVER");
      running = false;
      btnStart.disabled = false;
      btnStop.disabled = true;
      showComic("OUCH!", "次はキャリブレーションして再挑戦だ！");
      openResult();
      return;
    }

    const lastT = notes.length ? notes[notes.length-1].t : 0;
    if(curT > lastT + 2.5){
      running = false;
      btnStart.disabled = false;
      btnStop.disabled = true;
      setStatus("終了（RESULT）");
      showComic("POW!", "ナイス！リザルト！");
      openResult();
      return;
    }
  }

  updateComic();
  rafId = requestAnimationFrame(loop);
}

// ===== Buttons =====
btnLoad.addEventListener("click", loadChart);
btnMic.addEventListener("click", async () => {
  const ok = await initMic();
  if(ok){
    btnCal.disabled = false;
    btnStart.disabled = !chartLoaded;
  }
});
btnCal.addEventListener("click", calibrate);
btnStart.addEventListener("click", () => {
  if(audioCtx) audioCtx.resume().catch(()=>{});
  if(!chartLoaded){ setStatus("先にパターン読み込み"); return; }
  if(!analyser){ setStatus("先にマイク許可"); return; }
  if(!calibrated){ setStatus("キャリブレーション推奨（動きますが精度UP）"); }
  startRun();
});
btnStop.addEventListener("click", stopRun);

btnRestart.addEventListener("click", () => {
  resultOverlay.classList.remove("show");
  resultOverlay.setAttribute("aria-hidden","true");
  if(audioCtx) audioCtx.resume().catch(()=>{});
  startRun();
});
btnCloseResult.addEventListener("click", () => {
  resultOverlay.classList.remove("show");
  resultOverlay.setAttribute("aria-hidden","true");
});

// ===== Init =====
applyDifficulty(diffSelect.value);
recomputeTrigger();
setLife(1.0);
setHUD();
setStatus("待機中：パターン読み込み → マイク許可 → キャリブレーション → 開始");
