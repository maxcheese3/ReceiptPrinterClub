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

    // Restore last selected printer
    if (lastId) {
      const match = [...printerSelect.options].find((o) => o.value === lastId);
      if (match) {
        printerSelect.value = lastId;
        updatePrinterStatus();
      }
    }
  } catch {
    printerSelect.innerHTML = '<option value="">Error loading printers</option>';
  }
}

function updatePrinterStatus() {
  const opt = printerSelect.selectedOptions[0];
  if (!opt || !opt.value) {
    printerStatus.className = "printer-status hidden";
    return;
  }
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
  if (printerSelect.value) {
    localStorage.setItem(STORAGE_KEY, printerSelect.value);
  }
});

/* ── Character counter ───────────────────────────────────────────────────────── */
const bodyTextarea = document.getElementById("body");
const charCount    = document.getElementById("char-count");
bodyTextarea.addEventListener("input", () => {
  charCount.textContent = bodyTextarea.value.length;
});

/* ── Image drop zone ─────────────────────────────────────────────────────────── */
const dropZone   = document.getElementById("drop-zone");
const fileInput  = document.getElementById("image");
const dzInner    = document.getElementById("drop-zone-inner");
const dzPreview  = document.getElementById("drop-zone-preview");
const previewImg = document.getElementById("preview-img");
const removeBtn  = document.getElementById("remove-image");

function showPreview(file) {
  // Use FileReader to generate a proper data URL — works for all image types
  const reader = new FileReader();
  reader.onload = (e) => {
    previewImg.src = e.target.result;
    dzInner.classList.add("hidden");
    dzPreview.classList.remove("hidden");
  };
  reader.readAsDataURL(file);
  // Disable the invisible file input overlay so Remove button is clickable
  fileInput.style.pointerEvents = "none";
}

function clearPreview() {
  previewImg.src = "";
  dzInner.classList.remove("hidden");
  dzPreview.classList.add("hidden");
  fileInput.value = "";
  fileInput.style.pointerEvents = "auto";
}

fileInput.addEventListener("change", () => {
  if (fileInput.files[0]) showPreview(fileInput.files[0]);
});

removeBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  clearPreview();
});

dropZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropZone.classList.add("drag-over");
});
dropZone.addEventListener("dragleave", () => dropZone.classList.remove("drag-over"));
dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("drag-over");
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith("image/")) {
    // Inject the dropped file into the input so it's included in FormData
    const dt = new DataTransfer();
    dt.items.add(file);
    fileInput.files = dt.files;
    showPreview(file);
  }
});

/* ── Send message form ───────────────────────────────────────────────────────── */
const sendForm  = document.getElementById("send-form");
const submitBtn = document.getElementById("submit-btn");
const feedback  = document.getElementById("form-feedback");

sendForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  feedback.className = "feedback hidden";

  const printer_id = printerSelect.value;
  if (!printer_id) {
    showFeedback(feedback, "error", "Please select a printer.");
    return;
  }

  const body     = bodyTextarea.value.trim();
  const hasImage = fileInput.files.length > 0;
  if (!body && !hasImage) {
    showFeedback(feedback, "error", "Please enter a message or attach an image.");
    return;
  }

  submitBtn.disabled = true;
  submitBtn.innerHTML = '<span class="spinner"></span> Sending…';

  try {
    const res  = await fetch("/api/messages", { method: "POST", body: new FormData(sendForm) });
    const data = await res.json();

    if (res.ok && data.success) {
      showFeedback(feedback, "success",
        `✓ Message sent! It will print shortly. (ID: ${data.message_id.slice(0, 8)}…)`);
      // Clear message fields but keep printer selected
      bodyTextarea.value = "";
      charCount.textContent = "0";
      clearPreview();
      document.getElementById("sender_name").value  = "";
      document.getElementById("sender_email").value = "";
      // Keep printer selection intact — just refresh its status
      updatePrinterStatus();
    } else {
      showFeedback(feedback, "error", data.error || "Something went wrong.");
    }
  } catch {
    showFeedback(feedback, "error", "Network error — could not reach the server.");
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = `
      <svg viewBox="0 0 20 20" fill="none"><path d="M3 10l14-7-7 14V10H3z" fill="currentColor"/></svg>
      Send to Printer`;
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
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({
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
