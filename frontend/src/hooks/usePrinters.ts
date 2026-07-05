import { useState, useEffect, useCallback, useRef } from 'react';
import type { Printer } from '../types/api';

export interface PrintersState {
  printers: Printer[];
  printerMap: Record<string, Printer>;
  reload: () => Promise<void>;
}

export function usePrinters(): PrintersState {
  const [printers, setPrinters] = useState<Printer[]>([]);
  const [printerMap, setPrinterMap] = useState<Record<string, Printer>>({});
  const mountedRef = useRef(true);

  const reload = useCallback(async () => {
    try {
      const res = await fetch('/api/printers');
      const data = await res.json() as { printers: Printer[] };
      if (!mountedRef.current) return;
      const list = data.printers ?? [];
      const map: Record<string, Printer> = {};
      list.forEach((p) => { map[p.id] = p; });
      setPrinters(list);
      setPrinterMap(map);
    } catch {
      // silently ignore poll errors
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    reload();
    const interval = setInterval(reload, 10_000);
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, [reload]);

  return { printers, printerMap, reload };
}
