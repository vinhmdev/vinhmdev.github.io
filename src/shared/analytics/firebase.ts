/**
 * Firebase Analytics — shared module.
 * Initializes Firebase and loads Analytics only after cookie consent.
 *
 * Usage: Call `loadAnalytics()` after the user accepts cookies.
 * The module is tree-shaken — only analytics code is included.
 */
import { getAnalytics, isSupported, type Analytics } from 'firebase/analytics';
import { getFirebaseApp } from '@shared/firebase/app';
import { firebaseConfig } from '@shared/firebase/config';

let analytics: Analytics | null = null;

/**
 * Initialize Firebase Analytics.
 * Safe to call multiple times — only initializes once.
 * Returns null if analytics is not supported (e.g. no measurementId, or blocked).
 */
export async function loadAnalytics(): Promise<Analytics | null> {
  if (analytics) return analytics;

  if (!firebaseConfig.measurementId) {
    console.warn('[Firebase] No measurementId configured — analytics disabled.');
    return null;
  }

  try {
    const supported = await isSupported();
    if (!supported) {
      console.warn('[Firebase] Analytics not supported in this environment.');
      return null;
    }

    analytics = getAnalytics(getFirebaseApp());
    console.log('[Firebase] Analytics initialized.');
    return analytics;
  } catch (error) {
    console.error('[Firebase] Failed to initialize analytics:', error);
    return null;
  }
}
