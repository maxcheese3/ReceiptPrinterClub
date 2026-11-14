import { useState, useCallback, useRef } from 'react';

const INITIAL = 10;
const MORE    = 25;
const MAX     = 200; // the server's per-request cap

export interface PagedList<T, R> {
  items: T[];
  /** False until the first page has come back, so lists can show "Loading…". */
  loaded: boolean;
  hasMore: boolean;
  /** The last full response, for extras like the Sent tab's stats. */
  lastResponse: R | null;
  loadMore: () => Promise<void>;
  /** Re-reads from the top, keeping as many rows as are already loaded so a
   *  background refresh doesn't undo "Load More". */
  refresh: () => Promise<void>;
}

/**
 * A "Load More" message list. `load` fetches one page and must be stable
 * (wrap it in useCallback).
 */
export function usePagedList<T, R extends { messages?: T[] }>(
  load: (limit: number, offset: number) => Promise<R>,
): PagedList<T, R> {
  const [items, setItems] = useState<T[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [lastResponse, setLastResponse] = useState<R | null>(null);

  const itemsRef = useRef<T[]>([]);
  // Only the newest request may write state, so a slow poll can't overwrite a
  // newer page (or vice versa).
  const seqRef = useRef(0);

  const fetchPage = useCallback(async (limit: number, offset: number, append: boolean) => {
    const seq = ++seqRef.current;
    try {
      const data = await load(limit, offset);
      if (seq !== seqRef.current) return;
      const page = data.messages ?? [];
      const next = append ? [...itemsRef.current, ...page] : page;
      itemsRef.current = next;
      setItems(next);
      setHasMore(page.length >= limit);
      setLastResponse(data);
    } catch { /* keep whatever we had */ }
    finally {
      if (seq === seqRef.current) setLoaded(true);
    }
  }, [load]);

  const refresh = useCallback(
    () => fetchPage(Math.min(MAX, Math.max(INITIAL, itemsRef.current.length)), 0, false),
    [fetchPage],
  );

  const loadMore = useCallback(
    () => fetchPage(MORE, itemsRef.current.length, true),
    [fetchPage],
  );

  return { items, loaded, hasMore, lastResponse, loadMore, refresh };
}
