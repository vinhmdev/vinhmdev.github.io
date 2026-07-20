/**
 * Firebase project configuration — shared across features.
 *
 * These values are injected at build time from PUBLIC_* env vars (see
 * .env.example). The Firebase Web API key is NOT a secret: it only
 * identifies the project. Access is enforced server-side by Firestore
 * Security Rules, so it is safe to ship these values to the browser.
 */
export const firebaseConfig = {
  apiKey: import.meta.env.PUBLIC_FIREBASE_API_KEY,
  authDomain: import.meta.env.PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.PUBLIC_FIREBASE_APP_ID,
  measurementId: import.meta.env.PUBLIC_FIREBASE_MEASUREMENT_ID,
} as const;
