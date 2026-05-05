/* ── Tab navigation ─────────────────────────────────────────────────────────── */
document.querySelectorAll(".nav-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".nav-tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById("tab-" + tab.dataset.tab).classList.add("active");
  });
});

/* ── Printer data ────────────────────────────────────────────────────────────── */
const printerSelect = document.getElementById("printer_id");
const printerStatus = document.getElementById("printer-status");
const STORAGE_KEY   = "printbridge_last_printer";
let printerMap = {};

async function loadPrinters() {
  try {
    const res  = await fetch("/api/printers");
    const data = await res.json();
    printerSelect.innerHTML = "";
    printerMap = {};
    if (!data.printers || data.printers.length === 0) {
      printerSelect.innerHTML = '<option value="">No printers registered yet</option>';
      return;
    }
    const ph = document.createElement("option");
    ph.value = ""; ph.textContent = "— Select a printer —";
    printerSelect.appendChild(ph);
    const lastId = localStorage.getItem(STORAGE_KEY);
    data.printers.forEach((p) => {
      printerMap[p.id] = p;
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.name + (p.location ? ` (${p.location})` : "");
      printerSelect.appendChild(opt);
    });
    if (lastId && printerMap[lastId]) {
      printerSelect.value = lastId;
      onPrinterChanged();
    }
  } catch {
    printerSelect.innerHTML = '<option value="">Error loading printers</option>';
  }
}

function onPrinterChanged() {
  const id = printerSelect.value;
  if (id) localStorage.setItem(STORAGE_KEY, id);
  const p = printerMap[id];
  if (!p) { printerStatus.className = "printer-status hidden"; applyColumns(22); return; }
  if (p.last_seen) {
    const diff    = Date.now() - new Date(p.last_seen + "Z").getTime();
    const minutes = Math.floor(diff / 60000);
    const online  = minutes < 5;
    const when    = minutes < 1 ? "just now" : minutes === 1 ? "1 min ago" : `${minutes} min ago`;
    printerStatus.className   = "printer-status " + (online ? "online" : "offline");
    printerStatus.textContent = (online ? "🟢 Online" : "⚫ Last seen " + when) +
                                (p.description ? " — " + p.description : "");
  } else {
    printerStatus.className   = "printer-status offline";
    printerStatus.textContent = "⚫ Not yet connected" + (p.description ? " — " + p.description : "");
  }
  applyColumns(p.columns || 22);
  const fsEl = document.getElementById("font-size-select");
  if (p.font_size) fsEl.value = p.font_size;
}

loadPrinters();
printerSelect.addEventListener("change", onPrinterChanged);

/* ── Column ruler (vertical line overlay) ────────────────────────────────────── */
const bodyTextarea  = document.getElementById("body");
const textareaWrap  = document.getElementById("textarea-wrap");
const rulerLine     = document.getElementById("col-ruler-line");
const colStatus     = document.getElementById("col-status");
const charCountEl   = document.getElementById("char-count");
const fontSizeSel   = document.getElementById("font-size-select");
const wrapToggle    = document.getElementById("wordwrap-toggle");

let currentMaxCols  = 22;

function applyColumns(cols) {
  currentMaxCols = cols;
  positionRuler();
  updateStats();
}

function positionRuler() {
  // Measure the pixel width of exactly `currentMaxCols` characters
  // using a hidden <span> with identical font/size to the textarea.
  // This is pixel-perfect regardless of font size or zoom level.
  if (!rulerLine._span) {
    const span = document.createElement("span");
    span.style.cssText = [
      "position:absolute", "visibility:hidden", "white-space:pre",
      "font-family:'Courier New',Courier,monospace",
      "font-size:13px", "line-height:1.4",
      "pointer-events:none", "top:-9999px", "left:-9999px"
    ].join(";");
    document.body.appendChild(span);
    rulerLine._span = span;
  }
  // Use a string of 'M' characters — widest monospace char, gives conservative measure
  rulerLine._span.textContent = "M".repeat(currentMaxCols);
  const charsPx = rulerLine._span.getBoundingClientRect().width;

  // The textarea has 14px left padding + 14px right padding
  const PADDING_LEFT = 14;
  // Position the line at left-padding + charsPx from the left of the textarea
  rulerLine.style.left  = (PADDING_LEFT + charsPx) + "px";
  rulerLine.style.right = "auto";
}

function updateStats() {
  const text  = bodyTextarea.value;
  const lines = text.split("\n");
  const maxLineLen = Math.max(...lines.map((l) => [...l].length), 0);
  const over  = maxLineLen > currentMaxCols;
  colStatus.textContent = `Longest line: ${maxLineLen} / ${currentMaxCols} cols`;
  colStatus.className   = over ? "col-over" : "";
  charCountEl.textContent = [...text].length;
}

