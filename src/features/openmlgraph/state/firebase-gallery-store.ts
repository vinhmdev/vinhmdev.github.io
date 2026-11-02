/**
 * Tier 3B Firebase Public Community Gallery Store (`public_graphs` collection).
 *
 * Enables users to publish interactive ML graphs to the community gallery
 * (`#g.<graphId>`) and browse the 30 most recent community creations.
 */
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  limit,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  type Firestore,
} from 'firebase/firestore';
import { getFirebaseApp } from '@shared/firebase/app';
import { isFirebaseConfigured } from '@shared/firebase/config';

export type PublicGraphCategory =
  | 'activation'
  | 'loss'
  | 'optimization'
  | 'probability'
  | 'boundary'
  | 'custom';

export interface PublicGraphItem {
  id: string;
  title: string;
  author: string;
  category: PublicGraphCategory;
  description: string;
  primaryLatex: string;
  payload: string;
  createdAt: Date;
  expireAt: Date;
}

const COLLECTION = 'public_graphs';
const DAY_MS = 24 * 60 * 60 * 1000;

let db: Firestore | null = null;
function getDb(): Firestore {
  if (!isFirebaseConfigured) {
    throw new Error('Firebase is not configured.');
  }
  if (!db) db = getFirestore(getFirebaseApp());
  return db;
}

export async function publishToCommunityGallery(input: {
  title: string;
  author: string;
  category: PublicGraphCategory;
  description: string;
  primaryLatex: string;
  payload: string;
  ttlDays?: number;
}): Promise<string> {
  const ttl = Math.min(Math.max(input.ttlDays ?? 365, 1), 365);
  const ref = await addDoc(collection(getDb(), COLLECTION), {
    v: 2,
    title: input.title.trim().slice(0, 120) || 'Untitled ML Graph',
    author: input.author.trim().slice(0, 50) || 'Anonymous',
    category: input.category,
    description: input.description.trim().slice(0, 500),
    primaryLatex: input.primaryLatex.trim().slice(0, 500),
    payload: input.payload,
    createdAt: serverTimestamp(),
    expireAt: Timestamp.fromMillis(Date.now() + ttl * DAY_MS),
  });
  return ref.id;
}

export async function fetchCommunityGraph(graphId: string): Promise<PublicGraphItem | null> {
  const snap = await getDoc(doc(getDb(), COLLECTION, graphId));
  if (!snap.exists()) return null;
  const d = snap.data();
  const expireAt = d.expireAt instanceof Timestamp ? d.expireAt.toDate() : new Date(Date.now() + DAY_MS);
  if (expireAt.getTime() <= Date.now()) return null;
  return {
    id: snap.id,
    title: String(d.title ?? 'Untitled'),
    author: String(d.author ?? 'Anonymous'),
    category: (d.category as PublicGraphCategory) ?? 'custom',
    description: String(d.description ?? ''),
    primaryLatex: String(d.primaryLatex ?? ''),
    payload: String(d.payload ?? ''),
    createdAt: d.createdAt instanceof Timestamp ? d.createdAt.toDate() : new Date(),
    expireAt,
  };
}

export async function listCommunityGraphs(maxItems = 30): Promise<PublicGraphItem[]> {
  const capped = Math.min(Math.max(maxItems, 1), 30);
  const q = query(
    collection(getDb(), COLLECTION),
    orderBy('createdAt', 'desc'),
    limit(capped)
  );
  const snaps = await getDocs(q);
  const now = Date.now();
  const items: PublicGraphItem[] = [];
  snaps.forEach((docSnap) => {
    const d = docSnap.data();
    const expireAt = d.expireAt instanceof Timestamp ? d.expireAt.toDate() : new Date(now + DAY_MS);
    if (expireAt.getTime() > now) {
      items.push({
        id: docSnap.id,
        title: String(d.title ?? 'Untitled'),
        author: String(d.author ?? 'Anonymous'),
        category: (d.category as PublicGraphCategory) ?? 'custom',
        description: String(d.description ?? ''),
        primaryLatex: String(d.primaryLatex ?? ''),
        payload: String(d.payload ?? ''),
        createdAt: d.createdAt instanceof Timestamp ? d.createdAt.toDate() : new Date(),
        expireAt,
      });
    }
  });
  return items;
}
