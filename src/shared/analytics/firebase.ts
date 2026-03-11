/**
 * Firebase Analytics — shared module.
 * Initializes Firebase and loads Analytics only after cookie consent.
 *
 * Usage: Call `loadAnalytics()` after the user accepts cookies.
 * The module is tree-shaken — only analytics code is included.
 */
import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getAnalytics, isSupported, type Analytics } from 'firebase/analytics';

const firebaseConfig = {
  apiKey: import.meta.env.PUBLIC_FIREBASE_API_KEY,
  authDomain: import.meta.env.PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.PUBLIC_FIREBASE_APP_ID,
  measurementId: import.meta.env.PUBLIC_FIREBASE_MEASUREMENT_ID,
};

let app: FirebaseApp | null = null;
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

    app = initializeApp(firebaseConfig);
    analytics = getAnalytics(app);
    console.log('[Firebase] Analytics initialized.');
    return analytics;
  } catch (error) {
    console.error('[Firebase] Failed to initialize analytics:', error);
    return null;
  }
}
