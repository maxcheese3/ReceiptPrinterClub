/* ── Tab navigation ─────────────────────────────────────────────────────────── */
document.querySelectorAll(".nav-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".nav-tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById("tab-" + tab.dataset.tab).classList.add("active");
  });
});

/* ── Textarea + stats (declared first so functions are available everywhere) ── */
const bodyTextarea = document.getElementById("body");
const colStatus    = document.getElementById("col-status");
const charCountEl  = document.getElementById("char-count");
const fontSizeSel  = document.getElementById("font-size-select");
const wrapToggle   = document.getElementById("wordwrap-toggle");

let currentMaxCols = 22;

// Update the character/column counter below the textarea.
// Shows: "Row X of Y  |  N / M chars on current row"
function updateStats() {
  const text  = bodyTextarea.value;
  const lines = text.split("\n");

  // Find which line the cursor is on
  const cursorPos  = bodyTextarea.selectionStart ?? text.length;
  const textBefore = text.slice(0, cursorPos);
  const cursorLine = textBefore.split("\n").length - 1;

  const currentLineLen = [...(lines[cursorLine] || "")].length;
  const over = currentLineLen > currentMaxCols;

  colStatus.textContent = `Col ${currentLineLen} / ${currentMaxCols}`;
  colStatus.className   = over ? "col-over" : "";
  charCountEl.textContent = [...text].length;
}

// Exact column counts measured on the physical printer (Lucida Console Bold)
const FONT_SIZE_COLS = { 7: 31, 8: 27, 9: 24, 10: 22, 11: 20, 12: 18, 14: 16 };

function colsForFontSize(pt) {
  return FONT_SIZE_COLS[pt] || Math.round(24 * 9 / pt);
}

function applyFontSize(pt) {
  fontSizeSel.value = String(pt);
  bodyTextarea.style.fontSize = Math.round(pt * 96 / 72) + "px";
  // Recalculate columns based on selected printers + chosen font size
  recalcColumns();
}

function applyColumns(cols) {
  currentMaxCols = cols;
  updateStats();
}

// Recalculate the column limit based on selected printers and current font size.
// - If printers are selected: use their stored column values (min across all selected)
//   scaled to the current font size relative to their registered font size.
//   Actually simpler: use p.columns directly since that was measured at that printer's
//   font size — if user changes font size, derive from FONT_SIZE_COLS.
// - If no printer selected: derive from font size table.
function recalcColumns() {
  const pt  = parseInt(fontSizeSel.value, 10) || 9;
  const ids = getSelectedIds();
  if (ids.length === 0) {
    currentMaxCols = colsForFontSize(pt);
  } else {
    // Get column count for each selected printer at the current font size.
    // If the printer's registered font size matches current, use p.columns directly.
    // Otherwise scale using the lookup table.
    const cols = ids.map(id => {
      const p = printerMap[id];
      if (!p) return colsForFontSize(pt);
      // Use printer's stored columns if font size matches, else use lookup table
      if ((p.font_size || 9) === pt) return p.columns || colsForFontSize(pt);
      return colsForFontSize(pt);
    });
    currentMaxCols = Math.min(...cols);
  }
  updateStats();
}

fontSizeSel.addEventListener("change", () => {
  const pt = parseInt(fontSizeSel.value, 10) || 9;
  bodyTextarea.style.fontSize = Math.round(pt * 96 / 72) + "px";
  fontSizeSel.value = String(pt);
  recalcColumns();
});

bodyTextarea.addEventListener("input",   updateStats);
bodyTextarea.addEventListener("keyup",   updateStats);
bodyTextarea.addEventListener("click",   updateStats);
bodyTextarea.addEventListener("selectionchange", updateStats);

// Word wrap toggle — controls textarea display and what gets sent to printer
wrapToggle.addEventListener("change", () => {
  bodyTextarea.classList.toggle("word-wrap-on", wrapToggle.checked);
});
bodyTextarea.classList.add("word-wrap-on"); // default on

// Init after fonts load
document.fonts.ready.then(() => applyFontSize(parseInt(fontSizeSel.value, 10) || 9));
setTimeout(() => applyFontSize(parseInt(fontSizeSel.value, 10) || 9), 150);

/* ── Printer checklist (multi-select) ───────────────────────────────────────── */
const printerChecklist = document.getElementById("printer-checklist");
const printerStatus    = document.getElementById("printer-status");
const STORAGE_KEY      = "printbridge_selected_printers"; // now stores array JSON
let printerMap         = {};

function getSelectedIds() {
  return [...printerChecklist.querySelectorAll("input[type=checkbox]:checked")]
    .map(cb => cb.value);
}

function saveSelection() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(getSelectedIds()));
}

function updatePrinterStatus() {
  const ids = getSelectedIds();
  if (ids.length === 0) {
    printerStatus.className = "printer-status hidden";
    return;
  }
  const p = printerMap[ids[0]];
  if (!p) { printerStatus.className = "printer-status hidden"; return; }
  if (p.last_seen) {
    const diff    = Date.now() - new Date(p.last_seen + "Z").getTime();
    const minutes = Math.floor(diff / 60000);
    const online  = minutes < 6;
    const when    = minutes < 1 ? "just now" : minutes === 1 ? "1 min ago" : `${minutes} min ago`;
    const label   = ids.length > 1 ? ` (+${ids.length - 1} more)` : "";
    printerStatus.className   = "printer-status " + (online ? "online" : "offline");
    printerStatus.textContent = (online ? "🟢 Online" : "⚫ Last seen " + when) +
                                label + (p.description ? " — " + p.description : "");
  } else {
    printerStatus.className   = "printer-status offline";
    printerStatus.textContent = "⚫ Not yet connected" + (p.description ? " — " + p.description : "");
  }
}

async function loadPrinters() {
  try {
    const res  = await fetch("/api/printers");
    const data = await res.json();
    printerMap = {};
    printerChecklist.innerHTML = "";

    if (!data.printers || data.printers.length === 0) {
      printerChecklist.innerHTML = '<div class="printer-checklist-loading">No printers registered yet</div>';
      return;
    }

    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");

    data.printers.forEach((p) => {
      printerMap[p.id] = p;

      // Status dot is rendered live by the timer below

      const item = document.createElement("label");
      item.className = "printer-check-item";
      item.title = [p.description, p.location].filter(Boolean).join(" · ") || p.name;
      item.innerHTML = `
        <input type="checkbox" value="${p.id}" ${saved.includes(p.id) ? "checked" : ""} />
        <span class="printer-check-name">${p.name}</span>
        <span class="printer-check-status" data-printer-id="${p.id}"></span>
      `;
      item.querySelector("input").addEventListener("change", () => {
        saveSelection();
        updatePrinterStatus();
        recalcColumns();
        updateSendButtonLabel();
      });
      printerChecklist.appendChild(item);
    });

    updatePrinterStatus();
  } catch (err) {
    console.error("loadPrinters error:", err);
    printerChecklist.innerHTML = '<div class="printer-checklist-loading">Error loading printers</div>';
  }
}

loadPrinters();

// ── Printer status dot refresh ────────────────────────────────────────────────
// Reads last_seen from printerMap (kept fresh by silentRefreshPrinters).
// Runs every 10s and also immediately after loadPrinters populates printerMap.
function refreshPrinterStatusDots() {
  document.querySelectorAll(".printer-check-status[data-printer-id]").forEach(el => {
    const p = printerMap[el.dataset.printerId];
    if (!p || !p.last_seen) { el.textContent = "⚫"; return; }
    const diff    = Date.now() - new Date(p.last_seen + "Z").getTime();
    const minutes = Math.floor(diff / 60000);
    const online  = minutes < 6;
    el.textContent = online ? "🟢" : "⚫";
    el.title = online ? "Online" : minutes < 60 ? `Last seen ${minutes}m ago` : "Offline";
  });
  updatePrinterStatus();
}

