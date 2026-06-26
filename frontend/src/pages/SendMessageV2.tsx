import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import PrinterMultiSelect from '../components/PrinterMultiSelect';
import { loadSavedIds, saveIds } from '../components/PrinterChecklist';
import { usePrinters } from '../hooks/usePrinters';
import { useDithering } from '../hooks/useDithering';
import { useImageResize } from '../hooks/useImageResize';
import type { DitherMethod } from '../hooks/useDithering';

const GRAYSCALE_KEY = 'printbridge_grayscale_v2';
const FONT_SIZE_COLS: Record<number, number> = { 7: 31, 8: 27, 9: 24, 10: 22, 11: 20, 12: 18, 14: 16 };

function colsForFontSize(pt: number): number {
  return FONT_SIZE_COLS[pt] ?? Math.round(24 * 9 / pt);
}

type ActiveTab = 'text' | 'ascii';

export default function SendMessageV2() {
  const { printers, printerMap, reload: reloadPrinters } = usePrinters();
  const { processImage } = useDithering();
  const { resize } = useImageResize();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  // TO: printer selection — URL param takes priority over localStorage
  const [selectedIds, setSelectedIds] = useState<string[]>(() => {
    const fromUrl = searchParams.get('to');
    if (fromUrl) return fromUrl.split(',').filter(Boolean);
    return loadSavedIds();
  });

  function handleSelectionChange(ids: string[]) {
    setSelectedIds(ids);
    saveIds(ids);
    setSearchParams(ids.length > 0 ? { to: ids.join(',') } : {}, { replace: true });
  }

  // FROM
  const [senderName, setSenderName] = useState('');

  // Tabs
  const [activeTab, setActiveTab] = useState<ActiveTab>('text');
  const [wordWrap, setWordWrap] = useState(true);

  // Auto-set word wrap when switching tabs
  useEffect(() => {
    setWordWrap(activeTab === 'text');
  }, [activeTab]);

  // Body
  const [body, setBody] = useState('');
  const [fontSize, setFontSize] = useState(9);
  const [cursorLineLen, setCursorLineLen] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Advanced toggle
  const [showAdvanced, setShowAdvanced] = useState(false);

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
  const [showBwPanel, setShowBwPanel] = useState(false);

  // Webcam
  const [webcamActive, setWebcamActive] = useState(false);
  const webcamStreamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const webcamCanvasRef = useRef<HTMLCanvasElement>(null);

  // Submit
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-dismiss toast
  useEffect(() => {
    if (!feedback) return;
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    const delay = 7000;
    feedbackTimerRef.current = setTimeout(() => setFeedback(null), delay);
    return () => { if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current); };
  }, [feedback]);

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

  const TEXTAREA_MAX_HEIGHT = 320;

  function autoResize() {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, TEXTAREA_MAX_HEIGHT) + 'px';
    ta.style.overflowY = ta.scrollHeight > TEXTAREA_MAX_HEIGHT ? 'auto' : 'hidden';
  }

  // Re-run auto-resize whenever body changes (handles programmatic clears after send)
  useEffect(() => { autoResize(); }, [body]);

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

  // Dither render
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

  const renderTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleRender = useCallback(() => {
    if (renderTimerRef.current) clearTimeout(renderTimerRef.current);
    renderTimerRef.current = setTimeout(renderDither, 40);
  }, [renderDither]);

  useEffect(() => { scheduleRender(); }, [scheduleRender]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.fontSize = `${Math.round(fontSize * 96 / 72)}px`;
    }
  }, [fontSize]);

  function setImage(file: File) {
    setCurrentFile(file);
    stopWebcam();
  }

  function clearImage() {
    setCurrentFile(null);
    setPreviewSrc('');
    setProcessedBlob(null);
    setShowBwPanel(false);
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

  return (
    <>
    <section className="tab-panel active send-v2">
      <div className="panel-header">
        <h1>Send a Message</h1>
      </div>
      <form onSubmit={handleSubmit} className="page-card">

        {/* TO — printer multi-select */}
        <div className="field send-v2-inline-field">
          <label>
            <span className="label-text">To</span>
          </label>
          <PrinterMultiSelect
            printers={printers}
            printerMap={printerMap}
            selectedIds={selectedIds}
            onChange={handleSelectionChange}
          />
        </div>

        {/* FROM — sender name */}
        <div className="field send-v2-inline-field">
          <label htmlFor="v2-sender-name">
            <span className="label-text">From</span>
          </label>
          <input
            type="text"
            id="v2-sender-name"
            value={senderName}
            onChange={(e) => setSenderName(e.target.value)}
            placeholder="Your name"
            maxLength={100}
          />
        </div>

        {/* Message tabs */}
        <div className="field">
          <div className="send-v2-tabs">
            <button
              type="button"
              className={`send-v2-tab-btn${activeTab === 'text' ? ' active' : ''}`}
              onClick={() => setActiveTab('text')}
            >
              Text
            </button>
            <button
              type="button"
              className={`send-v2-tab-btn${activeTab === 'ascii' ? ' active' : ''}`}
              onClick={() => setActiveTab('ascii')}
            >
              ASCII Art
            </button>
            <button
              type="button"
              className={`send-v2-tabs-advanced${showAdvanced ? ' open' : ''}`}
              onClick={() => setShowAdvanced((v) => !v)}
              title="Advanced options"
            >
              Aa
            </button>
          </div>

          {showAdvanced && (
            <div className="send-v2-advanced-body send-v2-advanced-body--inline">
              <label className="image-adjust-label" htmlFor="v2-font-size">Font size</label>
              <select
                id="v2-font-size"
                value={fontSize}
                onChange={(e) => setFontSize(Number(e.target.value))}
                title="Print font size"
                style={{ width: 'auto' }}
              >
                {[7, 8, 9, 10, 11, 12, 14].map((s) => (
                  <option key={s} value={s}>{s}pt</option>
                ))}
              </select>
              <span className="send-v2-advanced-divider" />
              <label className="image-adjust-label" htmlFor="v2-word-wrap">Wrap</label>
              <label className="toggle-label" title="Wrap long lines automatically">
                <input
                  id="v2-word-wrap"
                  type="checkbox"
                  checked={wordWrap}
                  onChange={(e) => setWordWrap(e.target.checked)}
                />
                <span className="toggle-track"><span className="toggle-thumb" /></span>
              </label>
            </div>
          )}

          {/* Shared textarea + stats bar */}
          <div className="send-v2-textarea-wrap">
            <textarea
              ref={textareaRef}
              id="v2-body"
              placeholder={activeTab === 'text' ? 'Type your message here…' : 'Paste or type ASCII art here…'}
              maxLength={5000}
              spellCheck={activeTab === 'text'}
              className={wordWrap ? 'word-wrap-on' : ''}
              value={body}
              onChange={(e) => { setBody(e.target.value); updateCursorStats(); autoResize(); }}
              onKeyUp={() => { updateCursorStats(); autoResize(); }}
              onClick={updateCursorStats}
            />
            <div className="send-v2-char-bar">
              <span className={cursorLineLen > maxCols ? 'col-over' : ''}>
                Col {cursorLineLen} / {maxCols}
              </span>
              <span>{[...body].length} chars</span>
            </div>
          </div>

          {/* Attachments — Text tab only */}
          {activeTab === 'text' && (
            <div className="send-v2-attach-area">
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

              {!currentFile && !webcamActive && (
                <div
                  className={`send-v2-attach-add-btn${isDragging ? ' drag-over' : ''}`}
                  onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setIsDragging(false);
                    const file = e.dataTransfer.files[0];
                    if (file?.type.startsWith('image/')) setImage(file);
                  }}
                >
                  <span
                    className="send-v2-attach-action"
                    role="button"
                    tabIndex={0}
                    onClick={() => fileBrowseRef.current?.click()}
                    onKeyDown={(e) => e.key === 'Enter' && fileBrowseRef.current?.click()}
                  >+ attachment</span>
                  <span className="send-v2-attach-sep">·</span>
                  <span
                    className="send-v2-attach-action"
                    role="button"
                    tabIndex={0}
                    onClick={startWebcam}
                    onKeyDown={(e) => { if (e.key === 'Enter') startWebcam(e as unknown as React.MouseEvent); }}
                  >take photo</span>
                </div>
              )}

              {currentFile && previewSrc && (
                <div className="send-v2-attach-preview-wrap">
                  <div className="send-v2-attach-preview-header">
                    <button
                      type="button"
                      className={`btn btn-outline btn-sm${showBwPanel ? ' active' : ''}`}
                      onClick={() => {
                        const next = !showBwPanel;
                        setShowBwPanel(next);
                        if (next !== isGrayscale) {
                          setIsGrayscale(next);
                          localStorage.setItem(GRAYSCALE_KEY, next ? '1' : '0');
                        }
                      }}
                    >
                      B&amp;W
                    </button>
                  </div>
                  <img src={previewSrc} alt="Preview" className="send-v2-attach-preview-img" />
                  {showBwPanel && (
                    <div className="image-adjust-panel">
                      <div className="image-adjust-row">
                        <label className="image-adjust-label" htmlFor="v2-dither-method">Dithering</label>
                        <select
                          id="v2-dither-method"
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
                        { id: 'v2-brightness', label: 'Brightness', value: brightness, setValue: setBrightness, min: -100, max: 100 },
                        { id: 'v2-contrast',   label: 'Contrast',   value: contrast,   setValue: setContrast,   min: -100, max: 100 },
                        { id: 'v2-threshold',  label: 'Threshold',  value: threshold,  setValue: setThreshold,  min: 0,    max: 255 },
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
                  <button
                    type="button"
                    className="send-v2-attach-remove-btn"
                    onClick={(e) => { e.preventDefault(); clearImage(); }}
                  >
                    remove attachment
                  </button>
                </div>
              )}

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
          )}
        </div>

        <button type="submit" className="btn btn-primary" disabled={submitting}>
          <svg viewBox="0 0 20 20" fill="none"><path d="M3 10l14-7-7 14V10H3z" fill="currentColor" /></svg>
          {submitting ? 'Sending…' : selectedIds.length > 1 ? 'Send to Printers' : 'Send to Printer'}
        </button>

        <Link to="/send" className="send-v2-legacy-link">Use legacy send page</Link>

      </form>

    </section>

    {feedback && createPortal(
      <div className={`send-v2-toast send-v2-toast--${feedback.type}`} role="status">
        <span>{feedback.msg}</span>
        <button
          type="button"
          className="send-v2-toast-close"
          aria-label="Dismiss"
          onClick={() => setFeedback(null)}
        >
          ✕
        </button>
      </div>,
      document.body
    )}
    </>
  );
}
