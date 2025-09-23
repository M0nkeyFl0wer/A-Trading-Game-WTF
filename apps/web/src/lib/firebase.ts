import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import { getDatabase, connectDatabaseEmulator } from 'firebase/database';
import { getStorage, connectStorageEmulator } from 'firebase/storage';
import { getAnalytics } from 'firebase/analytics';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

// Initialize Firebase
export const app = initializeApp(firebaseConfig);

// Initialize services
export const auth = getAuth(app);
export const firestore = getFirestore(app);
export const database = getDatabase(app);
export const storage = getStorage(app);

// Initialize Analytics (only in production)
export const analytics = typeof window !== 'undefined' && import.meta.env.PROD
  ? getAnalytics(app)
  : null;

// Connect to emulators in development
if (import.meta.env.DEV) {
  const isEmulatorConnected = sessionStorage.getItem('firebase-emulator-connected');

  if (!isEmulatorConnected) {
    try {
      connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true });
      connectFirestoreEmulator(firestore, 'localhost', 8080);
      connectDatabaseEmulator(database, 'localhost', 9000);
      connectStorageEmulator(storage, 'localhost', 9199);
      sessionStorage.setItem('firebase-emulator-connected', 'true');
      console.log('Firebase emulators connected');
    } catch (error) {
      console.warn('Failed to connect to Firebase emulators:', error);
    }
  }
}