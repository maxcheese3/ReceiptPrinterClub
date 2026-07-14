import { useState, useRef, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import PrinterMultiSelect from '../components/PrinterMultiSelect';
import { loadSavedIds, saveIds } from '../components/PrinterChecklist';
import { usePrinters } from '../hooks/usePrinters';
import { useDithering } from '../hooks/useDithering';
import { useImageResize } from '../hooks/useImageResize';
import type { DitherMethod } from '../hooks/useDithering';
import PrintConfirmModal from '../components/PrintConfirmModal';
import type { PrintResult } from '../components/PrintConfirmModal';
import { usePrinterAuth } from '../contexts/PrinterAuthContext';
import RecentActivity from '../components/RecentActivity';
import { addGuestMessage } from '../lib/guestHistory';
import type { GuestSentMessage } from '../types/api';

const GRAYSCALE_KEY = 'printbridge_grayscale_v2';
const SENDER_NAME_KEY = 'printbridge_sender_name';
const ANONYMOUS_KEY   = 'printbridge_send_anonymous';
const FONT_SIZE_KEY = 'printbridge_font_size';
const ACTIVE_TAB_KEY = 'printbridge_active_tab';
const WORD_WRAP_KEY = 'printbridge_word_wrap';
const DITHER_METHOD_KEY = 'printbridge_dither_method';
const SHOW_ADVANCED_KEY = 'printbridge_show_advanced';
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

  // When logged in to a printer we send the API key with each message, so the
  // server can attribute it and keep the sent history for us. When logged out
  // we record the send in localStorage instead (see lib/guestHistory).
  const { apiKey } = usePrinterAuth();

  // Bumped after each successful send so the history list below re-reads.
  const [historyVersion, setHistoryVersion] = useState(0);

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
  const [senderName, setSenderName] = useState(
    () => localStorage.getItem(SENDER_NAME_KEY) ?? ''
  );

  // "Send anonymous" — logged-in users opting out of attribution for a message.
  // Persisted so it survives a reload mid-compose, but it defaults to OFF, and
  // it's force-cleared on logout below: the risk of silently sending attributed
  // when you meant anonymous (or vice versa) is worse than re-ticking a box.
  const [anonymous, setAnonymous] = useState(
    () => localStorage.getItem(ANONYMOUS_KEY) === '1'
  );

  // Tabs
  const [activeTab, setActiveTab] = useState<ActiveTab>(() => {
    const saved = localStorage.getItem(ACTIVE_TAB_KEY);
    return (saved === 'ascii' ? 'ascii' : 'text') as ActiveTab;
  });
  const [wordWrap, setWordWrap] = useState(() => {
    const saved = localStorage.getItem(WORD_WRAP_KEY);
    return saved === null ? true : saved === '1';
  });

  function handleTabChange(tab: ActiveTab) {
    setActiveTab(tab);
    localStorage.setItem(ACTIVE_TAB_KEY, tab);
    const defaultWrap = tab === 'text';
    setWordWrap(defaultWrap);
    localStorage.setItem(WORD_WRAP_KEY, defaultWrap ? '1' : '0');
  }

  // Body
  const [body, setBody] = useState('');
  const [fontSize, setFontSize] = useState(() => {
    const saved = localStorage.getItem(FONT_SIZE_KEY);
    const n = saved ? Number(saved) : 12;
    return isNaN(n) ? 12 : n;
  });
  const [cursorLineLen, setCursorLineLen] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Advanced toggle
  const [showAdvanced, setShowAdvanced] = useState(() =>
    localStorage.getItem(SHOW_ADVANCED_KEY) === '1'
  );

  // Image state
  const [currentFile, setCurrentFile] = useState<File | null>(null);
  const [previewSrc, setPreviewSrc] = useState('');
  const [processedBlob, setProcessedBlob] = useState<Blob | null>(null);
  const [isGrayscale, setIsGrayscale] = useState(() => localStorage.getItem(GRAYSCALE_KEY) === '1');
  const [ditherMethod, setDitherMethod] = useState<DitherMethod>(() => {
    const saved = localStorage.getItem(DITHER_METHOD_KEY);
    return (['none', 'ordered', 'floyd', 'atkinson'].includes(saved ?? '') ? saved : 'ordered') as DitherMethod;
  });
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
  const [printResult, setPrintResult] = useState<PrintResult | null>(null);

  // Hidden file inputs
  const fileBrowseRef = useRef<HTMLInputElement>(null);
  const fileCaptureRef = useRef<HTMLInputElement>(null);

  const isMobile = /Mobi|Android|iPhone|iPad|IEMobile/i.test(navigator.userAgent);

  // Column counter — use the narrowest printer's actual column count, scaled to the selected font size
  const maxCols = (() => {
    if (selectedIds.length === 0) return colsForFontSize(fontSize);
    const cols = selectedIds.map((id) => {
      const p = printerMap[id];
      if (!p) return colsForFontSize(fontSize);
      const printerFontSize = p.font_size ?? 9;
      const printerCols = p.columns ?? colsForFontSize(printerFontSize);
      return printerFontSize === fontSize
        ? printerCols
        : Math.round(printerCols * printerFontSize / fontSize);
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

  // The toggle is hidden when logged out, so a stale "on" value would be an
  // invisible setting that silently changes behaviour the moment you log back
  // in. Clear it whenever there's no session.
  useEffect(() => {
    if (!apiKey && anonymous) {
      setAnonymous(false);
      localStorage.setItem(ANONYMOUS_KEY, '0');
    }
  }, [apiKey, anonymous]);

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

  const handlePaste = useCallback((e: React.ClipboardEvent | ClipboardEvent) => {
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
  }, []);

  useEffect(() => {
    document.addEventListener('paste', handlePaste as EventListener);
    return () => document.removeEventListener('paste', handlePaste as EventListener);
  }, [handlePaste]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPrintResult(null);
    if (selectedIds.length === 0) {
      setPrintResult({ status: 'error', printerNames: [], senderName: '', errors: ['Please select at least one printer.'] });
      return;
    }
    if (!body.trim() && !currentFile) {
      setPrintResult({ status: 'error', printerNames: [], senderName: '', errors: ['Please enter a message or attach an image.'] });
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

          // Identify ourselves if logged in, so the server can record this in our
          // sent history. `via=web` keeps the message classified as a web send
          // rather than API traffic — logging in shouldn't reclassify it.
          //
          // We still send the key on an anonymous send (it drives rate limiting);
          // the `anonymous` flag tells the server to authenticate us but NOT
          // record who we are. Dropping the key instead would let anyone bypass
          // rate limits by ticking the box.
          const headers: HeadersInit = {};
          if (apiKey) {
            headers['X-API-Key'] = apiKey;
            fd.append('via', 'web');
            if (anonymous) fd.append('anonymous', '1');
          }

          const res = await fetch('/api/messages', { method: 'POST', body: fd, headers });
          if (!res.ok) {
            let msg = `Server error (${res.status})`;
            try { const d = await res.json() as { error?: string }; if (d.error) msg = d.error; } catch { /**/ }
            return { success: false, error: msg, printer_id };
          }
          const data = await res.json() as {
            success: boolean; message_id: string; image_path?: string; created_at?: string;
          };
          return { ...data, printer_id };
        })
      );

      // Guests have no server-side history, so persist the send locally. We do
      // this per-recipient (a send to 3 printers is 3 history entries, matching
      // how the server stores them) and record failures too — "did that send?"
      // is exactly when someone checks their history.
      // Where a send gets remembered depends on whether it's attributed:
      //
      //   attributed (logged in, not anonymous) -> the server recorded it against
      //     our printer; it'll come back from /recent. Nothing to do here.
      //
      //   unattributed (guest, OR logged in + anonymous) -> the server deliberately
      //     has no record of who sent it, so it can never appear in our server-side
      //     history. localStorage is the only place it can live. Without this, an
      //     anonymous send would vanish from the sender's view entirely.
      if (!apiKey || anonymous) {
        for (const r of results as Array<{
          success: boolean; error?: string; printer_id: string;
          message_id?: string; image_path?: string; created_at?: string;
        }>) {
          const entry: GuestSentMessage = {
            id:           r.message_id ?? `local-${Date.now()}-${r.printer_id}`,
            printer_id:   r.printer_id,
            printer_name: printerMap[r.printer_id]?.name ?? r.printer_id,
            sender_name:  senderName.trim() || undefined,
            body:         body || undefined,
            image_path:   r.image_path,
            created_at:   r.created_at ? r.created_at + 'Z' : new Date().toISOString(),
            status:       r.success ? 'sent' : 'failed',
            error:        r.success ? undefined : r.error,
          };
          addGuestMessage(entry);
        }
      }
      setHistoryVersion((v) => v + 1);
      const allOk = results.every((d) => d.success);
      const printerNames = selectedIds.map((id) => printerMap[id]?.name ?? id);
      if (allOk) {
        setPrintResult({
          status: 'success',
          printerNames,
          senderName: senderName.trim(),
          errors: [],
        });
        setBody('');
        clearImage();
        reloadPrinters();
      } else {
        const errs = (results as { success: boolean; error?: string }[])
          .filter((d) => !d.success)
          .map((d) => d.error ?? 'Unknown error');
        setPrintResult({
          status: 'error',
          printerNames,
          senderName: senderName.trim(),
          errors: errs.length > 0 ? errs : ['Some messages failed.'],
        });
      }
    } catch {
      setPrintResult({ status: 'error', printerNames: [], senderName: '', errors: ['Network error — could not reach the server.'] });
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
          {/* Input + toggle share one shaded shell so the toggle sits INSIDE the
              shaded area, exactly like the "Aa" button lives inside the tab pill. */}
          <div className={`from-shell${apiKey ? ' has-toggle' : ''}`}>
            <input
              type="text"
              id="v2-sender-name"
              value={senderName}
              onChange={(e) => {
                setSenderName(e.target.value);
                localStorage.setItem(SENDER_NAME_KEY, e.target.value);
              }}
              placeholder={anonymous ? 'Anonymous' : 'Your name (optional)'}
              maxLength={100}
            />

            {/* Only meaningful when logged in — a guest is already unattributed,
                so the toggle would be a no-op and just add confusion. */}
            {apiKey && (
              <button
                type="button"
                className={`send-v2-tabs-advanced from-anon-btn${anonymous ? ' open' : ''}`}
                onClick={() => {
                  const next = !anonymous;
                  setAnonymous(next);
                  localStorage.setItem(ANONYMOUS_KEY, next ? '1' : '0');
                }}
                title="Send without linking this message to your printer"
                aria-pressed={anonymous}
              >
                Anonymous
              </button>
            )}
          </div>
        </div>

        {apiKey && anonymous && (
          <div className="send-v2-advanced-body from-anon-note">
            This message won't be linked to your printer. It'll appear to the
            recipient as coming from <strong>{senderName.trim() || 'Anonymous'}</strong>,
            and their replies won't thread back to you.
          </div>
        )}

        {/* Message tabs */}
        <div className="field">
          <div className="send-v2-tabs">
            <button
              type="button"
              className={`send-v2-tab-btn${activeTab === 'text' ? ' active' : ''}`}
              onClick={() => handleTabChange('text')}
            >
              Text
            </button>
            <button
              type="button"
              className={`send-v2-tab-btn${activeTab === 'ascii' ? ' active' : ''}`}
              onClick={() => handleTabChange('ascii')}
            >
              ASCII Art
            </button>
            <button
              type="button"
              className={`send-v2-tabs-advanced${showAdvanced ? ' open' : ''}`}
              onClick={() => {
                const next = !showAdvanced;
                setShowAdvanced(next);
                localStorage.setItem(SHOW_ADVANCED_KEY, next ? '1' : '0');
              }}
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
                onChange={(e) => {
                  const n = Number(e.target.value);
                  setFontSize(n);
                  localStorage.setItem(FONT_SIZE_KEY, String(n));
                }}
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
                  onChange={(e) => {
                    setWordWrap(e.target.checked);
                    localStorage.setItem(WORD_WRAP_KEY, e.target.checked ? '1' : '0');
                  }}
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
              style={{ fontSize: '16px' }}
              value={body}
              onChange={(e) => { setBody(e.target.value); updateCursorStats(); autoResize(); }}
              onKeyUp={() => { updateCursorStats(); autoResize(); }}
              onClick={updateCursorStats}
            />
            <div className="send-v2-char-bar">
              {activeTab === 'ascii' && (
                <span className={cursorLineLen > maxCols ? 'col-over' : ''}>
                  Col {cursorLineLen} / {maxCols}
                </span>
              )}
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

              {!isMobile && !currentFile && !webcamActive && (
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
                  <span className="send-v2-attach-title">Add Photo or File</span>
                  <span className="send-v2-attach-hint">Drag &amp; drop files or photos here</span>
                  <div className="send-v2-attach-actions">
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
                </div>
              )}

              {isMobile && !currentFile && (
                <div className="send-v2-mobile-btns">
                  <button
                    type="button"
                    className="btn btn-outline"
                    onClick={() => fileBrowseRef.current?.click()}
                  >Add File</button>
                  <button
                    type="button"
                    className="btn btn-outline"
                    onClick={() => fileCaptureRef.current?.click()}
                  >Take Photo</button>
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
                          onChange={(e) => {
                            const m = e.target.value as DitherMethod;
                            setDitherMethod(m);
                            localStorage.setItem(DITHER_METHOD_KEY, m);
                          }}
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
          {submitting ? 'PRINTING…' : 'PRINT'}
        </button>

      </form>

      {/* History of what this person has sent. Reads from the server when logged
          in to a printer, from localStorage when not. */}
      <RecentActivity refreshKey={historyVersion} />

    </section>

    <PrintConfirmModal result={printResult} onClose={() => setPrintResult(null)} />
    </>
  );
}
