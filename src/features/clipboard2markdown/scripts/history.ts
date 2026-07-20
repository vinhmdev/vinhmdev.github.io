/**
 * Local document history for the Markdown share feature.
 *
 * There is no auth, so "my shared docs" can't live server-side. Each doc a
 * user creates or opens is remembered on THIS device in localStorage:
 * metadata (title, link, mode, times) plus a bounded list of content
 * snapshots so past versions can be restored locally. The link already
 * embeds the decryption key, so this is also where the key is kept.
 */
import type { PasteMode } from '@shared/paste/store';

const STORAGE_KEY = 'md:docs';
const MAX_DOCS = 40;
const MAX_VERSIONS = 12;
const MAX_CONTENT = 200_000; // don't snapshot enormous docs into localStorage

export interface DocVersion {
  ts: number;
  content: string;
}

export interface MyDoc {
  id: string;
  key: string;
  title: string;
  url: string;
  mode: PasteMode;
  createdAt: number;
  updatedAt: number;
  expireAt: number | null;
  versions: DocVersion[];
}

function readAll(): MyDoc[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    const now = Date.now();
    return arr.filter(
      (d): d is MyDoc =>
        d && typeof d.id === 'string' && typeof d.url === 'string' && (!d.expireAt || d.expireAt > now)
    );
  } catch {
    return [];
  }
}

function writeAll(docs: MyDoc[]): void {
  const trimmed = docs.slice(0, MAX_DOCS);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // Quota exceeded — drop version snapshots (the heavy part) and retry once.
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(trimmed.map((d) => ({ ...d, versions: d.versions.slice(0, 2) })))
      );
    } catch {
      /* give up — history is best-effort */
    }
  }
}

/** All docs, most-recently-updated first. */
export function getDocs(): MyDoc[] {
  return readAll().sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getDoc(id: string): MyDoc | undefined {
  return readAll().find((d) => d.id === id);
}

/**
 * Insert or update a doc's metadata, and (optionally) push a content
 * snapshot. Consecutive identical snapshots are de-duplicated.
 */
export function saveDoc(
  meta: Omit<MyDoc, 'versions'>,
  snapshot?: string
): void {
  const docs = readAll();
  const existing = docs.find((d) => d.id === meta.id);
  const versions = existing?.versions ?? [];

  if (typeof snapshot === 'string' && snapshot.length <= MAX_CONTENT) {
    if (versions[0]?.content !== snapshot) {
      versions.unshift({ ts: Date.now(), content: snapshot });
      versions.splice(MAX_VERSIONS);
    }
  }

  const next: MyDoc = { ...meta, versions };
  const others = docs.filter((d) => d.id !== meta.id);
  writeAll([next, ...others]);
}

export function removeDoc(id: string): void {
  writeAll(readAll().filter((d) => d.id !== id));
}

export function clearDocs(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
