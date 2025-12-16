// app.js（FIX版：前回の動いた initMic 方式に寄せる）
// -----------------------------------------------------
// 目的：まず「レベルバーが動く＝音が入ってる」を確実にする
// その上でピッチ検出→チューニング→STAGE1へ
// -----------------------------------------------------

// ---- UI refs
const micBtn = document.getElementById("micBtn");
const micStopBtn = document.getElementById("micStopBtn");
const levelBar = document.getElementById("levelBar");
const hzText = document.getElementById("hzText");
const centsText = document.getElementById("centsText");
const judgeText = document.getElementById("judgeText");

const stringsWrap = document.getElementById("strings");
const startBtn = document.getElementById("startBtn");

const banner = document.getElementById("stageBanner");
const stage = document.getElementById("stage");
const stageTitle = document.getElementById("stageTitle");
const stageText = document.getElementById("stageText");
const stageResult = document.getElementById("stageResult");
const retryBtn = document.getElementById("retryBtn");

// ---- tuning params
const TOLERANCE_CENTS = 25;
const HOLD_MS = 300;

// レベル表示（反応しない対策でかなり甘く）
const MIN_RMS_FOR_LEVEL = 0.0005;   // これ以下でもバーは少し動くようにする
const MIN_RMS_FOR_PITCH = 0.0045;   // ピッチ推定に入る最低ライン

const MIN_HZ = 60;
const MAX_HZ = 1200;

// ---- state
const tuningState = UKE_STRINGS.map(s => ({
  ...s,
  ok: false,
  lastOkStartMs: null,
}));
let selectedIndex = 0;

let stageMode = "TUNING"; // "TUNING" | "STAGE1"
let stage1Cleared = false;

// ---- audio
let audioCtx = null;
let analyser = null;
let micStream = null;
let rafId = null;

const FFT_SIZE = 2048;
let dataTime = null;

// ----------------------------
// UI
// ----------------------------
function renderStrings() {
  stringsWrap.innerHTML = "";
  tuningState.forEach((s, i) => {
    const row = document.createElement("div");
    row.className = "stringRow" + (i === selectedIndex ? " selected" : "") + (s.ok ? " tuned" : "");
    row.addEventListener("click", () => {
      selectedIndex = i;
      renderStrings();
    });

    const left = document.createElement("div");
    left.className = "stringLeft";

    const name = document.createElement("div");
    name.className = "stringName";
    name.textContent = s.label;

    const meta = document.createElement("div");
    meta.className = "stringMeta";
    meta.textContent = `目標 ${s.hz.toFixed(2)} Hz / 許容 ±${TOLERANCE_CENTS} cents`;

    left.appendChild(name);
    left.appendChild(meta);

    const badges = document.createElement("div");
    badges.className = "badges";

    const sel = document.createElement("div");
    sel.className = "badge sel";
    sel.textContent = (i === selectedIndex) ? "今ここ" : "切替";

    const ok = document.createElement("div");
    ok.className = "badge " + (s.ok ? "ok" : "ng");
    ok.textContent = s.ok ? "OK" : "未";

    badges.appendChild(sel);
    badges.appendChild(ok);

    row.appendChild(left);
    row.appendChild(badges);
    stringsWrap.appendChild(row);
  });
}

function allTuned() {
  return tuningState.every(s => s.ok);
}
function updateStartButton() {
  const ready = allTuned();
  startBtn.disabled = !ready;
  startBtn.textContent = ready ? "START" : "START（チューニング完了で解除）";
}

// ----------------------------
// Banner
// ----------------------------
function showBanner(text) {
  banner.style.display = "flex";
  banner.style.transition = "none";
  banner.style.opacity = "0";
  banner.textContent = text;
  requestAnimationFrame(() => {
    banner.style.transition = "opacity 0.35s linear";
    banner.style.opacity = "1";
  });
  setTimeout(() => {
    banner.style.transition = "opacity 0.45s linear";
    banner.style.opacity = "0";
    setTimeout(() => (banner.style.display = "none"), 520);
  }, 1600);
}

// ----------------------------
// RMS（前回方式：getFloatTimeDomainDataで取る）
// ----------------------------
function getRms() {
  if (!analyser) return 0;
  analyser.getFloatTimeDomainData(dataTime);
  let sum = 0;
  for (let i = 0; i < dataTime.length; i++) {
    const v = dataTime[i];
    sum += v * v;
  }
  return Math.sqrt(sum / dataTime.length);
}

// ----------------------------
// Pitch detection (autocorrelation) ※簡易
// ----------------------------
function autoCorrelatePitch(buf, sampleRate) {
  const n = buf.length;

  // DC除去
  let mean = 0;
  for (let i = 0; i < n; i++) mean += buf[i];
  mean /= n;

  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = buf[i] - mean;

  const minLag = Math.floor(sampleRate / MAX_HZ);
  const maxLag = Math.floor(sampleRate / MIN_HZ);

  let bestLag = -1;
  let bestCorr = 0;

  let energy = 0;
  for (let i = 0; i < n; i++) energy += x[i] * x[i];
  if (energy < 1e-8) return null;

  for (let lag = minLag; lag <= maxLag; lag++) {
    let corr = 0;
    for (let i = 0; i < n - lag; i++) corr += x[i] * x[i + lag];
    corr = corr / energy;
    if (corr > bestCorr) {
      bestCorr = corr;
      bestLag = lag;
    }
  }

  // 信頼度しきい値（少し甘く）
  if (bestLag < 0 || bestCorr < 0.14) return null;

  const hz = sampleRate / bestLag;
  if (!Number.isFinite(hz) || hz < MIN_HZ || hz > MAX_HZ) return null;
  return hz;
}