// Reposition ruler on font size change, window resize, or zoom
fontSizeSel.addEventListener("change", () => {
  // Recalculate columns proportionally if no printer selected,
  // otherwise just refresh ruler position (printer columns are fixed)
  const id = printerSelect.value;
  if (!id || !printerMap[id]) {
    const fs = parseInt(fontSizeSel.value, 10);
    applyColumns(Math.round(22 * (9 / fs)));
  } else {
    positionRuler();
  }
  updateStats();
});

window.addEventListener("resize", positionRuler);
bodyTextarea.addEventListener("input", updateStats);

// Initial position after fonts load
document.fonts.ready.then(positionRuler);
setTimeout(positionRuler, 300); // fallback

/* ── Word wrap toggle ────────────────────────────────────────────────────────── */
wrapToggle.addEventListener("change", () => {
  if (wrapToggle.checked) {
    bodyTextarea.classList.add("word-wrap-on");
  } else {
    bodyTextarea.classList.remove("word-wrap-on");
  }
});
// Default: wrap on
bodyTextarea.classList.add("word-wrap-on");

/* ── Image handling ──────────────────────────────────────────────────────────── */
let currentImageFile = null;
let webcamStream     = null;

const dropZone        = document.getElementById("drop-zone");
const dropZoneIdle    = document.getElementById("drop-zone-idle");
const dropZonePreview = document.getElementById("drop-zone-preview");
const previewImg      = document.getElementById("preview-img");
const removeBtn       = document.getElementById("remove-image");
const browseBtn       = document.getElementById("browse-btn");
const captureBtn      = document.getElementById("capture-btn");
const fileBrowse      = document.getElementById("file-browse");
const fileCapture     = document.getElementById("file-capture");
const webcamPanel     = document.getElementById("webcam-panel");
const webcamVideo     = document.getElementById("webcam-video");
const webcamCanvas    = document.getElementById("webcam-canvas");
const webcamSnap      = document.getElementById("webcam-snap");
const webcamCancel    = document.getElementById("webcam-cancel");

function setImage(file) {
  currentImageFile = file;
  const reader = new FileReader();
  reader.onload = (e) => {
    previewImg.src = e.target.result;
    dropZoneIdle.classList.add("hidden");
    dropZonePreview.classList.remove("hidden");
  };
  reader.readAsDataURL(file);
  hideWebcam();
}

function clearImage() {
  currentImageFile = null; previewImg.src = "";
  fileBrowse.value = ""; fileCapture.value = "";
  dropZoneIdle.classList.remove("hidden");
  dropZonePreview.classList.add("hidden");
}

function hideWebcam() {
  webcamPanel.classList.add("hidden");
  if (webcamStream) { webcamStream.getTracks().forEach((t) => t.stop()); webcamStream = null; }
  webcamVideo.srcObject = null;
}

browseBtn.addEventListener("click",  (e) => { e.preventDefault(); e.stopPropagation(); fileBrowse.click(); });
fileBrowse.addEventListener("change", ()  => { if (fileBrowse.files[0])  setImage(fileBrowse.files[0]); });
fileCapture.addEventListener("change",()  => { if (fileCapture.files[0]) setImage(fileCapture.files[0]); });
removeBtn.addEventListener("click",  (e) => { e.preventDefault(); clearImage(); });

captureBtn.addEventListener("click", async (e) => {
  e.preventDefault(); e.stopPropagation();
  if (/Mobi|Android|iPhone|iPad|IEMobile/i.test(navigator.userAgent)) { fileCapture.click(); return; }
  if (!navigator.mediaDevices?.getUserMedia) { fileBrowse.click(); return; }
  try {
    webcamStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode:"user" }, audio:false });
    webcamVideo.srcObject = webcamStream;
    webcamPanel.classList.remove("hidden");
    dropZoneIdle.classList.add("hidden");
    dropZonePreview.classList.add("hidden");
  } catch { fileBrowse.click(); }
});

webcamSnap.addEventListener("click", (e) => {
  e.preventDefault();
  const w = webcamVideo.videoWidth || 640, h = webcamVideo.videoHeight || 480;
  webcamCanvas.width = w; webcamCanvas.height = h;
  webcamCanvas.getContext("2d").drawImage(webcamVideo, 0, 0, w, h);
  webcamCanvas.toBlob((blob) => {
    setImage(new File([blob], `photo-${Date.now()}.jpg`, { type:"image/jpeg" }));
    webcamPanel.classList.add("hidden");
  }, "image/jpeg", 0.92);
});

webcamCancel.addEventListener("click", (e) => {
  e.preventDefault(); hideWebcam(); dropZoneIdle.classList.remove("hidden");
});