// Fetch fresh last_seen values from server and update printerMap
async function silentRefreshPrinters() {
  try {
    const res  = await fetch("/api/printers");
    const data = await res.json();
    if (!data.printers) return;
    data.printers.forEach(p => {
      if (printerMap[p.id]) printerMap[p.id].last_seen = p.last_seen;
    });
    refreshPrinterStatusDots();
  } catch {}
}

// Run immediately (after loadPrinters resolves) and on a 10s interval
// The immediate call is triggered inside loadPrinters() at the end
setInterval(refreshPrinterStatusDots, 10000);
setInterval(silentRefreshPrinters, 10000);
// Also run silentRefresh immediately once page is ready (no 10s wait)
silentRefreshPrinters();




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
  hideWebcam();
  dropZoneIdle.classList.add("hidden");
  dropZonePreview.classList.remove("hidden");
  document.getElementById("grayscale-toggle").classList.remove("hidden");
  renderPreview();
  // Sync the adjust panel visibility now that currentImageFile is set.
  // syncGrayscaleUI is defined later but is a hoisted function declaration.
  syncGrayscaleUI();
}

function clearImage() {
  currentImageFile = null; previewImg.src = "";
  fileBrowse.value = ""; fileCapture.value = "";
  dropZoneIdle.classList.remove("hidden");
  dropZonePreview.classList.add("hidden");
  processedImageBlob = null;
  document.getElementById("image-adjust-panel").classList.add("hidden");
  document.getElementById("grayscale-toggle").classList.add("hidden");
}

function hideWebcam() {
  webcamPanel.classList.add("hidden");
  if (webcamStream) { webcamStream.getTracks().forEach((t) => t.stop()); webcamStream = null; }
  webcamVideo.srcObject = null;
}

browseBtn.addEventListener("click",   (e) => { e.preventDefault(); e.stopPropagation(); fileBrowse.click(); });
document.getElementById("browse-link")?.addEventListener("click", (e) => { e.stopPropagation(); fileBrowse.click(); });
fileBrowse.addEventListener("change",  () => { if (fileBrowse.files[0])  setImage(fileBrowse.files[0]); });
fileCapture.addEventListener("change", () => { if (fileCapture.files[0]) setImage(fileCapture.files[0]); });
removeBtn.addEventListener("click",   (e) => { e.preventDefault(); clearImage(); });

captureBtn.addEventListener("click", async (e) => {
  e.preventDefault(); e.stopPropagation();
  if (/Mobi|Android|iPhone|iPad|IEMobile/i.test(navigator.userAgent)) { fileCapture.click(); return; }
  if (!navigator.mediaDevices?.getUserMedia) { fileBrowse.click(); return; }
  try {
    webcamStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
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
    setImage(new File([blob], `photo-${Date.now()}.jpg`, { type: "image/jpeg" }));
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

// ── Paste to attach ───────────────────────────────────────────────────────────
// Handles Ctrl/Cmd+V anywhere on the page, and right-click > Paste inside the
// drop zone (contextmenu paste is routed through the same clipboard event).
function handlePaste(e) {
  const items = (e.clipboardData || e.originalEvent?.clipboardData)?.items;
  if (!items) return;
  for (const item of items) {
    if (item.type.startsWith("image/")) {
      e.preventDefault();
      const file = item.getAsFile();
      if (file) setImage(file);
      break;
    }
  }
}
document.addEventListener("paste", handlePaste);
dropZone.addEventListener("paste", handlePaste);

/* ── Grayscale / dithering preview ──────────────────────────────────────────── */
const GRAYSCALE_KEY    = "printbridge_grayscale";
const grayscaleToggle  = document.getElementById("grayscale-toggle");
const adjustPanel      = document.getElementById("image-adjust-panel");
const ditherSelect     = document.getElementById("dither-method");
const brightnessSlider = document.getElementById("img-brightness");
const contrastSlider   = document.getElementById("img-contrast");
const thresholdSlider  = document.getElementById("img-threshold");
const brightnessVal    = document.getElementById("img-brightness-val");
const contrastVal      = document.getElementById("img-contrast-val");
const thresholdVal     = document.getElementById("img-threshold-val");
const imgResetBtn      = document.getElementById("img-reset-btn");

let isGrayscale        = localStorage.getItem(GRAYSCALE_KEY) === "1";
let processedImageBlob = null;

// ── Dithering algorithms ──────────────────────────────────────────────────────

function toGrayArray(data, width, height, brightness, contrast) {
  const gray = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    let lum = 0.299 * data[i*4] + 0.587 * data[i*4+1] + 0.114 * data[i*4+2];
    // Brightness
    lum += brightness;
    // Contrast
    if (contrast !== 0) {
      const f = (259 * (contrast + 255)) / (255 * (259 - contrast));
      lum = f * (lum - 128) + 128;
    }
    gray[i] = Math.max(0, Math.min(255, lum));
  }
  return gray;
}

function ditherNone(gray, width, height, threshold) {
  const out = new Uint8ClampedArray(width * height);
  for (let i = 0; i < gray.length; i++) out[i] = gray[i] >= threshold ? 255 : 0;
  return out;
}

function ditherOrdered(gray, width, height, threshold) {
  const bayer = [0,8,2,10, 12,4,14,6, 3,11,1,9, 15,7,13,5];
  const out   = new Uint8ClampedArray(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i   = y * width + x;
      const bv  = (bayer[(y % 4) * 4 + (x % 4)] / 16 - 0.5) * 255;
      out[i]    = (gray[i] + bv * 0.5) >= threshold ? 255 : 0;
    }
  }
  return out;
}

function ditherFloydSteinberg(gray, width, height, threshold) {
  const buf = new Float32Array(gray);
  const out = new Uint8ClampedArray(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i   = y * width + x;
      const nw  = buf[i] >= threshold ? 255 : 0;
      out[i]    = nw;
      const err = buf[i] - nw;
      if (x+1 < width)                     buf[i+1]         += err * 7/16;
      if (y+1 < height) {
        if (x > 0)                          buf[i+width-1]   += err * 3/16;
                                            buf[i+width]     += err * 5/16;
        if (x+1 < width)                    buf[i+width+1]   += err * 1/16;
      }
    }
  }
  return out;
}

function ditherAtkinson(gray, width, height, threshold) {
  const buf  = new Float32Array(gray);
  const out  = new Uint8ClampedArray(width * height);
  const dirs = [[0,1],[0,2],[1,-1],[1,0],[1,1],[2,0]];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i   = y * width + x;
      const nw  = buf[i] >= threshold ? 255 : 0;
      out[i]    = nw;
      const err = (buf[i] - nw) / 8;
      for (const [dy, dx] of dirs) {
        const ny = y+dy, nx = x+dx;
        if (ny < height && nx >= 0 && nx < width) buf[ny*width+nx] += err;
      }
    }
  }
  return out;
}

// ── Core render — called by setImage and slider/toggle events ─────────────────