// ----------------------------
// 判定
// ----------------------------
function applyTuning(freqHz, nowMs) {
  const s = tuningState[selectedIndex];
  const cd = centsDiff(freqHz, s.hz);
  const within = Math.abs(cd) <= TOLERANCE_CENTS;

  hzText.textContent = `${freqHz.toFixed(2)}`;
  centsText.textContent = `${cd.toFixed(1)}`;
  judgeText.textContent = within ? "OK範囲" : (cd > 0 ? "高い（締めすぎ）" : "低い（緩い）");

  if (!s.ok) {
    if (within) {
      if (s.lastOkStartMs == null) s.lastOkStartMs = nowMs;
      if (nowMs - s.lastOkStartMs >= HOLD_MS) {
        s.ok = true;
        s.lastOkStartMs = null;

        const next = tuningState.findIndex(x => !x.ok);
        if (next >= 0) selectedIndex = next;

        renderStrings();
        updateStartButton();
      }
    } else {
      s.lastOkStartMs = null;
    }
  }
}

function stage1Check(freqHz) {
  if (stage1Cleared) return;
  const target = UKE_STRINGS.find(x => x.key === "E");
  const cd = centsDiff(freqHz, target.hz);
  const within = Math.abs(cd) <= TOLERANCE_CENTS;

  hzText.textContent = `${freqHz.toFixed(2)}`;
  centsText.textContent = `${cd.toFixed(1)}`;
  judgeText.textContent = within ? "E クリア！" : "Eを狙おう";

  if (within) {
    stage1Cleared = true;
    stageResult.textContent = "✅ いい音です！ STAGE 1 クリア ⭐";
  }
}

// ----------------------------
// ループ（まずレベルバーを確実に動かす）
// ----------------------------
function loop() {
  if (!analyser || !audioCtx) return;

  const rms = getRms();

  // レベル表示：とにかく動かす（0でも少しだけ出るように）
  const scaled = Math.min(1, Math.max(0, (rms - MIN_RMS_FOR_LEVEL) / 0.03));
  levelBar.style.width = `${(scaled * 100).toFixed(0)}%`;

  // ピッチ判定は、ある程度音が入ったときだけ
  if (rms < MIN_RMS_FOR_PITCH) {
    hzText.textContent = "--";
    centsText.textContent = "--";
    judgeText.textContent = "入力中…（単音でゆっくり）";
    rafId = requestAnimationFrame(loop);
    return;
  }

  // analyserの中身（dataTime）からピッチ推定
  const hz = autoCorrelatePitch(dataTime, audioCtx.sampleRate);

  if (!hz) {
    hzText.textContent = "--";
    centsText.textContent = "--";
    judgeText.textContent = "検出中…（単音で）";
  } else {
    const nowMs = performance.now();
    if (stageMode === "TUNING") applyTuning(hz, nowMs);
    else if (stageMode === "STAGE1") stage1Check(hz);
  }

  rafId = requestAnimationFrame(loop);
}

// ----------------------------
// マイク開始（前回方式に寄せる：resume → getUserMedia）
// ----------------------------
async function startMic() {
  micBtn.disabled = true;
  micBtn.textContent = "🎤 起動中…";
  judgeText.textContent = "マイク要求中…";

  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }

    // iOS対策：ユーザー操作中にresume
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
    analyser.fftSize = FFT_SIZE;
    dataTime = new Float32Array(analyser.fftSize);

    src.connect(analyser);

    micStopBtn.disabled = false;
    micBtn.textContent = "🎤 マイク稼働中";
    judgeText.textContent = "検出中…（単音で）";

    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(loop);

  } catch (e) {
    console.error(e);
    micBtn.disabled = false;
    micBtn.textContent = "🎤 マイク開始";
    judgeText.textContent = "マイクNG（許可/https/デバイス）";
    alert("マイクが使えません。\n・マイク許可\n・https または localhost\n・入力デバイス選択\nを確認してください。");
  }
}

function stopMic() {
  micStopBtn.disabled = true;

  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }

  if (micStream) {
    micStream.getTracks().forEach(t => t.stop());
    micStream = null;
  }

  if (audioCtx) {
    audioCtx.close().catch(() => {});
    audioCtx = null;
  }

  analyser = null;
  dataTime = null;

  levelBar.style.width = "0%";
  hzText.textContent = "--";
  centsText.textContent = "--";
  judgeText.textContent = "--";

  micBtn.disabled = false;
  micBtn.textContent = "🎤 マイク開始";
}

// ----------------------------
// Stage
// ----------------------------
function startStage1() {
  stageMode = "STAGE1";
  stage1Cleared = false;
  stageResult.textContent = "";
  stage.classList.remove("hidden");
  stageTitle.textContent = "STAGE 1";
  stageText.textContent = "1弦 E を鳴らしてみよう（±25centsでクリア）";
  judgeText.textContent = "Eを狙おう";
}

function resetStage1() {
  stage1Cleared = false;
  stageResult.textContent = "";
  judgeText.textContent = "Eを狙おう";
}

// ----------------------------
// Init / events
// ----------------------------
renderStrings();
updateStartButton();

micBtn.addEventListener("click", startMic);
micStopBtn.addEventListener("click", stopMic);

startBtn.addEventListener("click", () => {
  if (!allTuned()) {
    showBanner("TUNING REQUIRED\n4弦すべてOKで解除");
    return;
  }
  showBanner("STAGE 1\nひとつの音を鳴らしてみよう");
  setTimeout(() => startStage1(), 1800);
});

retryBtn.addEventListener("click", () => {
  showBanner("STAGE 1\nもう一度いきましょう");
  setTimeout(() => resetStage1(), 1800);
});

window.addEventListener("beforeunload", () => {
  try { stopMic(); } catch {}
});
