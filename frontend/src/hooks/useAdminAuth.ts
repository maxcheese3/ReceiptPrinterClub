import { useState, useCallback } from 'react';

const ADMIN_TOKEN_KEY = 'printbridge_admin_token';

export function useAdminAuth() {
  const [token, setToken] = useState<string | null>(
    () => sessionStorage.getItem(ADMIN_TOKEN_KEY)
  );

  const login = useCallback((t: string) => {
    setToken(t);
    sessionStorage.setItem(ADMIN_TOKEN_KEY, t);
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    sessionStorage.removeItem(ADMIN_TOKEN_KEY);
  }, []);

  const authFetch = useCallback(
    async (path: string, opts: RequestInit = {}): Promise<Response> => {
      const res = await fetch(path, {
        ...opts,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          ...(opts.headers ?? {}),
        },
      });
      if (res.status === 401) {
        logout();
        throw new Error('Session expired — please log in again.');
      }
      return res;
    },
    [token, logout]
  );

  return { token, login, logout, authFetch };
}
