/**
 * Firebase Authentication wrapper (Google Sign-In) — shared across tools.
 *
 * Provides a clean, lightweight interface over Firebase Auth so tools can:
 *   - await initial auth state resolution (`waitForAuthInit`)
 *   - sign in with Google (`signInWithGoogle`)
 *   - sign out (`signOutUser`)
 *   - subscribe to auth state changes (`onAuthChange`)
 *
 * Gracefully degrades to a no-op (resolving `null`) when Firebase is not
 * configured in the current build environment.
 */
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  type Auth,
  type User,
} from 'firebase/auth';
import { getFirebaseApp } from './app';
import { isFirebaseConfigured } from './config';

export interface AuthUser {
  uid: string;
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
}

let authInstance: Auth | null = null;
let initPromise: Promise<AuthUser | null> | null = null;

function toAuthUser(user: User | null): AuthUser | null {
  if (!user) return null;
  return {
    uid: user.uid,
    displayName: user.displayName,
    email: user.email,
    photoURL: user.photoURL,
  };
}

function getAuthSafe(): Auth | null {
  if (!isFirebaseConfigured) return null;
  if (!authInstance) {
    try {
      authInstance = getAuth(getFirebaseApp());
    } catch (err) {
      console.error('[auth] Failed to initialize Firebase Auth:', err);
      return null;
    }
  }
  return authInstance;
}

/**
 * Wait for Firebase Auth to restore any persisted session from IndexedDB/localStorage.
 * Resolves with the current `AuthUser` or `null` if signed out / unconfigured.
 */
export function waitForAuthInit(): Promise<AuthUser | null> {
  const auth = getAuthSafe();
  if (!auth) return Promise.resolve(null);
  if (!initPromise) {
    initPromise = auth
      .authStateReady()
      .then(() => toAuthUser(auth.currentUser))
      .catch((err) => {
        console.error('[auth] authStateReady failed:', err);
        return null;
      });
  }
  return initPromise;
}

/** Synchronously return the current authenticated user (after init), or `null`. */
export function getCurrentUser(): AuthUser | null {
  const auth = getAuthSafe();
  if (!auth) return null;
  return toAuthUser(auth.currentUser);
}

/** Trigger Google Sign-In popup and return the signed-in user. */
export async function signInWithGoogle(): Promise<AuthUser | null> {
  const auth = getAuthSafe();
  if (!auth) {
    throw new Error('Firebase is not configured.');
  }
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  const cred = await signInWithPopup(auth, provider);
  return toAuthUser(cred.user);
}

/** Sign out the current user. */
export async function signOutUser(): Promise<void> {
  const auth = getAuthSafe();
  if (!auth) return;
  await signOut(auth);
}

/**
 * Subscribe to auth state transitions. Returns an unsubscribe function.
 */
export function onAuthChange(cb: (user: AuthUser | null) => void): () => void {
  const auth = getAuthSafe();
  if (!auth) {
    cb(null);
    return () => {};
  }
  return onAuthStateChanged(auth, (user) => {
    cb(toAuthUser(user));
  });
}
