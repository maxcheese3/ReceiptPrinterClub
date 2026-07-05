import type { Printer } from '../types/api';

const STORAGE_KEY = 'printbridge_selected_printers';

interface PrinterChecklistProps {
  printers: Printer[];
  printerMap: Record<string, Printer>;
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}

export function loadSavedIds(): string[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as string[];
  } catch {
    return [];
  }
}

export function saveIds(ids: string[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
}

export function printerStatusText(printer: Printer): { online: boolean; label: string } {
  if (!printer.last_seen) {
    return { online: false, label: '⚫ Not yet connected' };
  }
  const diff = Date.now() - new Date(printer.last_seen + 'Z').getTime();
  const minutes = Math.floor(diff / 60_000);
  const online = minutes < 6;
  const when = minutes < 1 ? 'just now' : minutes === 1 ? '1 min ago' : `${minutes} min ago`;
  return {
    online,
    label: online ? '🟢 Online' : `⚫ Last seen ${when}`,
  };
}

export default function PrinterChecklist({
  printers,
  printerMap,
  selectedIds,
  onChange,
}: PrinterChecklistProps) {
  if (printers.length === 0) {
    return <div className="printer-checklist-loading">No printers registered yet</div>;
  }

  function toggle(id: string) {
    const next = selectedIds.includes(id)
      ? selectedIds.filter((x) => x !== id)
      : [...selectedIds, id];
    saveIds(next);
    onChange(next);
  }

  return (
    <div className="printer-checklist">
      {printers.map((p) => {
        const { online } = printerMap[p.id]
          ? printerStatusText(printerMap[p.id])
          : { online: false };
        const title = [p.description, p.location].filter(Boolean).join(' · ') || p.name;
        return (
          <label key={p.id} className="printer-check-item" title={title}>
            <input
              type="checkbox"
              value={p.id}
              checked={selectedIds.includes(p.id)}
              onChange={() => toggle(p.id)}
            />
            <span className="printer-check-name">{p.name}</span>
            <span
              className="printer-check-status"
              data-printer-id={p.id}
              title={online ? 'Online' : 'Offline'}
            >
              {online ? '🟢' : '⚫'}
            </span>
          </label>
        );
      })}
    </div>
  );
}
