import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useApiKeyAuth } from '../hooks/useApiKeyAuth';
import type { Printer, PrinterStats } from '../types/api';

const PA_STORAGE_KEY = 'printbridge_pa_api_key';

interface PrinterAuthContextType {
  apiKey: string | null;
  printer: Printer | null;
  printerStats: PrinterStats | null;
  login: (key: string) => void;
  logout: () => void;
  authFetch: (path: string, opts?: RequestInit) => Promise<Response>;
  refreshPrinter: () => void;
}

const PrinterAuthContext = createContext<PrinterAuthContextType | null>(null);

export function PrinterAuthProvider({ children }: { children: React.ReactNode }) {
  const { apiKey, login, logout, authFetch } = useApiKeyAuth(PA_STORAGE_KEY);
  const [printer, setPrinter] = useState<Printer | null>(null);
  const [printerStats, setPrinterStats] = useState<PrinterStats | null>(null);

  const fetchPrinter = useCallback(() => {
    authFetch('/api/printer-admin/me')
      .then((res) => res.json() as Promise<{ printer: Printer; stats: PrinterStats }>)
      .then((data) => {
        setPrinter(data.printer);
        setPrinterStats(data.stats);
      })
      .catch(() => {});
  }, [authFetch]);

  useEffect(() => {
    if (!apiKey) {
      setPrinter(null);
      setPrinterStats(null);
      return;
    }
    fetchPrinter();
  }, [apiKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <PrinterAuthContext.Provider value={{ apiKey, printer, printerStats, login, logout, authFetch, refreshPrinter: fetchPrinter }}>
      {children}
    </PrinterAuthContext.Provider>
  );
}

export function usePrinterAuth(): PrinterAuthContextType {
  const ctx = useContext(PrinterAuthContext);
  if (!ctx) throw new Error('usePrinterAuth must be used within PrinterAuthProvider');
  return ctx;
}
