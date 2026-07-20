/**
 * Firestore storage for encrypted pastes.
 *
 * Only ciphertext + nonce are ever written here — content is encrypted in
 * the browser first (see crypto.ts). Firebase never sees plaintext. Access
 * is create-and-read-by-id only, enforced by firestore.rules at the repo
 * root; there is no listing, update, or delete.
 */
import {
  getFirestore,
  doc,
  getDoc,
  addDoc,
  collection,
  serverTimestamp,
  Timestamp,
  type Firestore,
} from 'firebase/firestore';
import { getFirebaseApp } from '@shared/firebase/app';
import type { Encrypted } from './crypto';

const COLLECTION = 'pastes';
const SCHEMA_VERSION = 1;
const DAY_MS = 24 * 60 * 60 * 1000;

let db: Firestore | null = null;
function getDb(): Firestore {
  if (!db) db = getFirestore(getFirebaseApp());
  return db;
}

/** A paste as it comes back from storage. */
export interface StoredPaste {
  enc: Encrypted;
  expireAt: Date | null;
}

/**
 * Store an encrypted paste and return its generated id.
 * `ttlDays` bounds how long the document lives (a Firestore TTL policy on
 * `expireAt` reclaims it automatically — see docs/Encrypted Paste.md).
 */
export async function createPaste(enc: Encrypted, ttlDays: number): Promise<string> {
  const ref = await addDoc(collection(getDb(), COLLECTION), {
    ct: enc.ct,
    iv: enc.iv,
    v: SCHEMA_VERSION,
    createdAt: serverTimestamp(),
    expireAt: Timestamp.fromMillis(Date.now() + ttlDays * DAY_MS),
  });
  return ref.id;
}

/** Fetch a paste by id. Returns null if it does not exist (or already expired). */
export async function fetchPaste(id: string): Promise<StoredPaste | null> {
  const snapshot = await getDoc(doc(getDb(), COLLECTION, id));
  if (!snapshot.exists()) return null;

  const data = snapshot.data();
  if (typeof data.ct !== 'string' || typeof data.iv !== 'string') return null;

  const expireAt = data.expireAt instanceof Timestamp ? data.expireAt.toDate() : null;
  // TTL deletion can lag hours behind expiry, so honor it client-side too.
  if (expireAt && expireAt.getTime() <= Date.now()) return null;

  return { enc: { ct: data.ct, iv: data.iv }, expireAt };
}
