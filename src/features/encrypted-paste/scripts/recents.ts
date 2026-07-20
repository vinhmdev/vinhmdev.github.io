/**
 * Recent pastes — stored on the user's device only.
 *
 * There is no auth, so "my pastes" can't live server-side. Instead each
 * created link is remembered in localStorage (title + full share URL, which
 * includes the decryption key). This is the user's own machine, so keeping
 * the key here is acceptable and it lets them reopen their own pastes.
 */
const STORAGE_KEY = 'paste:recents';
const MAX_ITEMS = 30;

export interface RecentPaste {
  id: string;
  title: string;
  url: string;
  createdAt: number; // epoch ms
  expireAt: number | null; // epoch ms
}

/** Read all recents, newest first. Tolerates corrupt storage. */
export function getRecents(): RecentPaste[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    // Drop expired entries on read so the list self-cleans.
    const now = Date.now();
    return arr.filter(
      (r): r is RecentPaste =>
        r && typeof r.id === 'string' && typeof r.url === 'string' && (!r.expireAt || r.expireAt > now)
    );
  } catch {
    return [];
  }
}

function save(items: RecentPaste[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, MAX_ITEMS)));
  } catch {
    /* storage full or blocked — recents are best-effort */
  }
}

/** Prepend a new recent (de-duplicated by id). */
export function addRecent(item: RecentPaste): void {
  const items = getRecents().filter((r) => r.id !== item.id);
  items.unshift(item);
  save(items);
}

/** Remove one recent by id. */
export function removeRecent(id: string): void {
  save(getRecents().filter((r) => r.id !== id));
}

/** Clear the whole list. */
export function clearRecents(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
