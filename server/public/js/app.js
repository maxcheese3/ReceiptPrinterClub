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
  // Always derive columns from the font size lookup table
  currentMaxCols = colsForFontSize(pt);
  updateStats();
}

function applyColumns(cols) {
  currentMaxCols = cols;
  updateStats();
}

fontSizeSel.addEventListener("change", () => {
  const pt = parseInt(fontSizeSel.value, 10) || 9;
  applyFontSize(pt);
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
  // Show status of first selected printer as representative
  const p = printerMap[ids[0]];
  if (!p) { printerStatus.className = "printer-status hidden"; return; }
  if (p.last_seen) {
    const diff    = Date.now() - new Date(p.last_seen + "Z").getTime();
    const minutes = Math.floor(diff / 60000);
    const online  = minutes < 5;
    const when    = minutes < 1 ? "just now" : minutes === 1 ? "1 min ago" : `${minutes} min ago`;
    const label   = ids.length > 1 ? ` (+${ids.length - 1} more)` : "";
    printerStatus.className   = "printer-status " + (online ? "online" : "offline");
    printerStatus.textContent = (online ? "🟢 Online" : "⚫ Last seen " + when) +
                                label + (p.description ? " — " + p.description : "");
  } else {
    printerStatus.className   = "printer-status offline";
    printerStatus.textContent = "⚫ Not yet connected" + (p.description ? " — " + p.description : "");
  }
  // Apply first selected printer's font size to the UI
  applyFontSize(p.font_size || 9);
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

      const diff    = p.last_seen ? Date.now() - new Date(p.last_seen + "Z").getTime() : Infinity;
      const minutes = Math.floor(diff / 60000);
      const online  = minutes < 5;
      const statusDot = online ? "🟢" : "⚫";
      const when    = online ? "online" : minutes < 60 ? `${minutes}m ago` : "offline";

      const item = document.createElement("label");
      item.className = "printer-check-item";
      item.title = [p.description, p.location].filter(Boolean).join(" · ") || p.name;
      item.innerHTML = `
        <input type="checkbox" value="${p.id}" ${saved.includes(p.id) ? "checked" : ""} />
        <span class="printer-check-name">${p.name}</span>
        <span class="printer-check-status">${statusDot}</span>
      `;
      item.querySelector("input").addEventListener("change", () => {
        saveSelection();
        updatePrinterStatus();
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

browseBtn.addEventListener("click",   (e) => { e.preventDefault(); e.stopPropagation(); fileBrowse.click(); });
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

/* ── Send form ───────────────────────────────────────────────────────────────── */
const sendForm  = document.getElementById("send-form");
const submitBtn = document.getElementById("submit-btn");
const feedback  = document.getElementById("form-feedback");

sendForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  feedback.className = "feedback hidden";
  const selectedIds = getSelectedIds();
  if (selectedIds.length === 0) { showFeedback(feedback, "error", "Please select at least one printer."); return; }
  const body = bodyTextarea.value;
  if (!body.trim() && !currentImageFile) {
    showFeedback(feedback, "error", "Please enter a message or attach an image."); return;
  }
  submitBtn.disabled = true;
  submitBtn.innerHTML = '<span class="spinner"></span> Sending…';
  try {
    const name = document.getElementById("sender_name").value.trim();
    const results = await Promise.all(selectedIds.map(async (printer_id) => {
      const fd = new FormData();
      fd.append("printer_id", printer_id);
      if (name) fd.append("sender_name", name);
      if (body) fd.append("body", body);
      fd.append("word_wrap", wrapToggle.checked ? "1" : "0");
      fd.append("font_size", fontSizeSel.value);
      if (currentImageFile) fd.append("image", currentImageFile, currentImageFile.name);
      const res  = await fetch("/api/messages", { method: "POST", body: fd });
      return res.json();
    }));
    const allOk = results.every(d => d.success);
    if (allOk) {
      const label = selectedIds.length > 1 ? `${selectedIds.length} printers` : "printer";
      showFeedback(feedback, "success", `✓ Sent to ${label}! Printing shortly.`);
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
    submitBtn.innerHTML = `<svg viewBox="0 0 20 20" fill="none"><path d="M3 10l14-7-7 14V10H3z" fill="currentColor"/></svg> Send to Printer`;
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

regForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  regFeedback.className = "feedback hidden";
  apiKeyBox.classList.add("hidden");
  regBtn.disabled = true; regBtn.textContent = "Registering…";
  try {
    const fs   = parseInt(document.getElementById("reg-font-size").value, 10) || 9;
    const cols = parseInt(document.getElementById("reg-columns").value, 10)   || 22;
    const res  = await fetch("/api/printers", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name:        document.getElementById("reg-name").value.trim(),
        description: document.getElementById("reg-desc").value.trim()     || undefined,
        location:    document.getElementById("reg-location").value.trim() || undefined,
        font_size: fs, columns: cols,
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
          if (d.success) { btn.textContent = "✓"; setTimeout(() => { btn.textContent = "Save"; }, 1500); loadPrinters(); }
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