dropZone.addEventListener("dragover",  (e) => { e.preventDefault(); dropZone.classList.add("drag-over"); });
dropZone.addEventListener("dragleave", ()  => dropZone.classList.remove("drag-over"));
dropZone.addEventListener("drop", (e) => {
  e.preventDefault(); dropZone.classList.remove("drag-over");
  const file = e.dataTransfer.files[0];
  if (file?.type.startsWith("image/")) setImage(file);
});

/* ── Send form ───────────────────────────────────────────────────────────────── */
const sendForm  = document.getElementById("send-form");
const submitBtn = document.getElementById("submit-btn");
const feedback  = document.getElementById("form-feedback");

sendForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  feedback.className = "feedback hidden";
  const printer_id = printerSelect.value;
  if (!printer_id) { showFeedback(feedback, "error", "Please select a printer."); return; }
  const body = bodyTextarea.value.trim();
  if (!body && !currentImageFile) {
    showFeedback(feedback, "error", "Please enter a message or attach an image."); return;
  }
  submitBtn.disabled = true;
  submitBtn.innerHTML = '<span class="spinner"></span> Sending…';
  try {
    const fd = new FormData();
    fd.append("printer_id", printer_id);
    const name = document.getElementById("sender_name").value.trim();
    if (name) fd.append("sender_name", name);
    if (body) fd.append("body", body);
    if (currentImageFile) fd.append("image", currentImageFile, currentImageFile.name);
    const res  = await fetch("/api/messages", { method:"POST", body:fd });
    const data = await res.json();
    if (res.ok && data.success) {
      showFeedback(feedback, "success", `✓ Message sent! Printing shortly. (ID: ${data.message_id.slice(0,8)}…)`);
      bodyTextarea.value = "";
      document.getElementById("sender_name").value = "";
      clearImage(); updateStats();
    } else {
      showFeedback(feedback, "error", data.error || "Something went wrong.");
    }
  } catch {
    showFeedback(feedback, "error", "Network error — could not reach the server.");
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = `<svg viewBox="0 0 20 20" fill="none"><path d="M3 10l14-7-7 14V10H3z" fill="currentColor"/></svg> Send to Printer`;
  }
});

/* ── Register form ───────────────────────────────────────────────────────────── */
const regFontSize    = document.getElementById("reg-font-size");
const regColumns     = document.getElementById("reg-columns");
const regRulerPreview = document.getElementById("reg-ruler-preview");

function updateRegRuler() {
  const cols = parseInt(regColumns.value, 10) || 22;
  regRulerPreview.value = "─".repeat(Math.min(cols, 120));
}
regFontSize.addEventListener("change", updateRegRuler);
regColumns.addEventListener("input", updateRegRuler);
updateRegRuler();

const regForm      = document.getElementById("register-form");
const regBtn       = document.getElementById("register-btn");
const regFeedback  = document.getElementById("register-feedback");
const apiKeyBox    = document.getElementById("api-key-box");
const apiKeyValue  = document.getElementById("api-key-value");
const printerIdVal = document.getElementById("printer-id-value");
const copyKeyBtn   = document.getElementById("copy-key-btn");

regForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  regFeedback.className = "feedback hidden";
  apiKeyBox.classList.add("hidden");
  regBtn.disabled = true; regBtn.textContent = "Registering…";
  try {
    const fs   = parseInt(regFontSize.value, 10) || 9;
    const cols = parseInt(regColumns.value,  10) || 22;
    const res  = await fetch("/api/printers", {
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({
        name:        document.getElementById("reg-name").value.trim(),
        description: document.getElementById("reg-desc").value.trim()     || undefined,
        location:    document.getElementById("reg-location").value.trim() || undefined,
        font_size: fs, columns: cols,
      }),
    });
    const data = await res.json();
    if (res.ok && data.success) {
      regForm.reset(); updateRegRuler();
      apiKeyValue.textContent  = data.api_key;
      printerIdVal.textContent = data.printer.id;
      apiKeyBox.classList.remove("hidden");
      apiKeyBox.scrollIntoView({ behavior:"smooth", block:"nearest" });
      loadPrinters();
    } else {
      showFeedback(regFeedback, "error", data.error || "Registration failed.");
    }
  } catch {
    showFeedback(regFeedback, "error", "Network error.");
  } finally {
    regBtn.disabled = false; regBtn.textContent = "Register Printer";
  }
});

copyKeyBtn.addEventListener("click", () => {
  navigator.clipboard.writeText(apiKeyValue.textContent).then(() => {
    copyKeyBtn.textContent = "Copied!";
    setTimeout(() => (copyKeyBtn.textContent = "Copy"), 2000);
  });
});

function showFeedback(el, type, msg) { el.className = "feedback " + type; el.textContent = msg; }