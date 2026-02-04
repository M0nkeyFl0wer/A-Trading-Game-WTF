import { initializeApp, cert, getApps, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

let firebaseApp: App | null = null;
let cachedAuth: Auth | null = null;
let cachedFirestore: Firestore | null = null;
let initializationAttempted = false;

const hasRequiredEnv = (): boolean =>
  Boolean(
    process.env.FIREBASE_PROJECT_ID &&
    process.env.FIREBASE_CLIENT_EMAIL &&
    process.env.FIREBASE_PRIVATE_KEY
  );

const getCredentials = () => {
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!privateKey) {
    return null;
  }
  return {
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey,
  };
};

const initFirebaseApp = (): App | null => {
  if (firebaseApp) {
    return firebaseApp;
  }
  if (initializationAttempted) {
    return null;
  }
  initializationAttempted = true;

  if (!hasRequiredEnv()) {
    return null;
  }

  try {
    const credentials = getCredentials();
    if (!credentials) {
      return null;
    }

    firebaseApp = initializeApp({
      credential: cert(credentials),
    });
  } catch (error) {
    console.error('Failed to initialize Firebase Admin SDK:', error);
    firebaseApp = null;
  }

  return firebaseApp;
};

export const getFirebaseApp = (): App | null => {
  if (firebaseApp) {
    return firebaseApp;
  }
  if (getApps().length > 0) {
    firebaseApp = getApps()[0] ?? null;
    return firebaseApp;
  }
  return initFirebaseApp();
};

export const getAuthInstance = (): Auth | null => {
  if (cachedAuth) {
    return cachedAuth;
  }
  const app = getFirebaseApp();
  if (!app) {
    return null;
  }
  cachedAuth = getAuth(app);
  return cachedAuth;
};

export const getFirestoreInstance = (): Firestore | null => {
  if (cachedFirestore) {
    return cachedFirestore;
  }
  const app = getFirebaseApp();
  if (!app) {
    return null;
  }
  cachedFirestore = getFirestore(app);
  return cachedFirestore;
};

export const isFirebaseConfigured = (): boolean => {
  if (firebaseApp) {
    return true;
  }
  return hasRequiredEnv();
};