function renderPreview() {
  if (!currentImageFile) return;

  // Always read via FileReader (data URL) — these never expire unlike blob URLs.
  const reader = new FileReader();
  reader.onload = (e) => {
    const dataUrl = e.target.result;

    if (!isGrayscale) {
      // Color mode: just display the data URL directly.
      previewImg.src = dataUrl;
      previewImg.style.filter = "";
      processedImageBlob = null;
      return;
    }

    // Grayscale mode: draw into a canvas, apply dithering, then show the result.
    const method     = ditherSelect.value;
    const brightness = parseInt(brightnessSlider.value, 10);
    const contrast   = parseInt(contrastSlider.value, 10);
    const threshold  = parseInt(thresholdSlider.value, 10);

    // First show the raw image so there's no blank flash while the canvas processes.
    previewImg.src = dataUrl;

    const img = new Image();
    img.onload = () => {
      const canvas  = document.createElement("canvas");
      canvas.width  = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);

      let imageData;
      try {
        imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      } catch (err) {
        // SecurityError (tainted canvas) — fall back to CSS grayscale.
        console.warn("getImageData blocked, using CSS grayscale:", err);
        previewImg.style.filter = "grayscale(1) contrast(1.4)";
        processedImageBlob = null;
        return;
      }
      previewImg.style.filter = "";

      const { data, width, height } = imageData;
      const gray = toGrayArray(data, width, height, brightness, contrast);

      let mono;
      switch (method) {
        case "none":     mono = ditherNone(gray, width, height, threshold);           break;
        case "floyd":    mono = ditherFloydSteinberg(gray, width, height, threshold); break;
        case "atkinson": mono = ditherAtkinson(gray, width, height, threshold);       break;
        default:         mono = ditherOrdered(gray, width, height, threshold);        break;
      }

      for (let i = 0; i < width * height; i++) {
        const v = mono[i];
        data[i*4] = data[i*4+1] = data[i*4+2] = v;
        data[i*4+3] = 255;
      }
      ctx.putImageData(imageData, 0, 0);

      // Replace preview with processed version and capture blob for upload.
      previewImg.src = canvas.toDataURL("image/png");
      canvas.toBlob((blob) => { processedImageBlob = blob; }, "image/png");
    };
    img.src = dataUrl;
  };
  reader.readAsDataURL(currentImageFile);
}

// Debounced version for slider events
let _renderTimer = null;
function scheduleRender() {
  clearTimeout(_renderTimer);
  _renderTimer = setTimeout(renderPreview, 40);
}

// ── Toggle ────────────────────────────────────────────────────────────────────

function syncGrayscaleUI() {
  grayscaleToggle.classList.toggle("active", isGrayscale);
  adjustPanel.classList.toggle("hidden", !(isGrayscale && currentImageFile));
}

grayscaleToggle.addEventListener("click", () => {
  isGrayscale = !isGrayscale;
  localStorage.setItem(GRAYSCALE_KEY, isGrayscale ? "1" : "0");
  syncGrayscaleUI();
  renderPreview();
});

// ── Sliders & select ──────────────────────────────────────────────────────────

function syncLabels() {
  brightnessVal.textContent = brightnessSlider.value;
  contrastVal.textContent   = contrastSlider.value;
  thresholdVal.textContent  = thresholdSlider.value;
}
syncLabels();

[brightnessSlider, contrastSlider, thresholdSlider].forEach(el =>
  el.addEventListener("input", () => { syncLabels(); scheduleRender(); })
);
ditherSelect.addEventListener("change", renderPreview);

imgResetBtn.addEventListener("click", () => {
  brightnessSlider.value = 0;
  contrastSlider.value   = 0;
  thresholdSlider.value  = 128;
  syncLabels();
  renderPreview();
});

// Apply saved preference on load (no image yet, so just update the button style)
syncGrayscaleUI();

/* ── Pre-upload image resize ──────────────────────────────────────────────────
   Caps color-mode uploads at MAX_UPLOAD_PX on the longest side using canvas,
   so the server never receives a multi-megapixel bitmap.
   Grayscale mode already produces a canvas-rendered PNG at printer width,
   so this only runs for the raw color path.                                   */
const MAX_UPLOAD_PX = 1200;

function resizeFileForUpload(file) {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const { naturalWidth: w, naturalHeight: h } = img;
      if (w <= MAX_UPLOAD_PX && h <= MAX_UPLOAD_PX) {
        resolve(file); // already small enough
        return;
      }
      const scale  = MAX_UPLOAD_PX / Math.max(w, h);
      const canvas = document.createElement("canvas");
      canvas.width  = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        const name = file.name.replace(/\.[^.]+$/, ".jpg");
        resolve(new File([blob], name, { type: "image/jpeg" }));
      }, "image/jpeg", 0.92);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}

/* ── Send form ───────────────────────────────────────────────────────────────── */
const sendForm  = document.getElementById("send-form");
const submitBtn = document.getElementById("submit-btn");
const feedback  = document.getElementById("form-feedback");

sendForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  feedback.className = "feedback hidden";
  const selectedIds = getSelectedIds();
  if (selectedIds.length === 0) { showFeedback(feedback, "error", "Please select at least one printer."); return; }
  // Update button label based on count
  const multi = selectedIds.length > 1;
  const body = bodyTextarea.value;
  if (!body.trim() && !currentImageFile) {
    showFeedback(feedback, "error", "Please enter a message or attach an image."); return;
  }
  submitBtn.disabled = true;
  submitBtn.innerHTML = `<span class="spinner"></span> Sending…`;
  try {
    const name = document.getElementById("sender_name").value.trim();
    const results = await Promise.all(selectedIds.map(async (printer_id) => {
      const fd = new FormData();
      fd.append("printer_id", printer_id);
      if (name) fd.append("sender_name", name);
      if (body) fd.append("body", body);
      fd.append("word_wrap", wrapToggle.checked ? "1" : "0");
      fd.append("font_size", fontSizeSel.value);
      if (currentImageFile) {
        // Use the dithered/processed blob when in grayscale mode, otherwise the raw file
        const imageToSend = (isGrayscale && processedImageBlob)
          ? new File([processedImageBlob], currentImageFile.name.replace(/\.[^.]+$/, ".png"), { type: "image/png" })
          : await resizeFileForUpload(currentImageFile);
        fd.append("image", imageToSend, imageToSend.name);
      }
      const res  = await fetch("/api/messages", { method: "POST", body: fd });
      if (!res.ok) {
        let msg = `Server error (${res.status})`;
        try { const d = await res.json(); if (d.error) msg = d.error; } catch {}
        return { success: false, error: msg };
      }
      return res.json();
    }));
    const allOk = results.every(d => d.success);
    if (allOk) {
      const label = selectedIds.length > 1 ? `${selectedIds.length} printers` : "printer";
      showFeedback(feedback, "success", `✓ Sent to ${label}! Printing shortly.`);
      submitBtn.innerHTML = `<svg viewBox="0 0 20 20" fill="none"><path d="M3 10l14-7-7 14V10H3z" fill="currentColor"/></svg> ${multi ? "Send to Printers" : "Send to Printer"}`;
      bodyTextarea.value = "";
      clearImage(); updateStats();
    } else {
      const errs = results.filter(d => !d.success).map(d => d.error).join("; ");
      showFeedback(feedback, "error", errs || "Some messages failed.");
    }
  } catch {
    showFeedback(feedback, "error", "Network error — could not reach the server.");
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = `<svg viewBox="0 0 20 20" fill="none"><path d="M3 10l14-7-7 14V10H3z" fill="currentColor"/></svg> ${multi ? "Send to Printers" : "Send to Printer"}`;
  }
});

/* ── Register form ───────────────────────────────────────────────────────────── */
const regForm      = document.getElementById("register-form");
const regBtn       = document.getElementById("register-btn");
const regFeedback  = document.getElementById("register-feedback");
const apiKeyBox    = document.getElementById("api-key-box");
const apiKeyValue  = document.getElementById("api-key-value");
const printerIdVal = document.getElementById("printer-id-value");
const copyKeyBtn   = document.getElementById("copy-key-btn");

// Paper width radio → hidden inputs
const PAPER_COLS = { "58": 24, "80": 36 };
document.querySelectorAll('input[name="reg-paper-width"]').forEach(radio => {
  radio.addEventListener("change", () => {
    document.getElementById("reg-columns").value = PAPER_COLS[radio.value] || 24;
  });
});

regForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  regFeedback.className = "feedback hidden";
  apiKeyBox.classList.add("hidden");
  regBtn.disabled = true; regBtn.textContent = "Registering…";
  try {
    const cols = parseInt(document.getElementById("reg-columns").value, 10) || 24;
    const res  = await fetch("/api/printers", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name:        document.getElementById("reg-name").value.trim(),
        description: document.getElementById("reg-desc").value.trim()     || undefined,
        location:    document.getElementById("reg-location").value.trim() || undefined,
        font_size:   9,
        columns:     cols,
      }),
    });
    const data = await res.json();
    if (res.ok && data.success) {
      regForm.reset();
      // Re-check 58mm default after reset
      document.getElementById("reg-paper-58").checked = true;
      document.getElementById("reg-columns").value = 24;
      apiKeyValue.textContent  = data.api_key;
      printerIdVal.textContent = data.printer.id;
      apiKeyBox.classList.remove("hidden");
      apiKeyBox.scrollIntoView({ behavior: "smooth", block: "nearest" });
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

function updateSendButtonLabel() {
  const count = getSelectedIds().length;
  submitBtn.innerHTML = `<svg viewBox="0 0 20 20" fill="none"><path d="M3 10l14-7-7 14V10H3z" fill="currentColor"/></svg> ${count > 1 ? "Send to Printers" : "Send to Printer"}`;
}

function showFeedback(el, type, msg) { el.className = "feedback " + type; el.textContent = msg; }

/* ── Logo click → Send Message ───────────────────────────────────────────────── */
document.querySelector(".logo").style.cursor = "pointer";
document.querySelector(".logo").addEventListener("click", () => {
  document.querySelectorAll(".nav-tab").forEach(t => t.classList.remove("active"));
  document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
  document.querySelector(".nav-tab[data-tab='send']").classList.add("active");
  document.getElementById("tab-send").classList.add("active");
});

/* ── Theme picker ────────────────────────────────────────────────────────────── */
const THEME_KEY = "printbridge_theme";

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem(THEME_KEY, theme);
  document.querySelectorAll(".theme-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.theme === theme);
  });
}

document.querySelectorAll(".theme-btn").forEach(btn => {
  btn.addEventListener("click", () => applyTheme(btn.dataset.theme));
});

// Restore saved theme on load
applyTheme(localStorage.getItem(THEME_KEY) || "dark");

/* ── Admin UI ────────────────────────────────────────────────────────────────── */
const ADMIN_TOKEN_KEY = "printbridge_admin_token";
let adminToken        = sessionStorage.getItem(ADMIN_TOKEN_KEY) || null;
let adminMsgOffset    = 0;
const ADMIN_PAGE_SIZE = 50;

function adminHeaders() {
  return { "Content-Type": "application/json", "Authorization": `Bearer ${adminToken}` };
}

async function adminFetch(path, opts = {}) {
  const res = await fetch(path, { ...opts, headers: { ...adminHeaders(), ...(opts.headers || {}) } });
  if (res.status === 401) { adminLogout(); throw new Error("Session expired — please log in again."); }
  return res;
}

function adminLogout() {
  adminToken = null;
  sessionStorage.removeItem(ADMIN_TOKEN_KEY);
  document.getElementById("admin-login-panel").classList.remove("hidden");
  document.getElementById("admin-dashboard").classList.add("hidden");
}

// Show/hide dashboard based on token
function adminCheckSession() {
  if (adminToken) {
    document.getElementById("admin-login-panel").classList.add("hidden");
    document.getElementById("admin-dashboard").classList.remove("hidden");
    adminLoadDashboard();
  }
}

// Login form
document.getElementById("admin-login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fb  = document.getElementById("admin-login-feedback");
  const pwd = document.getElementById("admin-password").value;
  fb.className = "feedback hidden";
  try {
    const res  = await fetch("/api/admin/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: pwd }),
    });
    const data = await res.json();
    if (res.ok) {
      adminToken = data.token;
      sessionStorage.setItem(ADMIN_TOKEN_KEY, adminToken);
      document.getElementById("admin-password").value = "";
      adminCheckSession();
    } else {
      showFeedback(fb, "error", data.error || "Login failed.");
    }
  } catch {
    showFeedback(fb, "error", "Network error.");
  }
});

document.getElementById("admin-logout-btn").addEventListener("click", adminLogout);
document.getElementById("admin-refresh-printers").addEventListener("click", adminLoadPrinters);

async function adminLoadDashboard() {
  await Promise.all([adminLoadStats(), adminLoadPrinters(), adminLoadMessages(true)]);
}

async function adminLoadStats() {
  try {
    const res  = await adminFetch("/api/admin/stats");
    const data = await res.json();
    const s    = data.stats;
    document.getElementById("admin-global-stats").innerHTML =
      `<span>Total: <strong>${s.total}</strong></span>
       <span>Printed: <strong>${s.printed}</strong></span>
       <span>Failed: <strong>${s.failed}</strong></span>
       <span>Web: <strong>${s.from_web}</strong> · API: <strong>${s.from_api}</strong> · Email: <strong>${s.from_email}</strong></span>`;
  } catch (err) { console.warn("stats:", err.message); }
}

