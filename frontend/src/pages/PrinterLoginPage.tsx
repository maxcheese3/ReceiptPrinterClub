import { useEffect } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { usePrinterAuth } from '../contexts/PrinterAuthContext';
import PrinterLogin from '../components/PrinterLogin';

export default function PrinterLoginPage() {
  const { apiKey, login } = usePrinterAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (apiKey) navigate('/myprinter', { replace: true });
  }, [apiKey, navigate]);

  if (apiKey) return <Navigate to="/myprinter" replace />;

  function handleLogin(key: string) {
    login(key);
    navigate('/myprinter', { replace: true });
  }

  return <PrinterLogin onLogin={handleLogin} />;
}
