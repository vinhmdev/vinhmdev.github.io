/**
 * Dual Independent Working Draft Store for `clipboard2markdown` ('c2md')
 * and `encrypted-paste` ('paste').
 *
 * Strictly isolates working drafts between two independent workspaces:
 *   1. Logged-Out Workspace (`uid === null` -> `localStorage`):
 *      - `c2md`  : `localStorage['clipboard2markdown_content']` (raw string for
 *                  100% backward compatibility).
 *      - `paste` : `localStorage['paste:draft']` (JSON `{ title, content, updatedAt }`).
 *   2. Logged-In Workspace (`uid !== null` -> Firestore `/users/{uid}/drafts/{toolId}`):
 *      - Debounces writes by 1500ms while typing and flushes immediately when
 *        the tab becomes hidden or before switching/signing out.
 *      - Never touches `localStorage`.
 */
import { getFirestore, doc, getDoc, setDoc, deleteDoc, type Firestore } from 'firebase/firestore';
import { getFirebaseApp } from '@shared/firebase/app';
import { isFirebaseConfigured } from '@shared/firebase/config';

export type DraftToolId = 'c2md' | 'paste';

export interface DraftData {
  title: string;
  content: string;
  updatedAt: number;
}

export interface DualDraftStore {
  load(): Promise<DraftData>;
  save(data: { title?: string; content: string }): void;
  clear(): Promise<void>;
  flush(): Promise<void>;
  switchUser(uid: string | null): Promise<DraftData>;
  isCloud(): boolean;
}

const CLOUD_DEBOUNCE_MS = 1500;
const MAX_CLOUD_DRAFT_CHARS = 900_000;
const C2MD_LOCAL_KEY = 'clipboard2markdown_content';
const PASTE_LOCAL_KEY = 'paste:draft';

let dbInstance: Firestore | null = null;
function getDb(): Firestore | null {
  if (!isFirebaseConfigured) return null;
  if (!dbInstance) {
    dbInstance = getFirestore(getFirebaseApp());
  }
  return dbInstance;
}

function emptyDraft(): DraftData {
  return { title: '', content: '', updatedAt: 0 };
}