async function adminLoadPrinters() {
  const wrap = document.getElementById("admin-printers-table");
  wrap.innerHTML = '<div class="admin-loading">Loading…</div>';
  try {
    const res     = await adminFetch("/api/admin/printers");
    const data    = await res.json();
    const printers = data.printers;

    // Also populate the filter dropdown
    const filterSel = document.getElementById("admin-filter-printer");
    const prevVal   = filterSel.value;
    filterSel.innerHTML = '<option value="">All Printers</option>';
    printers.forEach(p => {
      const o = document.createElement("option");
      o.value = p.id; o.textContent = p.name;
      filterSel.appendChild(o);
    });
    filterSel.value = prevVal;

    if (!printers.length) {
      wrap.innerHTML = '<div class="admin-loading">No printers registered.</div>'; return;
    }

    const table = document.createElement("table");
    table.className = "admin-table";
    table.innerHTML = `<thead><tr>
      <th>Name</th><th>Description</th><th>Location</th>
      <th>Cols</th><th>Font</th><th>Status</th><th>Visible</th><th>Last Seen</th><th>Actions</th>
    </tr></thead>`;
    const tbody = document.createElement("tbody");

    printers.forEach(p => {
      const tr = document.createElement("tr");
      if (!p.active) tr.className = "inactive";
      const lastSeen = p.last_seen
        ? (() => { const m = Math.floor((Date.now() - new Date(p.last_seen+"Z").getTime())/60000);
            return m < 1 ? "just now" : m < 60 ? `${m}m ago` : `${Math.floor(m/60)}h ago`; })()
        : "never";

      tr.innerHTML = `
        <td><input class="admin-inline-input" data-field="name" value="${escHtml(p.name)}" style="min-width:120px"/></td>
        <td><input class="admin-inline-input" data-field="description" value="${escHtml(p.description||"")}" style="min-width:120px"/></td>
        <td><input class="admin-inline-input" data-field="location" value="${escHtml(p.location||"")}" style="min-width:100px"/></td>
        <td><input class="admin-inline-input" data-field="columns" type="number" value="${p.columns}" style="width:60px;min-width:60px"/></td>
        <td><select class="admin-inline-select" data-field="font_size">
          ${[7,8,9,10,11,12,14].map(s => `<option value="${s}" ${p.font_size==s?"selected":""}>${s}pt</option>`).join("")}
        </select></td>
        <td><span class="status-badge ${p.active ? "status-printed" : "status-failed"}">${p.active ? "Active" : "Inactive"}</span></td>
        <td><span class="status-badge ${p.hidden ? "status-failed" : "status-printed"}">${p.hidden ? "Hidden" : "Visible"}</span></td>
        <td style="color:var(--fg-muted);white-space:nowrap">${lastSeen}</td>
        <td class="admin-actions">
          <button class="btn btn-sm btn-save" data-id="${p.id}">Save</button>
          <button class="btn btn-sm btn-toggle" data-id="${p.id}" data-active="${p.active}">${p.active ? "Deactivate" : "Activate"}</button>
          <button class="btn btn-sm btn-hide" data-id="${p.id}" data-hidden="${p.hidden}">${p.hidden ? "Unhide" : "Hide"}</button>
          <button class="btn btn-sm btn-danger" data-id="${p.id}" data-name="${escHtml(p.name)}">Delete</button>
        </td>`;
      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    wrap.innerHTML = "";
    wrap.appendChild(table);

    // Wire up buttons
    wrap.querySelectorAll(".btn-save").forEach(btn => {
      btn.addEventListener("click", async () => {
        const row  = btn.closest("tr");
        const id   = btn.dataset.id;
        const body = {};
        row.querySelectorAll("[data-field]").forEach(el => {
          body[el.dataset.field] = el.tagName === "SELECT" ? el.value : el.value;
        });
        btn.textContent = "…";
        try {
          const res = await adminFetch(`/api/admin/printers/${id}`, {
            method: "PATCH", body: JSON.stringify(body)
          });
          const d = await res.json();
          if (d.success) { btn.textContent = "✓"; setTimeout(() => { btn.textContent = "Save"; }, 1500); loadPrinters();
 }
          else { btn.textContent = "Save"; alert(d.error); }
        } catch { btn.textContent = "Save"; }
      });
    });

    wrap.querySelectorAll(".btn-toggle").forEach(btn => {
      btn.addEventListener("click", async () => {
        const id     = btn.dataset.id;
        const active = btn.dataset.active === "1" ? 0 : 1;
        try {
          await adminFetch(`/api/admin/printers/${id}`, {
            method: "PATCH", body: JSON.stringify({ active })
          });
          adminLoadPrinters(); loadPrinters();
        } catch (err) { alert(err.message); }
      });
    });

    wrap.querySelectorAll(".btn-hide").forEach(btn => {
      btn.addEventListener("click", async () => {
        const id     = btn.dataset.id;
        const hidden = btn.dataset.hidden === "1" ? 0 : 1;
        try {
          await adminFetch(`/api/admin/printers/${id}`, {
            method: "PATCH", body: JSON.stringify({ hidden })
          });
          adminLoadPrinters(); loadPrinters();
        } catch (err) { alert(err.message); }
      });
    });

    wrap.querySelectorAll(".btn-danger").forEach(btn => {
      btn.addEventListener("click", async () => {
        if (!confirm(`Permanently delete "${btn.dataset.name}" and ALL its messages? This cannot be undone.`)) return;
        try {
          await adminFetch(`/api/admin/printers/${btn.dataset.id}`, { method: "DELETE" });
          adminLoadPrinters(); loadPrinters();
        } catch (err) { alert(err.message); }
      });
    });

  } catch (err) {
    wrap.innerHTML = `<div class="admin-loading" style="color:var(--error)">${err.message}</div>`;
  }
}

async function adminLoadMessages(reset = false) {
  if (reset) adminMsgOffset = 0;
  const wrap      = document.getElementById("admin-messages-table");
  const printerId = document.getElementById("admin-filter-printer").value;
  const url       = `/api/admin/messages?limit=${ADMIN_PAGE_SIZE}&offset=${adminMsgOffset}` +
                    (printerId ? `&printer_id=${printerId}` : "");

  if (reset) wrap.innerHTML = '<div class="admin-loading">Loading…</div>';

  try {
    const res  = await adminFetch(url);
    const data = await res.json();
    const msgs = data.messages;

    if (reset) wrap.innerHTML = "";

    if (!msgs.length && reset) {
      wrap.innerHTML = '<div class="admin-loading">No messages found.</div>'; return;
    }
    if (!msgs.length) return;

    let table = wrap.querySelector("table.admin-table");
    if (!table) {
      table = document.createElement("table");
      table.className = "admin-table";
      table.innerHTML = `<thead><tr>
        <th>Time</th><th>Printer</th><th>From</th><th>Source</th>
        <th>Body</th><th>Image</th><th>Status</th>
      </tr></thead>`;
      table.appendChild(document.createElement("tbody"));
      wrap.appendChild(table);
    }
    const tbody = table.querySelector("tbody");

    msgs.forEach(m => {
      const tr = document.createElement("tr");
      const t  = new Date(m.created_at + "Z").toLocaleString();
      const imgCell = m.image_path
        ? `<img class="msg-image-thumb" src="/uploads/${m.image_path}" alt="img"
             onclick="window.open('/uploads/${m.image_path}')" />`
        : "—";
      tr.innerHTML = `
        <td style="white-space:nowrap;font-size:11px">${t}</td>
        <td style="white-space:nowrap">${escHtml(m.printer_name || m.printer_id.slice(0,8))}</td>
        <td style="white-space:nowrap">${escHtml(m.sender_name || "—")}</td>
        <td style="text-transform:capitalize;white-space:nowrap">${m.source}</td>
        <td><div class="msg-body-preview" data-msg-id="${m.id}">${escHtml((m.body||"").slice(0,80) || "—")}</div></td>
        <td style="white-space:nowrap">${imgCell}</td>
        <td style="white-space:nowrap"><span class="status-badge status-${m.status}">${m.status}</span></td>`;
      // Store message data on the element so the click handler can access it
      tr.querySelector(".msg-body-preview")._msgData = m;
      tr.querySelector(".msg-body-preview").addEventListener("click", function() {
        openMsgModal(this._msgData);
      });
      tbody.appendChild(tr);
    });

    adminMsgOffset += msgs.length;
  } catch (err) {
    if (reset) wrap.innerHTML = `<div class="admin-loading" style="color:var(--error)">${err.message}</div>`;
  }
}

document.getElementById("admin-load-more").addEventListener("click", () => adminLoadMessages(false));
document.getElementById("admin-filter-printer").addEventListener("change", () => adminLoadMessages(true));

/* ── Message modal ───────────────────────────────────────────────────────────── */
function openMsgModal(m) {
  document.getElementById("msg-modal-meta").textContent =
    `${new Date(m.created_at + "Z").toLocaleString()}  ·  ${m.printer_name || m.printer_id.slice(0,8)}  ·  From: ${m.sender_name || "(unknown)"}  ·  ${m.source}`;
  document.getElementById("msg-modal-body").textContent = m.body || "(no text body)";
  const imgEl  = document.getElementById("msg-modal-imgel");
  const imgDiv = document.getElementById("msg-modal-img");
  if (m.image_path) {
    imgEl.src = `/uploads/${m.image_path}`;
    imgDiv.classList.remove("hidden");
  } else {
    imgDiv.classList.add("hidden");
    imgEl.src = "";
  }
  document.getElementById("msg-modal").classList.remove("hidden");
  document.body.style.overflow = "hidden";
}
function closeMsgModal() {
  document.getElementById("msg-modal").classList.add("hidden");
  document.body.style.overflow = "";
}
// Wire close button (using id, not inline onclick which can fail in some contexts)
document.getElementById("msg-modal-close-btn").addEventListener("click", closeMsgModal);
// Close on backdrop click
document.getElementById("msg-modal").addEventListener("click", function(e) {
  if (e.target === this) closeMsgModal();
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMsgModal(); });

function escHtml(str) {
  return String(str || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

// Check session when Admin tab is clicked
document.querySelectorAll(".nav-tab").forEach(tab => {
  if (tab.dataset.tab === "admin") {
    tab.addEventListener("click", adminCheckSession);
  }
});

// Auto-restore session on page load if already on admin tab
if (adminToken) adminCheckSession();

/* ── Subscription Admin UI ───────────────────────────────────────────────────── */
const SUB_KEY_STORAGE = "printbridge_sub_api_key";
let subApiKey = null;
let subPrinterId = null;

function subAuthHeaders() {
  return { "Content-Type": "application/json", "X-API-Key": subApiKey };
}

async function subFetch(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { ...subAuthHeaders(), ...(opts.headers || {}) },
  });
  if (res.status === 401 || res.status === 403) {
    subLogout();
    throw new Error("Session expired — please sign in again.");
  }
  return res;
}

function subLogout() {
  subApiKey = null;
  subPrinterId = null;
  sessionStorage.removeItem(SUB_KEY_STORAGE);
  document.getElementById("sub-login-panel").classList.remove("hidden");
  document.getElementById("sub-dashboard").classList.add("hidden");
}

document.getElementById("sub-logout-btn").addEventListener("click", subLogout);

document.getElementById("sub-login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fb  = document.getElementById("sub-login-feedback");
  const key = document.getElementById("sub-api-key").value.trim();
  fb.className = "feedback hidden";
  if (!key) { showFeedback(fb, "error", "Please enter your API key."); return; }
  try {
    // Validate by fetching subscriptions
    const res  = await fetch("/api/subscriptions", { headers: { "X-API-Key": key } });
    if (res.status === 401 || res.status === 403) {
      showFeedback(fb, "error", "Invalid API key."); return;
    }
    const data = await res.json();
    subApiKey = key;
    sessionStorage.setItem(SUB_KEY_STORAGE, key);
    // Find printer name
    const printerRes  = await fetch("/api/printers");
    const printerData = await printerRes.json();
    // We don't know which printer from key alone — find by polling subs response
    // The server doesn't return printer info, so look it up by matching
    document.getElementById("sub-api-key").value = "";
    subShowDashboard(data.subscriptions || []);
  } catch (err) {
    showFeedback(fb, "error", err.message || "Network error.");
  }
});

function subShowDashboard(subs) {
  document.getElementById("sub-login-panel").classList.add("hidden");
  document.getElementById("sub-dashboard").classList.remove("hidden");
  renderSubList(subs);
}

function subTypeLabel(type) {
  if (type === "xkcd") return '<span class="sub-badge sub-badge-xkcd">XKCD</span>';
  return '<span class="sub-badge sub-badge-rss">RSS</span>';
}

function renderSubList(subs) {
  const wrap = document.getElementById("sub-list");
  if (!subs.length) {
    wrap.innerHTML = '<div class="admin-loading">No subscriptions yet. Add one above.</div>';
    return;
  }
  wrap.innerHTML = "";
  subs.forEach(sub => {
    const div = document.createElement("div");
    div.className = "sub-item";
    const checkedStr = sub.last_checked
      ? `Last checked: ${new Date(sub.last_checked + "Z").toLocaleString()}`
      : "Never checked";
    const activeLabel = sub.active
      ? '<span class="sub-badge sub-badge-active">Active</span>'
      : '<span class="sub-badge sub-badge-paused">Paused</span>';
    div.innerHTML = `
      <div class="sub-item-info">
        <div class="sub-item-name">${escHtml(sub.name)} ${subTypeLabel(sub.feed_type)} ${activeLabel}</div>
        <div class="sub-item-url">${escHtml(sub.feed_url)}</div>
        <div class="sub-item-meta">${checkedStr}${sub.last_item_id ? " · Last: " + escHtml(sub.last_item_id.slice(0, 40)) : ""}</div>
      </div>
      <div class="sub-item-actions">
        <button class="btn btn-sm btn-toggle" data-id="${sub.id}" data-active="${sub.active}">${sub.active ? "Pause" : "Resume"}</button>
        <button class="btn btn-sm btn-save" data-id="${sub.id}" title="Fetch latest now">↻ Fetch</button>
        <button class="btn btn-sm btn-danger" data-id="${sub.id}" data-name="${escHtml(sub.name)}">Delete</button>
      </div>`;

    div.querySelector(".btn-toggle").addEventListener("click", async (e) => {
      const active = e.target.dataset.active === "1" ? 0 : 1;
      await subFetch(`/api/subscriptions/${sub.id}`, { method: "PATCH", body: JSON.stringify({ active }) });
      subLoadSubs();
    });

    div.querySelector(".btn-save").addEventListener("click", async (e) => {
      e.target.textContent = "…";
      try {
        await subFetch(`/api/subscriptions/${sub.id}/poll`, { method: "POST" });
        e.target.textContent = "✓";
        setTimeout(() => { e.target.textContent = "↻ Fetch"; subLoadSubs(); }, 2000);
      } catch { e.target.textContent = "↻ Fetch"; }
    });

    div.querySelector(".btn-danger").addEventListener("click", async (e) => {
      if (!confirm(`Delete subscription "${e.target.dataset.name}"?`)) return;
      await subFetch(`/api/subscriptions/${sub.id}`, { method: "DELETE" });
      subLoadSubs();
    });

    wrap.appendChild(div);
  });
}

async function subLoadSubs() {
  try {
    const res  = await subFetch("/api/subscriptions");
    const data = await res.json();
    renderSubList(data.subscriptions || []);
  } catch {}
}

document.getElementById("sub-refresh-btn").addEventListener("click", subLoadSubs);

document.getElementById("sub-add-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fb   = document.getElementById("sub-add-feedback");
  const name = document.getElementById("sub-name").value.trim();
  const url  = document.getElementById("sub-url").value.trim();
  fb.className = "feedback hidden";
  if (!name) { showFeedback(fb, "error", "Please enter a name."); return; }
  if (!url)  { showFeedback(fb, "error", "Please enter a feed URL."); return; }
  const btn = document.getElementById("sub-add-btn");
  btn.disabled = true; btn.textContent = "Adding…";
  try {
    const res  = await subFetch("/api/subscriptions", { method: "POST", body: JSON.stringify({ name, feed_url: url }) });
    const data = await res.json();
    if (res.ok && data.success) {
      document.getElementById("sub-name").value = "";
      document.getElementById("sub-url").value  = "";
      showFeedback(fb, "success", `✓ "${name}" added! It will be checked within 15 minutes, or click ↻ Fetch.`);
      subLoadSubs();
    } else {
      showFeedback(fb, "error", data.error || "Failed to add subscription.");
    }
  } catch (err) {
    showFeedback(fb, "error", err.message || "Network error.");
  } finally {
    btn.disabled = false; btn.textContent = "Add Feed";
  }
});

