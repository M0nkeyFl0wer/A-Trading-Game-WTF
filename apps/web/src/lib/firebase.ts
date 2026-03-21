import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import { getDatabase, connectDatabaseEmulator } from 'firebase/database';
import { getStorage, connectStorageEmulator } from 'firebase/storage';
import type { FirebaseApp } from 'firebase/app';
import type { Auth } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';
import type { Database } from 'firebase/database';
import type { FirebaseStorage } from 'firebase/storage';
import type { Analytics } from 'firebase/analytics';

export const isDevAuth = import.meta.env.VITE_DEV_AUTH === 'true';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

const hasFirebaseConfig = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);

function initFirebase(): {
  app: FirebaseApp | null;
  auth: Auth | null;
  firestore: Firestore | null;
  database: Database | null;
  storage: FirebaseStorage | null;
  analytics: Analytics | null;
} {
  const empty = { app: null, auth: null, firestore: null, database: null, storage: null, analytics: null };

  if (!hasFirebaseConfig) {
    if (isDevAuth) {
      console.info('Dev auth mode — Firebase initialization skipped.');
    } else {
      console.warn(
        'Firebase config is missing and VITE_DEV_AUTH is not enabled. ' +
        'Authentication will not work.',
      );
    }
    return empty;
  }

  try {
    const fbApp = initializeApp(firebaseConfig);
    const fbAuth = getAuth(fbApp);
    const fbFirestore = getFirestore(fbApp);
    const fbDatabase = getDatabase(fbApp);
    const fbStorage = getStorage(fbApp);

    let fbAnalytics: Analytics | null = null;
    if (typeof window !== 'undefined' && import.meta.env.PROD) {
      // Dynamic import for analytics since it's optional and production-only.
      // This is fine as a fire-and-forget; analytics isn't used synchronously.
      import('firebase/analytics').then(({ getAnalytics }) => {
        try { fbAnalytics = getAnalytics(fbApp); } catch { /* non-critical */ }
      }).catch(() => { /* analytics unavailable */ });
    }

    // Connect to emulators in development (but not when using dev auth bypass,
    // since there may be no emulators running).
    if (import.meta.env.DEV && !isDevAuth) {
      const isEmulatorConnected = sessionStorage.getItem('firebase-emulator-connected');

      if (!isEmulatorConnected) {
        try {
          connectAuthEmulator(fbAuth, 'http://localhost:9099', { disableWarnings: true });
          connectFirestoreEmulator(fbFirestore, 'localhost', 8080);
          connectDatabaseEmulator(fbDatabase, 'localhost', 9000);
          connectStorageEmulator(fbStorage, 'localhost', 9199);
          sessionStorage.setItem('firebase-emulator-connected', 'true');
          console.log('Firebase emulators connected');
        } catch (error) {
          console.warn('Failed to connect to Firebase emulators:', error);
        }
      }
    }

    return {
      app: fbApp,
      auth: fbAuth,
      firestore: fbFirestore,
      database: fbDatabase,
      storage: fbStorage,
      analytics: fbAnalytics,
    };
  } catch (error) {
    console.warn('Firebase initialization failed:', error);
    return empty;
  }
}

const fb = initFirebase();

export const app = fb.app;
export const auth = fb.auth;
export const firestore = fb.firestore;
export const database = fb.database;
export const storage = fb.storage;
export const analytics = fb.analytics;