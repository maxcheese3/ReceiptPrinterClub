import { useState, useRef, useEffect, useCallback } from 'react';
import PrinterChecklist, { loadSavedIds, printerStatusText } from '../components/PrinterChecklist';
import FeedbackBanner from '../components/FeedbackBanner';
import { usePrinters } from '../hooks/usePrinters';
import { useDithering } from '../hooks/useDithering';
import { useImageResize } from '../hooks/useImageResize';
import type { DitherMethod } from '../hooks/useDithering';

const GRAYSCALE_KEY = 'printbridge_grayscale';
const SENDER_NAME_KEY = 'printbridge_sender_name';
const FONT_SIZE_KEY = 'printbridge_font_size';
const FONT_SIZE_COLS: Record<number, number> = { 7: 31, 8: 27, 9: 24, 10: 22, 11: 20, 12: 18, 14: 16 };

function colsForFontSize(pt: number): number {
  return FONT_SIZE_COLS[pt] ?? Math.round(24 * 9 / pt);
}

export default function SendMessage() {
  const { printers, printerMap, reload: reloadPrinters } = usePrinters();
  const { processImage } = useDithering();
  const { resize } = useImageResize();

  // Printer selection
  const [selectedIds, setSelectedIds] = useState<string[]>(() => loadSavedIds());

  // Text area
  const [body, setBody] = useState('');
  const [senderName, setSenderName] = useState(
    () => localStorage.getItem(SENDER_NAME_KEY) ?? ''
  );
  const [fontSize, setFontSize] = useState(() => {
    const saved = localStorage.getItem(FONT_SIZE_KEY);
    const n = saved ? Number(saved) : 9;
    return isNaN(n) ? 9 : n;
  });
  const [wordWrap, setWordWrap] = useState(true);
  const [cursorLineLen, setCursorLineLen] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Image state
  const [currentFile, setCurrentFile] = useState<File | null>(null);
  const [previewSrc, setPreviewSrc] = useState('');
  const [processedBlob, setProcessedBlob] = useState<Blob | null>(null);
  const [isGrayscale, setIsGrayscale] = useState(() => localStorage.getItem(GRAYSCALE_KEY) === '1');
  const [ditherMethod, setDitherMethod] = useState<DitherMethod>('ordered');
  const [brightness, setBrightness] = useState(0);
  const [contrast, setContrast] = useState(0);
  const [threshold, setThreshold] = useState(128);
  const [isDragging, setIsDragging] = useState(false);

  // Webcam
  const [webcamActive, setWebcamActive] = useState(false);
  const webcamStreamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const webcamCanvasRef = useRef<HTMLCanvasElement>(null);

  // Submit
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  // Hidden file inputs
  const fileBrowseRef = useRef<HTMLInputElement>(null);
  const fileCaptureRef = useRef<HTMLInputElement>(null);

  // Column counter
  const maxCols = (() => {
    if (selectedIds.length === 0) return colsForFontSize(fontSize);
    const cols = selectedIds.map((id) => {
      const p = printerMap[id];
      if (!p) return colsForFontSize(fontSize);
      return (p.font_size ?? 9) === fontSize ? (p.columns ?? colsForFontSize(fontSize)) : colsForFontSize(fontSize);
    });
    return Math.min(...cols);
  })();

  function updateCursorStats() {
    const ta = textareaRef.current;
    if (!ta) return;
    const text = ta.value;
    const cursorPos = ta.selectionStart ?? text.length;
    const textBefore = text.slice(0, cursorPos);
    const cursorLine = textBefore.split('\n').length - 1;
    const lines = text.split('\n');
    setCursorLineLen([...(lines[cursorLine] ?? '')].length);
  }

  // Re-render preview whenever dithering settings change
  const renderDither = useCallback(async () => {
    if (!currentFile) return;
    if (!isGrayscale) {
      const reader = new FileReader();
      reader.onload = (e) => {
        setPreviewSrc(e.target!.result as string);
        setProcessedBlob(null);
      };
      reader.readAsDataURL(currentFile);
      return;
    }
    try {
      const { dataUrl, blob } = await processImage(currentFile, { method: ditherMethod, brightness, contrast, threshold });
      setPreviewSrc(dataUrl);
      setProcessedBlob(blob);
    } catch {
      setProcessedBlob(null);
    }
  }, [currentFile, isGrayscale, ditherMethod, brightness, contrast, threshold, processImage]);

  // Debounce render
  const renderTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleRender = useCallback(() => {
    if (renderTimerRef.current) clearTimeout(renderTimerRef.current);
    renderTimerRef.current = setTimeout(renderDither, 40);
  }, [renderDither]);

  useEffect(() => {
    scheduleRender();
  }, [scheduleRender]);

  function setImage(file: File) {
    setCurrentFile(file);
    stopWebcam();
  }

  function clearImage() {
    setCurrentFile(null);
    setPreviewSrc('');
    setProcessedBlob(null);
    if (fileBrowseRef.current) fileBrowseRef.current.value = '';
    if (fileCaptureRef.current) fileCaptureRef.current.value = '';
  }

  function stopWebcam() {
    if (webcamStreamRef.current) {
      webcamStreamRef.current.getTracks().forEach((t) => t.stop());
      webcamStreamRef.current = null;
    }
    setWebcamActive(false);
    if (videoRef.current) videoRef.current.srcObject = null;
  }

  async function startWebcam(e: React.MouseEvent) {
    e.preventDefault();
    if (/Mobi|Android|iPhone|iPad|IEMobile/i.test(navigator.userAgent)) {
      fileCaptureRef.current?.click();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      fileBrowseRef.current?.click();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false });
      webcamStreamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setWebcamActive(true);
      setPreviewSrc('');
      setCurrentFile(null);
    } catch {
      fileBrowseRef.current?.click();
    }
  }

  function snapWebcam(e: React.MouseEvent) {
    e.preventDefault();
    const video = videoRef.current;
    const canvas = webcamCanvasRef.current;
    if (!video || !canvas) return;
    const w = video.videoWidth || 640;
    const h = video.videoHeight || 480;
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d')!.drawImage(video, 0, 0, w, h);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const file = new File([blob], `photo-${Date.now()}.jpg`, { type: 'image/jpeg' });
      setImage(file);
    }, 'image/jpeg', 0.92);
  }

  function handlePaste(e: React.ClipboardEvent | ClipboardEvent) {
    const items = (e as ClipboardEvent).clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) setImage(file);
        break;
      }
    }
  }

  useEffect(() => {
    document.addEventListener('paste', handlePaste as EventListener);
    return () => document.removeEventListener('paste', handlePaste as EventListener);
  });

  // Apply font size px to textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.fontSize = `${Math.round(fontSize * 96 / 72)}px`;
    }
  }, [fontSize]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFeedback(null);
    if (selectedIds.length === 0) {
      setFeedback({ type: 'error', msg: 'Please select at least one printer.' });
      return;
    }
    if (!body.trim() && !currentFile) {
      setFeedback({ type: 'error', msg: 'Please enter a message or attach an image.' });
      return;
    }
    setSubmitting(true);
    try {
      const results = await Promise.all(
        selectedIds.map(async (printer_id) => {
          const fd = new FormData();
          fd.append('printer_id', printer_id);
          if (senderName.trim()) fd.append('sender_name', senderName.trim());
          if (body) fd.append('body', body);
          fd.append('word_wrap', wordWrap ? '1' : '0');
          fd.append('font_size', String(fontSize));
          if (currentFile) {
            const imageToSend = isGrayscale && processedBlob
              ? new File([processedBlob], currentFile.name.replace(/\.[^.]+$/, '.png'), { type: 'image/png' })
              : await resize(currentFile);
            fd.append('image', imageToSend, imageToSend.name);
          }
          const res = await fetch('/api/messages', { method: 'POST', body: fd });
          if (!res.ok) {
            let msg = `Server error (${res.status})`;
            try { const d = await res.json() as { error?: string }; if (d.error) msg = d.error; } catch { /**/ }
            return { success: false, error: msg };
          }
          return res.json() as Promise<{ success: boolean }>;
        })
      );
      const allOk = results.every((d) => (d as { success: boolean }).success);
      if (allOk) {
        const label = selectedIds.length > 1 ? `${selectedIds.length} printers` : 'printer';
        setFeedback({ type: 'success', msg: `✓ Sent to ${label}! Printing shortly.` });
        setBody('');
        clearImage();
        reloadPrinters();
      } else {
        const errs = (results as { success: boolean; error?: string }[])
          .filter((d) => !d.success)
          .map((d) => d.error)
          .join('; ');
        setFeedback({ type: 'error', msg: errs || 'Some messages failed.' });
      }
    } catch {
      setFeedback({ type: 'error', msg: 'Network error — could not reach the server.' });
    } finally {
      setSubmitting(false);
    }
  }

  // First selected printer status for the status strip
  const statusPrinter = selectedIds.length > 0 ? printerMap[selectedIds[0]] : null;
  const statusInfo = statusPrinter ? printerStatusText(statusPrinter) : null;

  return (
    <section className="tab-panel active">
      <div className="panel-header">
        <h1>Send a Message</h1>
      </div>
      <form onSubmit={handleSubmit}>

        {/* Printer selection */}
        <div className="field">
          <label>
            <span className="label-text">Destination Printer(s)</span>
            <span className="label-hint">Select one or more printers</span>
          </label>
          <PrinterChecklist
            printers={printers}
            printerMap={printerMap}
            selectedIds={selectedIds}
            onChange={setSelectedIds}
          />
          {statusInfo && selectedIds.length > 0 && (
            <div className={`printer-status ${statusInfo.online ? 'online' : 'offline'}`}>
              {statusInfo.label}
              {selectedIds.length > 1 ? ` (+${selectedIds.length - 1} more)` : ''}
              {statusPrinter?.description ? ` — ${statusPrinter.description}` : ''}
            </div>
          )}
        </div>

        {/* Sender name */}
        <div className="field">
          <label htmlFor="sender_name">
            <span className="label-text">Your Name</span>
            <span className="label-hint">Optional</span>
          </label>
          <input
            type="text"
            id="sender_name"
            value={senderName}
            onChange={(e) => {
              setSenderName(e.target.value);
              localStorage.setItem(SENDER_NAME_KEY, e.target.value);
            }}
            placeholder="Jane Smith"
            maxLength={100}
          />
        </div>

        {/* Message textarea */}
        <div className="field">
          <div className="textarea-toolbar">
            <div>
              <span className="label-text">Message</span>
              <span className="label-hint" style={{ marginLeft: 6 }}>Monospace · ASCII art &amp; emoji welcome</span>
            </div>
            <div className="textarea-controls">
              <label className="control-label" htmlFor="font-size-select">Size</label>
              <select
                id="font-size-select"
                value={fontSize}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  setFontSize(n);
                  localStorage.setItem(FONT_SIZE_KEY, String(n));
                }}
                title="Print font size"
              >
                {[7, 8, 9, 10, 11, 12, 14].map((s) => (
                  <option key={s} value={s}>{s}pt</option>
                ))}
              </select>
              <label className="toggle-label" title="Word wrap long lines automatically">
                <input
                  type="checkbox"
                  checked={wordWrap}
                  onChange={(e) => setWordWrap(e.target.checked)}
                />
                <span className="toggle-track"><span className="toggle-thumb" /></span>
                <span className="control-label">Wrap</span>
              </label>
            </div>
          </div>
          <textarea
            ref={textareaRef}
            id="body"
            rows={10}
            placeholder="Type your message here…"
            maxLength={5000}
            spellCheck={false}
            className={wordWrap ? 'word-wrap-on' : ''}
            value={body}
            onChange={(e) => { setBody(e.target.value); updateCursorStats(); }}
            onKeyUp={updateCursorStats}
            onClick={updateCursorStats}
          />
          <div className="char-count-row">
            <span className={cursorLineLen > maxCols ? 'col-over' : ''}>
              Col {cursorLineLen} / {maxCols}
            </span>
            <span><span>{[...body].length}</span> chars total</span>
          </div>
        </div>

        {/* Image section */}
        <div className="field">
          <label>
            <span className="label-text">Image</span>
            <span className="label-hint">Optional — upload or take a photo</span>
          </label>
          <div className="image-btn-row">
            <button
              type="button"
              className="btn btn-outline"
              onClick={(e) => { e.preventDefault(); fileBrowseRef.current?.click(); }}
            >
              <svg viewBox="0 0 20 20" fill="none"><rect x="2" y="4" width="16" height="13" rx="1.5" stroke="currentColor" strokeWidth="1.5" /><path d="M2 13l4-4 4 4 3-3 4 3" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>
              Browse File
            </button>
            <button type="button" className="btn btn-outline" onClick={startWebcam}>
              <svg viewBox="0 0 20 20" fill="none"><circle cx="10" cy="11" r="3" stroke="currentColor" strokeWidth="1.5" /><path d="M7.5 4h5l1.5 2H15a1 1 0 011 1v8a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h1L7.5 4z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /></svg>
              Take Photo
            </button>
            {currentFile && (
              <button
                type="button"
                className={`btn btn-outline${isGrayscale ? ' active' : ''}`}
                title="Toggle thermal print preview"
                onClick={() => {
                  const next = !isGrayscale;
                  setIsGrayscale(next);
                  localStorage.setItem(GRAYSCALE_KEY, next ? '1' : '0');
                }}
              >
                <svg viewBox="0 0 20 20" fill="none"><circle cx="10" cy="10" r="7" stroke="currentColor" strokeWidth="1.5" /><path d="M10 3a7 7 0 010 14V3z" fill="currentColor" /></svg>
                B&amp;W Options
              </button>
            )}
          </div>

          <input
            ref={fileBrowseRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={() => { const f = fileBrowseRef.current?.files?.[0]; if (f) setImage(f); }}
          />
          <input
            ref={fileCaptureRef}
            type="file"
            accept="image/*"
            capture="environment"
            style={{ display: 'none' }}
            onChange={() => { const f = fileCaptureRef.current?.files?.[0]; if (f) setImage(f); }}
          />

          {/* Dithering controls */}
          {isGrayscale && currentFile && (
            <div className="image-adjust-panel">
              <div className="image-adjust-row">
                <label className="image-adjust-label" htmlFor="dither-method">Dithering</label>
                <select
                  id="dither-method"
                  className="image-adjust-select"
                  value={ditherMethod}
                  onChange={(e) => setDitherMethod(e.target.value as DitherMethod)}
                >
                  <option value="none">None (solid threshold)</option>
                  <option value="ordered">Ordered (Bayer 4×4)</option>
                  <option value="floyd">Floyd-Steinberg</option>
                  <option value="atkinson">Atkinson</option>
                </select>
              </div>
              {([
                { id: 'img-brightness', label: 'Brightness', value: brightness, setValue: setBrightness, min: -100, max: 100 },
                { id: 'img-contrast',   label: 'Contrast',   value: contrast,   setValue: setContrast,   min: -100, max: 100 },
                { id: 'img-threshold',  label: 'Threshold',  value: threshold,  setValue: setThreshold,  min: 0,    max: 255 },
              ] as const).map(({ id, label, value, setValue, min, max }) => (
                <div key={id} className="image-adjust-row">
                  <label className="image-adjust-label" htmlFor={id}>{label}</label>
                  <div className="image-adjust-slider-wrap">
                    <input
                      type="range"
                      id={id}
                      min={min}
                      max={max}
                      value={value}
                      className="image-adjust-slider"
                      onChange={(e) => setValue(Number(e.target.value))}
                    />
                    <span className="image-adjust-val">{value}</span>
                  </div>
                </div>
              ))}
              <button
                type="button"
                className="btn btn-outline btn-sm"
                style={{ alignSelf: 'flex-start', marginTop: 2 }}
                onClick={() => { setBrightness(0); setContrast(0); setThreshold(128); }}
              >
                Reset
              </button>
            </div>
          )}

          {/* Drop zone */}
          <div
            className={`drop-zone${isDragging ? ' drag-over' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragging(false);
              const file = e.dataTransfer.files[0];
              if (file?.type.startsWith('image/')) setImage(file);
            }}
            onPaste={(e) => handlePaste(e as unknown as ClipboardEvent)}
          >
            {currentFile && previewSrc ? (
              <div className="drop-zone-preview">
                <img id="preview-img" src={previewSrc} alt="Preview" />
                <button
                  type="button"
                  className="remove-image"
                  onClick={(e) => { e.preventDefault(); clearImage(); }}
                >
                  ✕ Remove
                </button>
              </div>
            ) : (
              <div className="drop-zone-idle">
                <svg viewBox="0 0 40 40" fill="none">
                  <path d="M20 8v16M13 15l7-7 7 7" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M8 28h24" stroke="var(--fg-muted)" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                <p>
                  drag &amp; drop, or{' '}
                  <span className="link" onClick={() => fileBrowseRef.current?.click()}>browse</span>
                  &nbsp;·&nbsp; Ctrl+V to paste
                </p>
              </div>
            )}
          </div>

          {/* Webcam panel */}
          {webcamActive && (
            <div className="webcam-panel">
              <video ref={videoRef} autoPlay playsInline muted />
              <canvas ref={webcamCanvasRef} style={{ display: 'none' }} />
              <div className="webcam-controls">
                <button type="button" className="btn btn-primary" onClick={snapWebcam}>Capture</button>
                <button type="button" className="btn btn-outline" onClick={(e) => { e.preventDefault(); stopWebcam(); }}>Cancel</button>
              </div>
            </div>
          )}
        </div>

        <button type="submit" className="btn btn-primary" disabled={submitting}>
          <svg viewBox="0 0 20 20" fill="none"><path d="M3 10l14-7-7 14V10H3z" fill="currentColor" /></svg>
          {submitting ? 'Sending…' : selectedIds.length > 1 ? 'Send to Printers' : 'Send to Printer'}
        </button>

        {feedback && <FeedbackBanner type={feedback.type} message={feedback.msg} />}
      </form>
    </section>
  );
}
