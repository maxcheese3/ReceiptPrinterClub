import { useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { PrinterAuthProvider } from './contexts/PrinterAuthContext';
import Layout from './components/Layout';
import MessageModal from './components/MessageModal';
import { useTheme } from './hooks/useTheme';
import SendMessage from './pages/SendMessage';
import SendMessageV2 from './pages/SendMessageV2';
import RegisterPrinter from './pages/RegisterPrinter';
import ApiDocs from './pages/ApiDocs';
import SuperAdmin from './pages/SuperAdmin';
import PrinterLoginPage from './pages/PrinterLoginPage';
import PrinterSettings from './pages/PrinterSettings';
import PrinterMessageHistory from './pages/PrinterMessageHistory';
import PrinterSubscriptions from './pages/PrinterSubscriptions';
import type { Message } from './types/api';

export default function App() {
  const { theme, setTheme } = useTheme();
  const [modalMessage, setModalMessage] = useState<Message | null>(null);

  return (
    <BrowserRouter>
      <PrinterAuthProvider>
        <Layout theme={theme} onThemeChange={setTheme}>
          <Routes>
            <Route path="/" element={<Navigate to="/send-message" replace />} />
            <Route path="/send" element={<SendMessage />} />
            <Route path="/send-message" element={<SendMessageV2 />} />
            <Route path="/register" element={<RegisterPrinter />} />
            <Route path="/docs" element={<ApiDocs />} />
            <Route path="/admin" element={<SuperAdmin onOpenModal={setModalMessage} />} />
            {/* Legacy redirects */}
            <Route path="/subscriptions" element={<Navigate to="/printer/subscriptions" replace />} />
            <Route path="/printer-admin" element={<Navigate to="/printer/settings" replace />} />
            {/* Printer section */}
            <Route path="/printer/login" element={<PrinterLoginPage />} />
            <Route path="/printer/settings" element={<PrinterSettings />} />
            <Route path="/printer/message-history" element={<PrinterMessageHistory />} />
            <Route path="/printer/subscriptions" element={<PrinterSubscriptions />} />
            <Route path="*" element={<Navigate to="/send-message" replace />} />
          </Routes>
        </Layout>
        <MessageModal message={modalMessage} onClose={() => setModalMessage(null)} />
      </PrinterAuthProvider>
    </BrowserRouter>
  );
}
