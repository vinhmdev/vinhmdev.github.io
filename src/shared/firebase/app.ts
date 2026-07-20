/**
 * Firebase app singleton — shared across features.
 *
 * `initializeApp` throws if called twice for the same (default) app name,
 * so every feature must go through `getFirebaseApp()` instead of calling
 * `initializeApp` directly. This lets Analytics and Firestore coexist on
 * one app instance without duplicate-init errors.
 */
import { getApps, getApp, initializeApp, type FirebaseApp } from 'firebase/app';
import { firebaseConfig } from './config';

/**
 * Return the shared Firebase app, initializing it on first use.
 */
export function getFirebaseApp(): FirebaseApp {
  return getApps().length ? getApp() : initializeApp(firebaseConfig);
}
