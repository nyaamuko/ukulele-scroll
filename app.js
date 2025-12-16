// app.js
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

function render() {
  const item = STAGE2_CODES[idx];
  bgCode.textContent = item.code;
  codeLabel.textContent = item.code;

  // 背景はデフォで “ふわふわON”
  if (!bgCode.classList.contains("wobble")) bgCode.classList.add("wobble");

  // 弦グリッド生成
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

    // 4つの点（フレット位置イメージ）
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
}

function renderPhase() {
  const ph = STAGE2_PHASES[phaseIdx];
  phaseTitle.textContent = ph.title;
  phaseText.textContent = ph.text;
  timerValue.textContent = ph.seconds.toFixed(1);
}

// controls
prevBtn.addEventListener("click", () => {
  idx = (idx - 1 + STAGE2_CODES.length) % STAGE2_CODES.length;
  render();
});

nextBtn.addEventListener("click", () => {
  idx = (idx + 1) % STAGE2_CODES.length;
  render();
});

phaseBtn.addEventListener("click", () => {
  phaseIdx = (phaseIdx + 1) % STAGE2_PHASES.length;
  renderPhase();
});

toggleOverlayBtn.addEventListener("click", () => {
  stringsGrid.classList.toggle("strong");
});

toggleWobbleBtn.addEventListener("click", () => {
  bgCode.classList.toggle("wobble");
});

// init
render();