export function createDualDraftStore(toolId: DraftToolId): DualDraftStore {
  let activeUid: string | null = null;
  let debounceTimer: number | null = null;
  let pendingCloudDraft: { uid: string; data: DraftData } | null = null;
  let inFlightWrite: Promise<void> | null = null;

  // ─── Local Storage helpers ──────────────────────────────────────────────────
  function readLocal(): DraftData {
    try {
      if (toolId === 'c2md') {
        const raw = localStorage.getItem(C2MD_LOCAL_KEY) ?? '';
        return { title: '', content: raw, updatedAt: raw ? Date.now() : 0 };
      }
      const raw = localStorage.getItem(PASTE_LOCAL_KEY);
      if (!raw) return emptyDraft();
      const parsed = JSON.parse(raw) as Partial<DraftData>;
      return {
        title: typeof parsed.title === 'string' ? parsed.title : '',
        content: typeof parsed.content === 'string' ? parsed.content : '',
        updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
      };
    } catch {
      return emptyDraft();
    }
  }

  function writeLocal(data: { title?: string; content: string }): void {
    try {
      if (toolId === 'c2md') {
        if (!data.content) {
          localStorage.removeItem(C2MD_LOCAL_KEY);
        } else {
          localStorage.setItem(C2MD_LOCAL_KEY, data.content);
        }
        return;
      }
      const title = data.title ?? '';
      const content = data.content;
      if (!title && !content) {
        localStorage.removeItem(PASTE_LOCAL_KEY);
        return;
      }
      const payload: DraftData = {
        title,
        content,
        updatedAt: Date.now(),
      };
      localStorage.setItem(PASTE_LOCAL_KEY, JSON.stringify(payload));
    } catch {
      /* ignore quota errors */
    }
  }

  function clearLocal(): void {
    try {
      localStorage.removeItem(toolId === 'c2md' ? C2MD_LOCAL_KEY : PASTE_LOCAL_KEY);
    } catch {
      /* ignore */
    }
  }

  // ─── Cloud Firestore helpers ────────────────────────────────────────────────
  async function readCloud(uid: string): Promise<DraftData> {
    const db = getDb();
    if (!db) return emptyDraft();
    try {
      const snap = await getDoc(doc(db, 'users', uid, 'drafts', toolId));
      if (!snap.exists()) return emptyDraft();
      const d = snap.data();
      return {
        title: typeof d.title === 'string' ? d.title : '',
        content: typeof d.content === 'string' ? d.content : '',
        updatedAt: typeof d.updatedAt === 'number' ? d.updatedAt : 0,
      };
    } catch (err) {
      console.error(`[draft-store] Failed to read cloud draft (${toolId}):`, err);
      return emptyDraft();
    }
  }

  async function writeCloudNow(uid: string, data: DraftData): Promise<void> {
    const db = getDb();
    if (!db) return;
    const cappedContent =
      data.content.length > MAX_CLOUD_DRAFT_CHARS
        ? data.content.slice(0, MAX_CLOUD_DRAFT_CHARS)
        : data.content;
    try {
      if (!data.title && !cappedContent) {
        await deleteDoc(doc(db, 'users', uid, 'drafts', toolId));
        return;
      }
      await setDoc(doc(db, 'users', uid, 'drafts', toolId), {
        title: data.title,
        content: cappedContent,
        updatedAt: data.updatedAt,
      });
    } catch (err) {
      console.error(`[draft-store] Failed to save cloud draft (${toolId}):`, err);
    }
  }

  async function flush(): Promise<void> {
    if (debounceTimer !== null) {
      window.clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    while (pendingCloudDraft || inFlightWrite) {
      if (inFlightWrite) {
        await inFlightWrite;
      }
      if (pendingCloudDraft) {
        const { uid, data } = pendingCloudDraft;
        pendingCloudDraft = null;
        const p = writeCloudNow(uid, data).finally(() => {
          if (inFlightWrite === p) {
            inFlightWrite = null;
          }
        });
        inFlightWrite = p;
        await p;
      }
    }
  }

  // Flush pending cloud draft when the page becomes hidden or is unloading.
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        void flush();
      }
    });
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', () => {
      void flush();
    });
  }

  return {
    async load(): Promise<DraftData> {
      if (activeUid) {
        await flush();
        return readCloud(activeUid);
      }
      return readLocal();
    },

    save(data: { title?: string; content: string }): void {
      if (!activeUid) {
        writeLocal(data);
        return;
      }

      const uid = activeUid;
      pendingCloudDraft = {
        uid,
        data: {
          title: data.title ?? '',
          content: data.content,
          updatedAt: Date.now(),
        },
      };

      if (debounceTimer !== null) {
        window.clearTimeout(debounceTimer);
      }
      debounceTimer = window.setTimeout(() => {
        debounceTimer = null;
        void flush();
      }, CLOUD_DEBOUNCE_MS);
    },

    async clear(): Promise<void> {
      if (debounceTimer !== null) {
        window.clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      pendingCloudDraft = null;
      if (inFlightWrite) {
        await inFlightWrite;
      }

      if (!activeUid) {
        clearLocal();
        return;
      }

      const db = getDb();
      if (!db) return;
      try {
        await deleteDoc(doc(db, 'users', activeUid, 'drafts', toolId));
      } catch (err) {
        console.error(`[draft-store] Failed to clear cloud draft (${toolId}):`, err);
      }
    },

    flush,

    isCloud(): boolean {
      return activeUid !== null;
    },

    async switchUser(uid: string | null): Promise<DraftData> {
      await flush();
      activeUid = uid;
      if (uid) {
        return readCloud(uid);
      }
      return readLocal();
    },
  };
}
