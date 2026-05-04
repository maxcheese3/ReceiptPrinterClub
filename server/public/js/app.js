/* ── Tab navigation ─────────────────────────────────────────────────────────── */
document.querySelectorAll(".nav-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".nav-tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    tab.classList.add("active");
    document.getElementById("tab-" + tab.dataset.tab).classList.add("active");
  });
});

/* ── Load printers ───────────────────────────────────────────────────────────── */
const printerSelect = document.getElementById("printer_id");
const printerStatus = document.getElementById("printer-status");
const STORAGE_KEY   = "printbridge_last_printer";

async function loadPrinters() {
  try {
    const res  = await fetch("/api/printers");
    const data = await res.json();
    printerSelect.innerHTML = "";
    if (!data.printers || data.printers.length === 0) {
      printerSelect.innerHTML = '<option value="">No printers registered yet</option>';
      return;
    }
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "— Select a printer —";
    printerSelect.appendChild(placeholder);
    const lastId = localStorage.getItem(STORAGE_KEY);
    data.printers.forEach((p) => {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.name + (p.location ? ` (${p.location})` : "");
      opt.dataset.lastSeen    = p.last_seen || "";
      opt.dataset.description = p.description || "";
      printerSelect.appendChild(opt);
    });
    if (lastId) {
      const match = [...printerSelect.options].find((o) => o.value === lastId);
      if (match) { printerSelect.value = lastId; updatePrinterStatus(); }
    }
  } catch {
    printerSelect.innerHTML = '<option value="">Error loading printers</option>';
  }
}

function updatePrinterStatus() {
  const opt = printerSelect.selectedOptions[0];
  if (!opt || !opt.value) { printerStatus.className = "printer-status hidden"; return; }
  const lastSeen = opt.dataset.lastSeen;
  const desc     = opt.dataset.description;
  if (lastSeen) {
    const diff    = Date.now() - new Date(lastSeen + "Z").getTime();
    const minutes = Math.floor(diff / 60000);
    const online  = minutes < 5;
    const when    = minutes < 1 ? "just now" : minutes === 1 ? "1 min ago" : `${minutes} min ago`;
    printerStatus.className   = "printer-status " + (online ? "online" : "offline");
    printerStatus.textContent = (online ? "🟢 Online" : "⚫ Last seen " + when) + (desc ? " — " + desc : "");
  } else {
    printerStatus.className   = "printer-status offline";
    printerStatus.textContent = "⚫ Not yet connected" + (desc ? " — " + desc : "");
  }
}

loadPrinters();
printerSelect.addEventListener("change", () => {
  updatePrinterStatus();
  if (printerSelect.value) localStorage.setItem(STORAGE_KEY, printerSelect.value);
});

/* ── Character counter ───────────────────────────────────────────────────────── */
const bodyTextarea = document.getElementById("body");
const charCount    = document.getElementById("char-count");
bodyTextarea.addEventListener("input", () => { charCount.textContent = bodyTextarea.value.length; });

/* ── Image handling ──────────────────────────────────────────────────────────── */
// Single source of truth: currentImageFile holds whatever image the user selected,
// regardless of whether it came from the file picker, camera, drag-drop, or webcam.
let currentImageFile = null;
let webcamStream     = null;

const dropZone      = document.getElementById("drop-zone");
const dropZoneIdle  = document.getElementById("drop-zone-idle");
const dropZonePreview = document.getElementById("drop-zone-preview");
const previewImg    = document.getElementById("preview-img");
const removeBtn     = document.getElementById("remove-image");
const browseBtn     = document.getElementById("browse-btn");
const captureBtn    = document.getElementById("capture-btn");
const fileBrowse    = document.getElementById("file-browse");
const fileCapture   = document.getElementById("file-capture");
const webcamPanel   = document.getElementById("webcam-panel");
const webcamVideo   = document.getElementById("webcam-video");
const webcamCanvas  = document.getElementById("webcam-canvas");
const webcamSnap    = document.getElementById("webcam-snap");
const webcamCancel  = document.getElementById("webcam-cancel");

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
  currentImageFile  = null;
  previewImg.src    = "";
  fileBrowse.value  = "";
  fileCapture.value = "";
  dropZoneIdle.classList.remove("hidden");
  dropZonePreview.classList.add("hidden");
}

