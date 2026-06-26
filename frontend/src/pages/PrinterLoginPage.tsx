import { useEffect } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { usePrinterAuth } from '../contexts/PrinterAuthContext';
import PrinterLogin from '../components/PrinterLogin';

export default function PrinterLoginPage() {
  const { apiKey, login } = usePrinterAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (apiKey) navigate('/printer/settings', { replace: true });
  }, [apiKey, navigate]);

  if (apiKey) return <Navigate to="/printer/settings" replace />;

  function handleLogin(key: string) {
    login(key);
    navigate('/printer/settings', { replace: true });
  }

  return <PrinterLogin onLogin={handleLogin} />;
}
