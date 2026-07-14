import { formatTime } from './MessageCard';
import type { Direction } from '../types/api';

/**
 * One message in a conversation, laid out like a messaging app: messages you
 * sent align right, messages you received align left.
 *
 * The alignment alone carries the meaning for sighted users, but that's invisible
 * to a screen reader — so each bubble also has a visually-hidden "You sent"/
 * "They sent" prefix.
 */
interface ChatBubbleProps {
  direction: Direction;
  body?: string;
  imagePath?: string;
  status: string;
  createdAt: string;
  /** Who sent it — shown on received bubbles in guest threads, where each
   *  message can come from a differently-typed name. */
  senderLabel?: string;
}

export default function ChatBubble({
  direction, body, imagePath, status, createdAt, senderLabel,
}: ChatBubbleProps) {
  const isOut = direction === 'out';

  return (
    <div className={`chat-row ${isOut ? 'out' : 'in'}`}>
      <div className="chat-bubble">
        <span className="sr-only">{isOut ? 'You sent:' : 'Received:'}</span>

        {senderLabel && !isOut && (
          <div className="chat-sender">{senderLabel}</div>
        )}

        {imagePath && (
          <img
            className="chat-img"
            src={`/uploads/${imagePath}`}
            alt="attachment"
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
            onClick={() => window.open(`/uploads/${imagePath}`)}
          />
        )}

        {body && <div className="chat-body">{body}</div>}

        <div className="chat-meta">
          <span className="chat-time">{formatTime(createdAt)}</span>
          {/* Delivery state only matters for things you sent — a received message
              being "printed" is the other printer's business, not yours. */}
          {isOut && status !== 'printed' && (
            <span className={`chat-status status-${status}`}>{status}</span>
          )}
        </div>
      </div>
    </div>
  );
}