// Restore session on tab switch
document.querySelectorAll(".nav-tab").forEach(tab => {
  if (tab.dataset.tab === "subscriptions") {
    tab.addEventListener("click", () => {
      const saved = sessionStorage.getItem(SUB_KEY_STORAGE);
      if (saved && !subApiKey) {
        subApiKey = saved;
        subLoadSubs().then(() => {
          document.getElementById("sub-login-panel").classList.add("hidden");
          document.getElementById("sub-dashboard").classList.remove("hidden");
        }).catch(() => { subApiKey = null; });
      }
    });
  }
});

/* ── Printer Admin UI ────────────────────────────────────────────────────────── */
const PA_KEY_STORAGE = "printbridge_pa_api_key";
let paApiKey  = null;
let paMsgOffset = 0;
const PA_PAGE = 50;

function paHeaders() {
  return { "Content-Type": "application/json", "X-API-Key": paApiKey };
}

async function paFetch(url, opts = {}) {
  const res = await fetch(url, { ...opts, headers: { ...paHeaders(), ...(opts.headers || {}) } });
  if (res.status === 401 || res.status === 403) { paLogout(); throw new Error("Session expired."); }
  return res;
}

function paLogout() {
  paApiKey = null;
  sessionStorage.removeItem(PA_KEY_STORAGE);
  document.getElementById("pa-login-panel").classList.remove("hidden");
  document.getElementById("pa-dashboard").classList.add("hidden");
}

