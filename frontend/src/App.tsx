import { useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import MessageModal from './components/MessageModal';
import { useTheme } from './hooks/useTheme';
import SendMessage from './pages/SendMessage';
import RegisterPrinter from './pages/RegisterPrinter';
import ApiDocs from './pages/ApiDocs';
import SuperAdmin from './pages/SuperAdmin';
import Subscriptions from './pages/Subscriptions';
import PrinterAdmin from './pages/PrinterAdmin';
import type { Message } from './types/api';

export default function App() {
  const { theme, setTheme } = useTheme();
  const [modalMessage, setModalMessage] = useState<Message | null>(null);

  return (
    <BrowserRouter>
      <Layout theme={theme} onThemeChange={setTheme}>
        <Routes>
          <Route path="/" element={<Navigate to="/send" replace />} />
          <Route path="/send" element={<SendMessage />} />
          <Route path="/register" element={<RegisterPrinter />} />
          <Route path="/docs" element={<ApiDocs />} />
          <Route path="/admin" element={<SuperAdmin onOpenModal={setModalMessage} />} />
          <Route path="/subscriptions" element={<Subscriptions />} />
          <Route path="/printer-admin" element={<PrinterAdmin />} />
          <Route path="*" element={<Navigate to="/send" replace />} />
        </Routes>
      </Layout>
      <MessageModal message={modalMessage} onClose={() => setModalMessage(null)} />
    </BrowserRouter>
  );
}
