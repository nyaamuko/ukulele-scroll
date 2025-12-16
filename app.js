// app.js
// =====================================================
// マイク入力 → ピッチ推定（簡易オートコリレーション）
// 4弦G/3弦C/2弦A/1弦E のチューニング必須ゲート
// STAGE表示は最低1.6秒（早すぎ防止）
// STAGE1：1弦E を鳴らしてクリア
// =====================================================

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
const TOLERANCE_CENTS = 20;     // ±20 cents
const HOLD_MS = 350;            // 0.35秒安定でOK
const MIN_RMS = 0.018;          // 無音/ノイズ除外（環境で調整）
const MIN_HZ = 60;
const MAX_HZ = 1200;

// ---- state
const tuningState = UKE_STRINGS.map(s => ({
  ...s,
  ok: false,
  lastOkStartMs: null,
  lastHz: null,
  lastCents: null,
}));

let selectedIndex = 0;      // 今調整している弦（タップで切替）
let stageMode = "TUNING";   // "TUNING" | "STAGE1"
let stage1Cleared = false;

// ---- audio
let audioCtx = null;
let analyser = null;
let micStream = null;
let rafId = null;

const bufferLen = 2048;
const timeData = new Float32Array(bufferLen);

// ----------------------------
// UI: build tuning rows
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
// Banner: readable stage text
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

  // 最低保持 1.6秒
  setTimeout(() => {
    banner.style.transition = "opacity 0.45s linear";
    banner.style.opacity = "0";
    setTimeout(() => {
      banner.style.display = "none";
    }, 500);
  }, 1600);
}

// ----------------------------
// Pitch detection (autocorrelation)
// ----------------------------
function computeRMS(buf) {
  let sum = 0;
  for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
  return Math.sqrt(sum / buf.length);
}

// returns Hz or null
function autoCorrelatePitch(buf, sampleRate) {
  // very simple autocorrelation
  const n = buf.length;

  // Remove DC offset
  let mean = 0;
  for (let i = 0; i < n; i++) mean += buf[i];
  mean /= n;

  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = buf[i] - mean;

  // Search range
  const minLag = Math.floor(sampleRate / MAX_HZ);
  const maxLag = Math.floor(sampleRate / MIN_HZ);

  let bestLag = -1;
  let bestCorr = 0;

  // Normalize energy
  let energy = 0;
  for (let i = 0; i < n; i++) energy += x[i] * x[i];
  if (energy < 1e-8) return null;

  for (let lag = minLag; lag <= maxLag; lag++) {
    let corr = 0;
    for (let i = 0; i < n - lag; i++) {
      corr += x[i] * x[i + lag];
    }
    corr = corr / energy;

    if (corr > bestCorr) {
      bestCorr = corr;
      bestLag = lag;
    }
  }

  // confidence threshold
  if (bestLag < 0 || bestCorr < 0.18) return null;

  // Parabolic interpolation for smoother Hz
  // y(-1), y(0), y(+1)
  const lag = bestLag;
  const y0 = corrAtLag(x, energy, lag);
  const y1 = corrAtLag(x, energy, lag - 1);
  const y2 = corrAtLag(x, energy, lag + 1);

  const denom = (2 * y0 - y1 - y2);
  let shift = 0;
  if (Math.abs(denom) > 1e-6) {
    shift = 0.5 * (y2 - y1) / denom;
  }

  const refinedLag = lag + shift;
  const hz = sampleRate / refinedLag;

  if (!Number.isFinite(hz) || hz < MIN_HZ || hz > MAX_HZ) return null;
  return hz;
}

function corrAtLag(x, energy, lag) {
  if (lag <= 0 || lag >= x.length) return 0;
  let c = 0;
  for (let i = 0; i < x.length - lag; i++) c += x[i] * x[i + lag];
  return c / energy;
}

