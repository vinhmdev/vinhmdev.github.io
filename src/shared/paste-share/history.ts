/**
 * Document history for the encrypted-share feature (shared by the
 * Markdown and Encrypted-Paste tools).
 *
 * Implements a Dual Independent Storage architecture:
 *   1. Anonymous / Logged-Out Workspace (`createDocStore`):
 *      Stores shared doc metadata + version snapshots in `localStorage`
 *      (`md:docs` or `paste:docs`).
 *   2. Authenticated / Logged-In Workspace (`createCloudDocStore`):
 *      Stores shared doc metadata + bounded version snapshots in Firestore
 *      under `/users/{uid}/{md_docs|paste_docs}/{docId}`.
 *
 * The two workspaces are completely independent — logging in or out switches
 * the active store via `createDualDocStore` without merging or overwriting
 * data between local and cloud workspaces.
 */
import {
  getFirestore,
  collection,
  doc,
  getDocs as firestoreGetDocs,
  setDoc,
  deleteDoc,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';
import { getFirebaseApp } from '@shared/firebase/app';
import { isFirebaseConfigured } from '@shared/firebase/config';
import type { PasteMode } from '@shared/paste/store';

const MAX_DOCS = 40;
const MAX_VERSIONS = 12;
const MAX_CONTENT = 200_000; // don't snapshot enormous docs into localStorage

const MAX_CLOUD_VERSIONS = 3;
const MAX_CLOUD_CONTENT = 150_000; // stay well below Firestore 1 MiB document limit

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

export type CloudDocCollection = 'md_docs' | 'paste_docs';

export interface DualDocStore extends DocStore {
  switchUser(uid: string | null): Promise<void>;
  isCloud(): boolean;
}

let dbInstance: Firestore | null = null;
function getDb(): Firestore | null {
  if (!isFirebaseConfigured) return null;
  if (!dbInstance) {
    dbInstance = getFirestore(getFirebaseApp());
  }
  return dbInstance;
}

function isValidDoc(d: unknown, now: number): d is MyDoc {
  if (!d || typeof d !== 'object') return false;
  const candidate = d as Partial<MyDoc>;
  if (typeof candidate.id !== 'string' || typeof candidate.url !== 'string') return false;
  const hasSnapshot = Array.isArray(candidate.versions) && candidate.versions.length > 0;
  // Keep expired docs if they still carry a local/cloud version snapshot so the
  // user can recover their text even after the public /pastes/{id} TTL expires.
  return !candidate.expireAt || candidate.expireAt > now || hasSnapshot;
}

/**
 * Local Workspace store (`localStorage`).
 */
export function createDocStore(storageKey: string): DocStore {
  function readAll(): MyDoc[] {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return [];
      const now = Date.now();
      return arr.filter((d): d is MyDoc => isValidDoc(d, now));
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
      const versions = existing?.versions ? [...existing.versions] : [];

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

/**
 * Cloud Workspace store (Firestore `/users/{uid}/{collectionName}/{docId}`).
 * Keeps an in-memory Map for synchronous reads and persists mutations to Firestore.
 */
export function createCloudDocStore(
  uid: string,
  collectionName: CloudDocCollection,
  onChange?: () => void
): DocStore & { hydrate(): Promise<void> } {
  const memory = new Map<string, MyDoc>();

  return {
    async hydrate(): Promise<void> {
      const db = getDb();
      if (!db) return;
      try {
        const colRef = collection(db, 'users', uid, collectionName);
        const snap = await firestoreGetDocs(colRef);
        memory.clear();
        const now = Date.now();
        snap.forEach((docSnap) => {
          const data = docSnap.data();
          const candidate: MyDoc = {
            id: typeof data.id === 'string' ? data.id : docSnap.id,
            key: typeof data.key === 'string' ? data.key : '',
            title: typeof data.title === 'string' ? data.title : '',
            url: typeof data.url === 'string' ? data.url : '',
            mode: data.mode === 'readonly' ? 'readonly' : 'editable',
            createdAt: typeof data.createdAt === 'number' ? data.createdAt : now,
            updatedAt: typeof data.updatedAt === 'number' ? data.updatedAt : now,
            expireAt: typeof data.expireAt === 'number' ? data.expireAt : null,
            versions: Array.isArray(data.versions)
              ? data.versions.filter(
                  (v: unknown): v is DocVersion =>
                    Boolean(v) &&
                    typeof (v as DocVersion).ts === 'number' &&
                    typeof (v as DocVersion).content === 'string'
                )
              : [],
          };
          if (isValidDoc(candidate, now)) {
            memory.set(candidate.id, candidate);
          }
        });
        onChange?.();
      } catch (err) {
        console.error(`[history] Failed to hydrate cloud docs (${collectionName}):`, err);
      }
    },

    getDocs(): MyDoc[] {
      const now = Date.now();
      return Array.from(memory.values())
        .filter((d) => isValidDoc(d, now))
        .sort((a, b) => b.updatedAt - a.updatedAt);
    },

    getDoc(id: string): MyDoc | undefined {
      const docItem = memory.get(id);
      if (!docItem) return undefined;
      return isValidDoc(docItem, Date.now()) ? docItem : undefined;
    },

    saveDoc(meta: Omit<MyDoc, 'versions'>, snapshot?: string): void {
      const existing = memory.get(meta.id);
      const versions = existing?.versions ? [...existing.versions] : [];

      if (typeof snapshot === 'string' && snapshot.length <= MAX_CLOUD_CONTENT) {
        if (versions[0]?.content !== snapshot) {
          versions.unshift({ ts: Date.now(), content: snapshot });
          versions.splice(MAX_CLOUD_VERSIONS);
        }
      }

      const next: MyDoc = { ...meta, versions };
      memory.set(meta.id, next);
      onChange?.();

      const db = getDb();
      if (!db) return;
      const docRef = doc(db, 'users', uid, collectionName, meta.id);
      setDoc(docRef, next).catch((err) => {
        console.error(`[history] Failed to save cloud doc ${meta.id}:`, err);
      });
    },

    removeDoc(id: string): void {
      memory.delete(id);
      onChange?.();

      const db = getDb();
      if (!db) return;
      const docRef = doc(db, 'users', uid, collectionName, id);
      deleteDoc(docRef).catch((err) => {
        console.error(`[history] Failed to delete cloud doc ${id}:`, err);
      });
    },

    clearDocs(): void {
      const ids = Array.from(memory.keys());
      memory.clear();
      onChange?.();

      const db = getDb();
      if (!db || ids.length === 0) return;
      const batch = writeBatch(db);
      for (const id of ids) {
        batch.delete(doc(db, 'users', uid, collectionName, id));
      }
      batch.commit().catch((err) => {
        console.error(`[history] Failed to clear cloud docs (${collectionName}):`, err);
      });
    },
  };
}

/**
 * Dual Independent DocStore router.
 * Delegates strictly to `LocalDocStore` when logged out (`uid === null`)
 * and to `CloudDocStore` when logged in (`uid !== null`).
 */
export function createDualDocStore(opts: {
  localKey: string;
  cloudCollection: CloudDocCollection;
  onUpdate?: () => void;
}): DualDocStore {
  const localStore = createDocStore(opts.localKey);
  let cloudStore: (DocStore & { hydrate(): Promise<void> }) | null = null;
  let activeUid: string | null = null;

  function active(): DocStore {
    return activeUid && cloudStore ? cloudStore : localStore;
  }

  return {
    getDocs(): MyDoc[] {
      return active().getDocs();
    },

    getDoc(id: string): MyDoc | undefined {
      return active().getDoc(id);
    },

    saveDoc(meta: Omit<MyDoc, 'versions'>, snapshot?: string): void {
      active().saveDoc(meta, snapshot);
    },

    removeDoc(id: string): void {
      active().removeDoc(id);
    },

    clearDocs(): void {
      active().clearDocs();
    },

    isCloud(): boolean {
      return activeUid !== null && cloudStore !== null;
    },

    async switchUser(uid: string | null): Promise<void> {
      if (uid === activeUid) return;
      activeUid = uid;
      if (uid) {
        cloudStore = createCloudDocStore(uid, opts.cloudCollection, opts.onUpdate);
        await cloudStore.hydrate();
      } else {
        cloudStore = null;
        opts.onUpdate?.();
      }
    },
  };
}
