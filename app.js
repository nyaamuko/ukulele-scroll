// Ukulele Scroll Trainer (Web MVP)
// - 左→右スクロール譜面（Canvas）
// - マイク入力（WebAudio）で「鳴らしたタイミング」を判定
// - コード自体の和音判定はしない（MVPとして現実的）

const cv = document.getElementById("cv");
const ctx = cv.getContext("2d");

const btnLoad = document.getElementById("btnLoad");
const btnMic  = document.getElementById("btnMic");
const btnStart= document.getElementById("btnStart");
const btnStop = document.getElementById("btnStop");

const thSlider = document.getElementById("thSlider");
const thVal = document.getElementById("thVal");
const winSlider = document.getElementById("winSlider");
const winVal = document.getElementById("winVal");

const statusEl = document.getElementById("status");
const scoreEl = document.getElementById("score");

let dpr = 1;
function resizeCanvas(){
  const rect = cv.getBoundingClientRect();
  dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
  cv.width = Math.floor(rect.width * dpr);
  cv.height = Math.floor(rect.height * dpr);
}
window.addEventListener("resize", resizeCanvas);
resizeCanvas();

// ---- 譜面データ ----
let chartTitle = "No Chart";
let notes = []; // {t,label, judged:false, result:null}
let chartLoaded = false;

// ---- 再生状態 ----
let running = false;
let startTs = 0; // performance.now()
let rafId = null;

// 判定ライン（画面の55%）に合わせる
function judgeX(){ return cv.width * 0.55; }

// スクロール速度：何秒先を画面に表示するか
const LOOKAHEAD = 5.0; // 秒（画面右端に見える未来）
const LOOKBEHIND = 2.0; // 秒（画面左に消える過去）

// ---- マイク（Web Audio） ----
let audioCtx = null;
let analyser = null;
let micStream = null;
let dataTime = null;

let lastHitTs = 0;
let ok = 0, ng = 0;

// しきい値：環境で変わるのでスライダで調整
let threshold = parseInt(thSlider.value, 10); // 2..20
let windowMs  = parseInt(winSlider.value, 10); // 80..400

thSlider.addEventListener("input", () => {
  threshold = parseInt(thSlider.value, 10);
  thVal.textContent = String(threshold);
});
winSlider.addEventListener("input", () => {
  windowMs = parseInt(winSlider.value, 10);
  winVal.textContent = String(windowMs);
});

function setStatus(text){ statusEl.textContent = text; }
function setScore(){ scoreEl.textContent = `OK: ${ok} / NG: ${ng}`; }

// RMS（音量）を計算して、ストローク検出（簡易）
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

// 適当に正規化（経験的な目安）
function isStrum(rms){
  // しきい値をスライダで調整：小さいほど反応しやすい
  // iPhoneのマイクは環境差大きいので、ここはユーザー調整が前提
  const scaled = rms * 1000; // だいたい 0〜数十
  return scaled > threshold;
}

async function initMic(){
  try{
    if(!audioCtx){
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    // iOSはユーザー操作の中でresumeが必要
    await audioCtx.resume();

    micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      },
      video: false
    });

    const src = audioCtx.createMediaStreamSource(micStream);
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 2048;
    dataTime = new Float32Array(analyser.fftSize);

    src.connect(analyser);

    setStatus("マイクOK（スタート可能）");
    btnStart.disabled = !chartLoaded;
    return true;
  }catch(e){
    console.error(e);
    setStatus("マイクNG：許可されていない/httpsでない可能性");
    return false;
  }
}

// ---- 譜面読み込み ----
async function loadChart(){
  try{
    const res = await fetch("./notes.json", { cache: "no-store" });
    if(!res.ok) throw new Error("notes.json fetch failed");
    const json = await res.json();

    chartTitle = json.title || "Untitled";
    notes = (json.notes || []).map(n => ({
      t: Number(n.t),
      label: String(n.label || ""),
      judged: false,
      result: null
    }));
    chartLoaded = notes.length > 0;
    setStatus(`譜面OK：${chartTitle}（${notes.length}ノート）`);
    btnStart.disabled = !chartLoaded || !analyser;
  }catch(e){
    console.error(e);
    setStatus("譜面NG：notes.jsonが読めません");
  }
}

// ---- スタート/停止 ----
function resetRun(){
  running = false;
  ok = 0; ng = 0;
  setScore();
  notes.forEach(n => { n.judged=false; n.result=null; });
}

function start(){
  if(!chartLoaded){ setStatus("先に譜面読み込み"); return; }
  if(!analyser){ setStatus("先にマイク許可"); return; }

  resetRun();
  running = true;
  startTs = performance.now();
  lastHitTs = 0;
  btnStart.disabled = true;
  btnStop.disabled = false;
  setStatus("再生中：判定ラインで鳴らす！");
  loop();
}

function stop(){
  running = false;
  btnStart.disabled = false;
  btnStop.disabled = true;
  setStatus("停止");
  if(rafId) cancelAnimationFrame(rafId);
  rafId = null;
  draw(performance.now()); // 最終描画
}

// ---- 判定ロジック ----
function nowSec(ts){
  return (ts - startTs) / 1000.0;
}