// ----------------------------
// Tuning logic
// ----------------------------
function applyTuning(freqHz, nowMs) {
  const s = tuningState[selectedIndex];
  const cd = centsDiff(freqHz, s.hz);

  s.lastHz = freqHz;
  s.lastCents = cd;

  const within = Math.abs(cd) <= TOLERANCE_CENTS;

  // UI quick status
  hzText.textContent = `${freqHz.toFixed(2)}`;
  centsText.textContent = `${cd.toFixed(1)}`;
  judgeText.textContent = within ? "OK範囲" : (cd > 0 ? "高い（締めすぎ）" : "低い（緩い）");

  // Confirm hold
  if (!s.ok) {
    if (within) {
      if (s.lastOkStartMs == null) s.lastOkStartMs = nowMs;
      if (nowMs - s.lastOkStartMs >= HOLD_MS) {
        s.ok = true;
        s.lastOkStartMs = null;

        // 次の未OKへ自動移動
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

// ----------------------------
// Stage1 logic: require E
// ----------------------------
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
// Audio loop
// ----------------------------
function loop() {
  if (!analyser || !audioCtx) return;

  analyser.getFloatTimeDomainData(timeData);

  const rms = computeRMS(timeData);
  const level = Math.min(1, Math.max(0, (rms - 0.005) / 0.06));
  levelBar.style.width = `${(level * 100).toFixed(0)}%`;

  const nowMs = performance.now();

  if (rms >= MIN_RMS) {
    const hz = autoCorrelatePitch(timeData, audioCtx.sampleRate);
    if (hz) {
      if (stageMode === "TUNING") {
        applyTuning(hz, nowMs);
      } else if (stageMode === "STAGE1") {
        stage1Check(hz);
      }
    } else {
      // Not confident
      hzText.textContent = "--";
      centsText.textContent = "--";
      judgeText.textContent = "検出中…（単音で）";
    }
  } else {
    hzText.textContent = "--";
    centsText.textContent = "--";
    judgeText.textContent = "小さすぎ（近づけて）";
  }

  rafId = requestAnimationFrame(loop);
}

// ----------------------------
// Start/Stop mic
// ----------------------------
async function startMic() {
  micBtn.disabled = true;
  micBtn.textContent = "🎤 起動中…";

  try {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      }
    });

    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const src = audioCtx.createMediaStreamSource(micStream);

    analyser = audioCtx.createAnalyser();
    analyser.fftSize = bufferLen;
    analyser.smoothingTimeConstant = 0.0;

    src.connect(analyser);

    micStopBtn.disabled = false;
    micBtn.textContent = "🎤 マイク稼働中";
    judgeText.textContent = "検出中…（単音で）";

    // begin loop
    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(loop);
  } catch (e) {
    console.error(e);
    micBtn.disabled = false;
    micBtn.textContent = "🎤 マイク開始";
    judgeText.textContent = "マイク許可が必要です";
    alert("マイクの許可が必要です。ブラウザの設定から許可してください。");
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
  levelBar.style.width = "0%";
  hzText.textContent = "--";
  centsText.textContent = "--";
  judgeText.textContent = "--";

  micBtn.disabled = false;
  micBtn.textContent = "🎤 マイク開始";
}

// ----------------------------
// Stage controls
// ----------------------------
function startStage1() {
  stageMode = "STAGE1";
  stage1Cleared = false;
  stageResult.textContent = "";
  stage.classList.remove("hidden");
  stageTitle.textContent = "STAGE 1";
  stageText.textContent = "1弦 E を鳴らしてみよう（±20centsでクリア）";
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

  // 読めるステージ表示（早すぎ防止）
  showBanner("STAGE 1\nひとつの音を鳴らしてみよう");

  // ステージ開始は少し遅らせる
  setTimeout(() => {
    startStage1();
  }, 1800);
});

retryBtn.addEventListener("click", () => {
  showBanner("STAGE 1\nもう一度いきましょう");
  setTimeout(() => {
    resetStage1();
  }, 1800);
});

// ページ離脱時に止める
window.addEventListener("beforeunload", () => {
  try { stopMic(); } catch {}
});