function hideWebcam() {
  webcamPanel.classList.add("hidden");
  if (webcamStream) {
    webcamStream.getTracks().forEach((t) => t.stop());
    webcamStream = null;
  }
  webcamVideo.srcObject = null;
}

// ── Browse button ─────────────────────────────────────────────────────────────
browseBtn.addEventListener("click", (e) => {
  e.preventDefault();
  e.stopPropagation();
  fileBrowse.click();
});
fileBrowse.addEventListener("change", () => {
  if (fileBrowse.files[0]) setImage(fileBrowse.files[0]);
});

// ── Take Photo button ─────────────────────────────────────────────────────────
captureBtn.addEventListener("click", async (e) => {
  e.preventDefault();
  e.stopPropagation();

  // On mobile, the capture attribute triggers the native camera — use it directly
  const isMobile = /Mobi|Android|iPhone|iPad|IEMobile/i.test(navigator.userAgent);
  if (isMobile) {
    fileCapture.click();
    return;
  }

  // Desktop: try to open webcam stream
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    // No webcam API — fall back to file picker
    fileBrowse.click();
    return;
  }

  try {
    webcamStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    webcamVideo.srcObject = webcamStream;
    webcamPanel.classList.remove("hidden");
    dropZoneIdle.classList.add("hidden");
    dropZonePreview.classList.add("hidden");
  } catch {
    // Permission denied or no camera — fall back to file picker
    fileBrowse.click();
  }
});

// Mobile camera input
fileCapture.addEventListener("change", () => {
  if (fileCapture.files[0]) setImage(fileCapture.files[0]);
});

// Webcam controls
webcamSnap.addEventListener("click", (e) => {
  e.preventDefault();
  const w = webcamVideo.videoWidth  || 640;
  const h = webcamVideo.videoHeight || 480;
  webcamCanvas.width  = w;
  webcamCanvas.height = h;
  webcamCanvas.getContext("2d").drawImage(webcamVideo, 0, 0, w, h);
  webcamCanvas.toBlob((blob) => {
    const file = new File([blob], `photo-${Date.now()}.jpg`, { type: "image/jpeg" });
    setImage(file);
  }, "image/jpeg", 0.92);
});

webcamCancel.addEventListener("click", (e) => {
  e.preventDefault();
  hideWebcam();
  dropZoneIdle.classList.remove("hidden");
});

// Remove image
removeBtn.addEventListener("click", (e) => {
  e.preventDefault();
  clearImage();
});

// ── Drag & drop ───────────────────────────────────────────────────────────────
dropZone.addEventListener("dragover",  (e) => { e.preventDefault(); dropZone.classList.add("drag-over"); });
dropZone.addEventListener("dragleave", ()  => dropZone.classList.remove("drag-over"));
dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("drag-over");
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith("image/")) setImage(file);
});

/* ── Send message form ───────────────────────────────────────────────────────── */
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
    showFeedback(feedback, "error", "Please enter a message or attach an image.");
    return;
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

    const res  = await fetch("/api/messages", { method: "POST", body: fd });
    const data = await res.json();

    if (res.ok && data.success) {
      showFeedback(feedback, "success",
        `✓ Message sent! Printing shortly. (ID: ${data.message_id.slice(0, 8)}…)`);
      bodyTextarea.value = "";
      charCount.textContent = "0";
      clearImage();
      document.getElementById("sender_name").value = "";
      updatePrinterStatus();
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

/* ── Register printer form ───────────────────────────────────────────────────── */
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
  regBtn.disabled = true;
  regBtn.textContent = "Registering…";
  try {
    const res  = await fetch("/api/printers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name:        document.getElementById("reg-name").value.trim(),
        description: document.getElementById("reg-desc").value.trim()     || undefined,
        location:    document.getElementById("reg-location").value.trim() || undefined,
      }),
    });
    const data = await res.json();
    if (res.ok && data.success) {
      regForm.reset();
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
    regBtn.disabled = false;
    regBtn.textContent = "Register Printer";
  }
});

copyKeyBtn.addEventListener("click", () => {
  navigator.clipboard.writeText(apiKeyValue.textContent).then(() => {
    copyKeyBtn.textContent = "Copied!";
    setTimeout(() => (copyKeyBtn.textContent = "Copy"), 2000);
  });
});

/* ── Helpers ─────────────────────────────────────────────────────────────────── */
function showFeedback(el, type, msg) {
  el.className = "feedback " + type;
  el.textContent = msg;
}