function judgeAtTime(curT, didStrum){
  const win = windowMs / 1000.0;

  // まだ判定していないノートで、近いものを探す（最短距離）
  let bestIdx = -1;
  let bestDt = 1e9;

  for(let i=0;i<notes.length;i++){
    const n = notes[i];
    if(n.judged) continue;
    const dt = Math.abs(n.t - curT);
    if(dt < bestDt){
      bestDt = dt;
      bestIdx = i;
    }
  }

  // ストロークがあったら、窓内ならOK、それ以外は無視（連打防止あり）
  if(didStrum && bestIdx >= 0 && bestDt <= win){
    notes[bestIdx].judged = true;
    notes[bestIdx].result = "ok";
    ok++;
    setScore();
    flash("ok");
  }

  // 時間が過ぎたノートはNG確定（窓を超えたら）
  for(const n of notes){
    if(n.judged) continue;
    if(curT - n.t > win){
      n.judged = true;
      n.result = "ng";
      ng++;
      setScore();
      flash("ng");
    }
  }
}

// 画面フラッシュ（軽い演出）
let flashState = null; // {type, until}
function flash(type){
  flashState = { type, until: performance.now() + 160 };
}

// ---- 描画 ----
function draw(ts){
  const w = cv.width, h = cv.height;
  ctx.clearRect(0,0,w,h);

  // 背景グリッド
  ctx.save();
  ctx.globalAlpha = 0.25;
  ctx.strokeStyle = "rgba(255,255,255,0.10)";
  ctx.lineWidth = 1 * dpr;
  const step = 36 * dpr;
  for(let x=0;x<w;x+=step){
    ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,h); ctx.stroke();
  }
  for(let y=0;y<h;y+=step){
    ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(w,y); ctx.stroke();
  }
  ctx.restore();

  const curT = running ? nowSec(ts) : 0;

  // 上部タイトル
  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.font = `${14*dpr}px system-ui, -apple-system, sans-serif`;
  ctx.fillText(chartTitle, 12*dpr, 24*dpr);
  ctx.restore();

  // タイム→X変換：判定ラインが「現在時刻」
  const xJudge = judgeX();
  const tLeft  = curT - LOOKBEHIND;
  const tRight = curT + LOOKAHEAD;
  const pxPerSec = (w * 0.85) / (LOOKAHEAD + LOOKBEHIND); // 表示幅
  function xForTime(t){
    // curT の位置が xJudge
    return xJudge + (t - curT) * pxPerSec;
  }

  // ノート描画
  const laneY = h * 0.58;
  const noteH = 46 * dpr;
  const radius = 14 * dpr;

  for(const n of notes){
    if(n.t < tLeft || n.t > tRight) continue;
    const x = xForTime(n.t);

    // 状態により色味
    let fill = "rgba(255,255,255,0.10)";
    let stroke = "rgba(77,163,255,0.65)";
    let labelCol = "rgba(234,240,255,0.92)";

    if(n.result === "ok"){
      stroke = "rgba(85,255,154,0.85)";
      fill = "rgba(85,255,154,0.18)";
    }else if(n.result === "ng"){
      stroke = "rgba(255,90,116,0.85)";
      fill = "rgba(255,90,116,0.14)";
      labelCol = "rgba(255,210,216,0.95)";
    }

    // ノート本体（丸角）
    roundRect(ctx, x - 44*dpr, laneY - noteH/2, 88*dpr, noteH, radius, fill, stroke);

    // ラベル
    ctx.save();
    ctx.fillStyle = labelCol;
    ctx.font = `${20*dpr}px system-ui, -apple-system, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(n.label, x, laneY);
    ctx.restore();
  }

  // 下部の時間表示
  ctx.save();
  ctx.fillStyle = "rgba(155,176,208,0.9)";
  ctx.font = `${12*dpr}px system-ui, -apple-system, sans-serif`;
  const tText = running ? `t = ${curT.toFixed(2)}s` : "t = 0.00s";
  ctx.fillText(tText, 12*dpr, h - 16*dpr);
  ctx.restore();

  // フラッシュ演出
  if(flashState && performance.now() < flashState.until){
    ctx.save();
    ctx.globalAlpha = 0.10;
    ctx.fillStyle = (flashState.type === "ok") ? "#55ff9a" : "#ff5a74";
    ctx.fillRect(0,0,w,h);
    ctx.restore();
  }else{
    flashState = null;
  }
}

function roundRect(ctx, x,y,w,h,r, fill, stroke){
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x+r, y);
  ctx.arcTo(x+w, y, x+w, y+h, r);
  ctx.arcTo(x+w, y+h, x, y+h, r);
  ctx.arcTo(x, y+h, x, y, r);
  ctx.arcTo(x, y, x+w, y, r);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 2 * dpr;
  ctx.stroke();
  ctx.restore();
}

// ---- メインループ ----
function loop(ts){
  if(!running) return;

  // 描画
  draw(ts);

  // ストローク検出（簡易：RMSで閾値超え）
  const rms = getRms();
  const hit = isStrum(rms);

  // 連打防止（最低120ms間隔）
  const now = performance.now();
  const canHit = (now - lastHitTs) > 120;
  const didStrum = hit && canHit;

  if(didStrum) lastHitTs = now;

  // 判定
  const curT = nowSec(ts);
  judgeAtTime(curT, didStrum);

  // 終了条件：最後のノートから一定時間
  const lastT = notes.length ? notes[notes.length-1].t : 0;
  if(curT > lastT + 2.5){
    setStatus("終了（おつかれさま！）");
    stop();
    return;
  }

  rafId = requestAnimationFrame(loop);
}

// ---- ボタン ----
btnLoad.addEventListener("click", loadChart);
btnMic.addEventListener("click", initMic);
btnStart.addEventListener("click", start);
btnStop.addEventListener("click", stop);

// 初期表示
thVal.textContent = String(threshold);
winVal.textContent = String(windowMs);
setScore();
setStatus("まず「譜面読み込み」→「マイク許可」→「スタート」");
