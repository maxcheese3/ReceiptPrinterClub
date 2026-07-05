import { useEffect } from 'react';
import type { Message } from '../types/api';

interface MessageModalProps {
  message: Message | null;
  onClose: () => void;
}

export default function MessageModal({ message, onClose }: MessageModalProps) {
  useEffect(() => {
    if (!message) return;
    document.body.style.overflow = 'hidden';
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => {
      document.body.style.overflow = '';
      document.removeEventListener('keydown', handler);
    };
  }, [message, onClose]);

  if (!message) return null;

  const meta = [
    new Date(message.created_at + 'Z').toLocaleString(),
    message.printer_name ?? message.printer_id.slice(0, 8),
    `From: ${message.sender_name ?? '(unknown)'}`,
    message.source,
  ].join('  ·  ');

  return (
    <div
      id="msg-modal"
      className="msg-modal-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="msg-modal-box">
        <div className="msg-modal-header">
          <span id="msg-modal-meta">{meta}</span>
          <button className="msg-modal-close" onClick={onClose}>✕</button>
        </div>
        <pre className="msg-modal-body">{message.body ?? '(no text body)'}</pre>
        {message.image_path && (
          <div className="msg-modal-img">
            <img
              src={`/uploads/${message.image_path}`}
              alt="Message image"
              style={{ maxWidth: '100%', borderRadius: 6 }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