document.getElementById("pa-logout-btn").addEventListener("click", paLogout);

// ── Login ─────────────────────────────────────────────────────────────────────
document.getElementById("pa-login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fb  = document.getElementById("pa-login-feedback");
  const key = document.getElementById("pa-api-key").value.trim();
  fb.className = "feedback hidden";
  if (!key) { showFeedback(fb, "error", "Please enter your API key."); return; }
  const btn = document.getElementById("pa-login-btn");
  btn.disabled = true; btn.textContent = "Signing in…";
  try {
    const res  = await fetch("/api/printer-admin/me", { headers: { "X-API-Key": key, "Content-Type": "application/json" } });
    if (res.status === 401 || res.status === 403) { showFeedback(fb, "error", "Invalid API key."); return; }
    const data = await res.json();
    paApiKey = key;
    sessionStorage.setItem(PA_KEY_STORAGE, key);
    document.getElementById("pa-api-key").value = "";
    paShowDashboard(data.printer, data.stats);
  } catch (err) {
    showFeedback(fb, "error", err.message || "Network error.");
  } finally {
    btn.disabled = false; btn.textContent = "Sign In";
  }
});

function paShowDashboard(printer, stats) {
  document.getElementById("pa-login-panel").classList.add("hidden");
  document.getElementById("pa-dashboard").classList.remove("hidden");

  // Fill header
  document.getElementById("pa-printer-name").textContent = printer.name;
  const metaParts = [];
  if (printer.location)    metaParts.push(printer.location);
  if (printer.description) metaParts.push(printer.description);
  if (stats) metaParts.push(`${stats.total} messages · ${stats.printed} printed`);
  document.getElementById("pa-printer-meta").textContent = metaParts.join(" · ");

  // Fill settings form
  document.getElementById("pa-name").value        = printer.name        || "";
  document.getElementById("pa-description").value = printer.description || "";
  document.getElementById("pa-location").value    = printer.location    || "";
  document.getElementById("pa-columns").value     = printer.columns     || 24;

  // Sync management buttons to current printer state
  paSyncManageButtons(printer);

  // Load messages
  paMsgOffset = 0;
  paLoadAllMessages(true);
}

// ── Printer Management ────────────────────────────────────────────────────────

let paPrinterState = {}; // local cache of current printer data

function paSyncManageButtons(printer) {
  paPrinterState = printer;

  const hiddenBtn = document.getElementById("pa-toggle-hidden-btn");
  hiddenBtn.textContent = printer.hidden ? "Make Public" : "Hide from Directory";
  hiddenBtn.className   = printer.hidden
    ? "btn btn-primary btn-sm"
    : "btn btn-outline btn-sm";

  const activeBtn = document.getElementById("pa-toggle-active-btn");
  activeBtn.textContent = printer.active ? "Deactivate" : "Reactivate";
  activeBtn.className   = printer.active
    ? "btn btn-outline btn-sm"
    : "btn btn-primary btn-sm";

  // Keep delete hint name in sync
  document.getElementById("pa-delete-name-hint").textContent = printer.name;
}

