import { useState, useCallback } from 'react';

export function useApiKeyAuth(storageKey: string) {
  const [apiKey, setApiKeyState] = useState<string | null>(
    () => sessionStorage.getItem(storageKey)
  );

  const login = useCallback((key: string) => {
    setApiKeyState(key);
    sessionStorage.setItem(storageKey, key);
  }, [storageKey]);

  const logout = useCallback(() => {
    setApiKeyState(null);
    sessionStorage.removeItem(storageKey);
  }, [storageKey]);

  const authFetch = useCallback(
    async (path: string, opts: RequestInit = {}): Promise<Response> => {
      const res = await fetch(path, {
        ...opts,
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': apiKey ?? '',
          ...(opts.headers ?? {}),
        },
      });
      if (res.status === 401 || res.status === 403) {
        logout();
        throw new Error('Session expired — please sign in again.');
      }
      return res;
    },
    [apiKey, logout]
  );

  return { apiKey, login, logout, authFetch };
}
