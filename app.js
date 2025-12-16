// app.js (STAGE2 静的モック)
// notes.json から STAGE2_CODES / STAGE2_PHASES を読み込みます。
// ※これが読めていないと「背景文字」「指位置」が生成されません。

let data = null;
let idx = 0;
let phaseIdx = 0;

const bgCode = document.getElementById("bgCode");
const codeLabel = document.getElementById("codeLabel");
const stringsGrid = document.getElementById("stringsGrid");

const prevBtn = document.getElementById("prevBtn");
const nextBtn = document.getElementById("nextBtn");

const phaseTitle = document.getElementById("phaseTitle");
const phaseText = document.getElementById("phaseText");
const phaseBtn = document.getElementById("phaseBtn");

const toggleOverlayBtn = document.getElementById("toggleOverlayBtn");
const toggleWobbleBtn = document.getElementById("toggleWobbleBtn");

const timerValue = document.getElementById("timerValue");
const debug = document.getElementById("debug");

function setDebug(msg){ debug.textContent = msg || ""; }

function render() {
  const item = data.STAGE2_CODES[idx];

  bgCode.textContent = item.code;
  codeLabel.textContent = item.code;

  stringsGrid.innerHTML = "";
  item.strings.forEach((s) => {
    const row = document.createElement("div");
    row.className = "stringRow";

    const line = document.createElement("div");
    line.className = "stringLine";

    const label = document.createElement("div");
    label.className = "stringLabel";
    label.innerHTML = `${s.name}<small>${s.note}</small>`;

    const fingers = document.createElement("div");
    fingers.className = "fingers";

    s.dots.forEach(d => {
      const dot = document.createElement("div");
      dot.className = "dot";
      if (d.type === "on") dot.classList.add("on");
      if (d.type === "open") dot.classList.add("open");
      dot.textContent = d.label ?? "";
      fingers.appendChild(dot);
    });

    row.appendChild(label);
    row.appendChild(fingers);
    row.appendChild(line);
    stringsGrid.appendChild(row);
  });

  renderPhase();
  setDebug(`OK: notes.json 読み込み成功 / CODE=${item.code}`);
}

function renderPhase() {
  const ph = data.STAGE2_PHASES[phaseIdx];
  phaseTitle.textContent = ph.title;
  phaseText.textContent = ph.text;
  timerValue.textContent = Number(ph.seconds).toFixed(1);
}

async function init(){
  try{
    const res = await fetch("./notes.json", { cache: "no-store" });
    if(!res.ok) throw new Error(`notes.json fetch failed: ${res.status}`);
    data = await res.json();

    if(!data.STAGE2_CODES || !data.STAGE2_PHASES) {
      throw new Error("notes.json に STAGE2_CODES / STAGE2_PHASES がありません");
    }
    render();
  }catch(e){
    console.error(e);
    setDebug("ERROR: " + e.message);
    phaseText.textContent = "読み込み失敗（notes.json / GitHub Pages 反映を確認）";
  }
}

prevBtn.addEventListener("click", () => {
  if(!data) return;
  idx = (idx - 1 + data.STAGE2_CODES.length) % data.STAGE2_CODES.length;
  render();
});
nextBtn.addEventListener("click", () => {
  if(!data) return;
  idx = (idx + 1) % data.STAGE2_CODES.length;
  render();
});
phaseBtn.addEventListener("click", () => {
  if(!data) return;
  phaseIdx = (phaseIdx + 1) % data.STAGE2_PHASES.length;
  renderPhase();
  setDebug(`PHASE=${phaseIdx+1}/${data.STAGE2_PHASES.length}`);
});
toggleOverlayBtn.addEventListener("click", () => {
  stringsGrid.classList.toggle("strong");
});
toggleWobbleBtn.addEventListener("click", () => {
  bgCode.classList.toggle("wobble");
});

init();