async function paPatchMe(patch) {
  const res  = await paFetch("/api/printer-admin/me", { method: "PATCH", body: JSON.stringify(patch) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Update failed");
  return data.printer;
}

// Hide / show toggle
document.getElementById("pa-toggle-hidden-btn").addEventListener("click", async () => {
  const fb  = document.getElementById("pa-manage-feedback");
  const btn = document.getElementById("pa-toggle-hidden-btn");
  btn.disabled = true;
  fb.className = "feedback hidden";
  try {
    const updated = await paPatchMe({ hidden: paPrinterState.hidden ? 0 : 1 });
    paSyncManageButtons(updated);
    showFeedback(fb, "success", updated.hidden ? "✓ Hidden from public directory." : "✓ Now visible in public directory.");
    loadPrinters();
  } catch (err) { showFeedback(fb, "error", err.message); }
  finally { btn.disabled = false; }
});

// Activate / deactivate toggle
document.getElementById("pa-toggle-active-btn").addEventListener("click", async () => {
  const fb  = document.getElementById("pa-manage-feedback");
  const btn = document.getElementById("pa-toggle-active-btn");
  btn.disabled = true;
  fb.className = "feedback hidden";
  try {
    const updated = await paPatchMe({ active: paPrinterState.active ? 0 : 1 });
    paSyncManageButtons(updated);
    showFeedback(fb, "success", updated.active ? "✓ Printer reactivated." : "✓ Printer deactivated.");
    loadPrinters();
  } catch (err) { showFeedback(fb, "error", err.message); }
  finally { btn.disabled = false; }
});

// Delete — open confirmation
document.getElementById("pa-delete-open-btn").addEventListener("click", () => {
  document.getElementById("pa-delete-confirm").classList.remove("hidden");
  document.getElementById("pa-delete-name-input").value = "";
  document.getElementById("pa-delete-confirm-btn").disabled = true;
  document.getElementById("pa-delete-feedback").className = "feedback hidden";
  document.getElementById("pa-delete-name-input").focus();
});

// Delete — cancel
document.getElementById("pa-delete-cancel-btn").addEventListener("click", () => {
  document.getElementById("pa-delete-confirm").classList.add("hidden");
});

// Delete — enable confirm button only when name matches exactly
document.getElementById("pa-delete-name-input").addEventListener("input", (e) => {
  const matches = e.target.value === paPrinterState.name;
  document.getElementById("pa-delete-confirm-btn").disabled = !matches;
});

// Delete — execute
document.getElementById("pa-delete-confirm-btn").addEventListener("click", async () => {
  const fb  = document.getElementById("pa-delete-feedback");
  const btn = document.getElementById("pa-delete-confirm-btn");
  btn.disabled = true;
  fb.className = "feedback hidden";
  try {
    const res  = await paFetch("/api/printer-admin/me", {
      method: "DELETE",
      body:   JSON.stringify({ confirm_name: paPrinterState.name }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Delete failed");
    // Sign out and return to login panel
    paLogout();
    loadPrinters();
    showFeedback(document.getElementById("pa-login-feedback"), "success", "Printer deleted successfully.");
    document.getElementById("pa-login-feedback").classList.remove("hidden");
  } catch (err) {
    showFeedback(fb, "error", err.message);
    btn.disabled = false;
  }
});

// ── Settings ──────────────────────────────────────────────────────────────────
document.getElementById("pa-settings-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fb  = document.getElementById("pa-settings-feedback");
  const btn = document.getElementById("pa-save-btn");
  btn.disabled = true; btn.textContent = "Saving…";
  fb.className = "feedback hidden";
  try {
    const res  = await paFetch("/api/printer-admin/me", {
      method: "PATCH",
      body: JSON.stringify({
        name:        document.getElementById("pa-name").value.trim(),
        description: document.getElementById("pa-description").value.trim(),
        location:    document.getElementById("pa-location").value.trim(),
        columns:     parseInt(document.getElementById("pa-columns").value, 10) || 24,
      }),
    });
    const data = await res.json();
    if (res.ok && data.success) {
      document.getElementById("pa-printer-name").textContent = data.printer.name;
      showFeedback(fb, "success", "✓ Saved");
      loadPrinters(); // refresh main printer list
    } else {
      showFeedback(fb, "error", data.error || "Save failed.");
    }
  } catch (err) { showFeedback(fb, "error", err.message); }
  finally { btn.disabled = false; btn.textContent = "Save Settings"; }
});

// ── View toggle ───────────────────────────────────────────────────────────────
let paCurrentView = "all";
document.getElementById("pa-view-all").addEventListener("click", () => {
  paCurrentView = "all";
  document.getElementById("pa-view-all").classList.add("active");
  document.getElementById("pa-view-threads").classList.remove("active");
  document.getElementById("pa-all-view").classList.remove("hidden");
  document.getElementById("pa-threads-view").classList.add("hidden");
  document.getElementById("pa-load-more-btn").style.display = "";
  paMsgOffset = 0;
  paLoadAllMessages(true);
});

document.getElementById("pa-view-threads").addEventListener("click", () => {
  paCurrentView = "threads";
  document.getElementById("pa-view-threads").classList.add("active");
  document.getElementById("pa-view-all").classList.remove("active");
  document.getElementById("pa-threads-view").classList.remove("hidden");
  document.getElementById("pa-all-view").classList.add("hidden");
  document.getElementById("pa-load-more-btn").style.display = "none";
  // Always reset to thread list (not detail) and reload
  document.getElementById("pa-thread-list").classList.remove("hidden");
  document.getElementById("pa-thread-detail").classList.add("hidden");
  paLoadThreads();
});

document.getElementById("pa-load-more-btn").addEventListener("click", () => paLoadAllMessages(false));

// ── Message rendering ─────────────────────────────────────────────────────────
function paFormatTime(isoStr) {
  const d = new Date(isoStr + "Z");
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function paStatusClass(status) {
  return { printed: "status-printed", failed: "status-failed", pending: "status-pending", printing: "status-printing" }[status] || "";
}

function paRenderMessage(m) {
  const card = document.createElement("div");
  card.className = "pa-message-card" + (m.image_path ? " has-image" : "");

  const from   = escHtml(m.sender_name || "(unknown)");
  const time   = paFormatTime(m.created_at);
  const body   = escHtml(m.body || "");
  const imgHtml = m.image_path
    ? `<img class="pa-msg-img" src="/uploads/${m.image_path}" alt="image" onclick="window.open('/uploads/${m.image_path}')" />`
    : "";
  const statusHtml = `<span class="pa-msg-status ${paStatusClass(m.status)} status-badge">${m.status}</span>`;

  card.innerHTML = `
    <span class="pa-msg-from">${from}</span>
    ${statusHtml}
    <span class="pa-msg-time">${time}</span>
    ${imgHtml}
    ${body ? `<div class="pa-msg-body">${body}</div>` : ""}
  `;

  // Click to expand body
  const bodyEl = card.querySelector(".pa-msg-body");
  if (bodyEl) {
    card.addEventListener("click", (e) => {
      if (e.target.tagName === "IMG") return;
      bodyEl.classList.toggle("expanded");
    });
  }

  return card;
}

// ── All messages view ─────────────────────────────────────────────────────────
async function paLoadAllMessages(reset = false) {
  if (reset) paMsgOffset = 0;
  const list = document.getElementById("pa-messages-list");
  if (reset) list.innerHTML = '<div class="admin-loading">Loading…</div>';
  const loadMore = document.getElementById("pa-load-more-btn");

  try {
    const res  = await paFetch(`/api/printer-admin/messages?limit=${PA_PAGE}&offset=${paMsgOffset}`);
    const data = await res.json();
    const msgs = data.messages || [];

    if (reset) list.innerHTML = "";
    if (!msgs.length && reset) {
      list.innerHTML = '<div class="admin-loading">No messages yet.</div>';
      loadMore.style.display = "none";
      return;
    }

    msgs.forEach(m => list.appendChild(paRenderMessage(m)));
    paMsgOffset += msgs.length;
    loadMore.style.display = msgs.length < PA_PAGE ? "none" : "";
  } catch (err) {
    if (reset) list.innerHTML = `<div class="admin-loading" style="color:var(--error)">${err.message}</div>`;
  }
}

// ── Threads view ──────────────────────────────────────────────────────────────
async function paLoadThreads() {
  const threadList   = document.getElementById("pa-thread-list");
  const threadDetail = document.getElementById("pa-thread-detail");
  threadList.innerHTML = '<div class="admin-loading">Loading…</div>';
  threadDetail.classList.add("hidden");

  try {
    const res     = await paFetch("/api/printer-admin/threads");
    const data    = await res.json();
    const threads = data.threads || [];

    threadList.innerHTML = "";
    if (!threads.length) {
      threadList.innerHTML = '<div class="admin-loading">No messages yet.</div>';
      return;
    }

    threads.forEach(t => {
      const card     = document.createElement("div");
      card.className = "pa-thread-card";
      const name     = t.sender_name || "(unknown)";
      const initial  = name.replace(/[^a-zA-Z0-9]/g, "").slice(0, 2).toUpperCase() || "?";
      const preview  = t.latest_body ? escHtml(t.latest_body.slice(0, 60)) : (t.latest_image ? "📷 Image" : "—");
      const time     = paFormatTime(t.latest_at);

      card.innerHTML = `
        <div class="pa-thread-avatar">${initial}</div>
        <div class="pa-thread-info">
          <div class="pa-thread-name">${escHtml(name)}</div>
          <div class="pa-thread-preview">${preview}</div>
        </div>
        <div class="pa-thread-right">
          <span class="pa-thread-count">${t.message_count}</span>
          <span class="pa-thread-time">${time}</span>
        </div>
      `;

      card.addEventListener("click", () => paOpenThread(t.sender_name, name));
      threadList.appendChild(card);
    });
  } catch (err) {
    threadList.innerHTML = `<div class="admin-loading" style="color:var(--error)">${err.message}</div>`;
  }
}

async function paOpenThread(sender, displayName) {
  const threadList   = document.getElementById("pa-thread-list");
  const threadDetail = document.getElementById("pa-thread-detail");
  const msgList      = document.getElementById("pa-thread-messages");

  threadList.classList.add("hidden");
  threadDetail.classList.remove("hidden");
  document.getElementById("pa-thread-title").textContent = displayName || "(unknown)";
  msgList.innerHTML = '<div class="admin-loading">Loading…</div>';

  try {
    const encoded = encodeURIComponent(sender || "");
    const res     = await paFetch(`/api/printer-admin/messages?limit=200&sender=${encoded}`);
    const data    = await res.json();
    const msgs    = data.messages || [];
    msgList.innerHTML = "";
    if (!msgs.length) { msgList.innerHTML = '<div class="admin-loading">No messages in this thread.</div>'; return; }
    msgs.forEach(m => msgList.appendChild(paRenderMessage(m)));
  } catch (err) {
    msgList.innerHTML = `<div class="admin-loading" style="color:var(--error)">${err.message}</div>`;
  }
}

document.getElementById("pa-back-btn").addEventListener("click", () => {
  document.getElementById("pa-thread-list").classList.remove("hidden");
  document.getElementById("pa-thread-detail").classList.add("hidden");
});

// ── Restore session on tab switch ─────────────────────────────────────────────
document.querySelectorAll(".nav-tab").forEach(tab => {
  if (tab.dataset.tab === "printer-admin") {
    tab.addEventListener("click", async () => {
      const saved = sessionStorage.getItem(PA_KEY_STORAGE);
      if (saved && !paApiKey) {
        paApiKey = saved;
        try {
          const res  = await paFetch("/api/printer-admin/me");
          const data = await res.json();
          paShowDashboard(data.printer, data.stats);
        } catch { paApiKey = null; }
      }
    });
  }
});
