/**
 * Local document history for the encrypted-share feature (shared by the
 * Markdown and Encrypted-Paste tools).
 *
 * There is no auth, so "my shared docs" can't live server-side. Each doc a
 * user creates or opens is remembered on THIS device in localStorage:
 * metadata (title, link, mode, times) plus a bounded list of content
 * snapshots so past versions can be restored locally. The link already
 * embeds the decryption key, so this is also where the key is kept.
 *
 * The store is created per tool via `createDocStore(storageKey)` so each
 * tool keeps its own list — the Markdown docs and the Paste docs never mix.
 */
import type { PasteMode } from '@shared/paste/store';

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

export interface DocStore {
  getDocs(): MyDoc[];
  getDoc(id: string): MyDoc | undefined;
  saveDoc(meta: Omit<MyDoc, 'versions'>, snapshot?: string): void;
  removeDoc(id: string): void;
  clearDocs(): void;
}

export function createDocStore(storageKey: string): DocStore {
  function readAll(): MyDoc[] {
    try {
      const raw = localStorage.getItem(storageKey);
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
      localStorage.setItem(storageKey, JSON.stringify(trimmed));
    } catch {
      // Quota exceeded — drop version snapshots (the heavy part) and retry once.
      try {
        localStorage.setItem(
          storageKey,
          JSON.stringify(trimmed.map((d) => ({ ...d, versions: d.versions.slice(0, 2) })))
        );
      } catch {
        /* give up — history is best-effort */
      }
    }
  }

  return {
    /** All docs, most-recently-updated first. */
    getDocs(): MyDoc[] {
      return readAll().sort((a, b) => b.updatedAt - a.updatedAt);
    },

    getDoc(id: string): MyDoc | undefined {
      return readAll().find((d) => d.id === id);
    },

    /**
     * Insert or update a doc's metadata, and (optionally) push a content
     * snapshot. Consecutive identical snapshots are de-duplicated.
     */
    saveDoc(meta: Omit<MyDoc, 'versions'>, snapshot?: string): void {
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
    },

    removeDoc(id: string): void {
      writeAll(readAll().filter((d) => d.id !== id));
    },

    clearDocs(): void {
      try {
        localStorage.removeItem(storageKey);
      } catch {
        /* ignore */
      }
    },
  };
}
