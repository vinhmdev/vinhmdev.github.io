/**
 * Firestore storage for encrypted pastes — shared by the paste tools.
 *
 * Only ciphertext + nonce are ever written here — content is encrypted in
 * the browser first (crypto.ts). Firebase never sees plaintext.
 *
 * A paste carries a `mode`:
 *   - 'readonly'  : immutable once created (paste.sh-style share).
 *   - 'owner'     : only the signed-in creator (`ownerUid`) can update in place.
 *   - 'editable'  : anyone with the link can update the content in place.
 * The mode is a plaintext field so firestore.rules can enforce it: readonly
 * pastes reject updates at the database, owner pastes require matching auth,
 * and editable ones allow content-only updates.
 */
import {
  getFirestore,
  doc,
  getDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  collection,
  serverTimestamp,
  Timestamp,
  type Firestore,
} from 'firebase/firestore';
import { getFirebaseApp } from '@shared/firebase/app';
import { getCurrentUser } from '@shared/firebase/auth';
import { isFirebaseConfigured } from '@shared/firebase/config';
import type { Encrypted } from './crypto';

export type PasteMode = 'editable' | 'owner' | 'readonly';

const COLLECTION = 'pastes';
const SCHEMA_VERSION = 2;
const DAY_MS = 24 * 60 * 60 * 1000;

let db: Firestore | null = null;
function getDb(): Firestore {
  // Fail fast on a missing projectId — otherwise the SDK retries against
  // `projects//databases/(default)` forever and the caller hangs.
  if (!isFirebaseConfigured) {
    throw new Error(
      'Firebase is not configured (missing projectId/apiKey). Set the ' +
        'PUBLIC_FIREBASE_* variables in the deploy workflow, then redeploy.'
    );
  }
  if (!db) db = getFirestore(getFirebaseApp());
  return db;
}

export interface StoredPaste {
  enc: Encrypted;
  mode: PasteMode;
  expireAt: Date | null;
  updatedAt: Date | null;
  ownerUid: string | null;
}

/** Store a new encrypted paste and return its generated id. */
export async function createPaste(
  enc: Encrypted,
  opts: { ttlDays: number | null; mode: PasteMode }
): Promise<string> {
  const ownerUid = getCurrentUser()?.uid ?? null;
  const ref = await addDoc(collection(getDb(), COLLECTION), {
    ct: enc.ct,
    iv: enc.iv,
    v: SCHEMA_VERSION,
    mode: opts.mode,
    ownerUid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    expireAt:
      opts.ttlDays !== null && opts.ttlDays > 0
        ? Timestamp.fromMillis(Date.now() + opts.ttlDays * DAY_MS)
        : null,
  });
  return ref.id;
}

/**
 * Overwrite an editable paste's content in place (same id → same link).
 * Rejected by firestore.rules if the paste is readonly.
 */
export async function updatePaste(id: string, enc: Encrypted): Promise<void> {
  await updateDoc(doc(getDb(), COLLECTION, id), {
    ct: enc.ct,
    iv: enc.iv,
    updatedAt: serverTimestamp(),
  });
}

/**
 * Extend or update the expiration of a shared paste (signed-in owner only).
 * Returns the new expiration `Date` or `null` if set to never expire.
 */
export async function extendPasteExpiry(id: string, ttlDays: number | null): Promise<Date | null> {
  const nextExpire =
    ttlDays !== null && ttlDays > 0 ? new Date(Date.now() + ttlDays * DAY_MS) : null;
  await updateDoc(doc(getDb(), COLLECTION, id), {
    expireAt: nextExpire ? Timestamp.fromDate(nextExpire) : null,
    updatedAt: serverTimestamp(),
  });
  return nextExpire;
}

/**
 * Permanently delete / revoke a shared paste on Firestore (signed-in owner only).
 */
export async function deletePaste(id: string): Promise<void> {
  await deleteDoc(doc(getDb(), COLLECTION, id));
}

/** Fetch a paste by id. Returns null if missing or already expired. */
export async function fetchPaste(id: string): Promise<StoredPaste | null> {
  const snapshot = await getDoc(doc(getDb(), COLLECTION, id));
  if (!snapshot.exists()) return null;

  const data = snapshot.data();
  if (typeof data.ct !== 'string' || typeof data.iv !== 'string') return null;

  const expireAt = data.expireAt instanceof Timestamp ? data.expireAt.toDate() : null;
  // TTL deletion can lag hours behind expiry, so honor it client-side too.
  if (expireAt && expireAt.getTime() <= Date.now()) return null;

  const mode: PasteMode =
    data.mode === 'editable' ? 'editable' : data.mode === 'owner' ? 'owner' : 'readonly';

  return {
    enc: { ct: data.ct, iv: data.iv },
    mode,
    expireAt,
    updatedAt: data.updatedAt instanceof Timestamp ? data.updatedAt.toDate() : null,
    ownerUid: typeof data.ownerUid === 'string' ? data.ownerUid : null,
  };
}
