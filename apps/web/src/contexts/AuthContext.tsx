import React, { createContext, useContext, useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup,
  sendPasswordResetEmail,
  updateProfile,
} from 'firebase/auth';
import { auth, isDevAuth } from '../lib/firebase';

interface AuthContextType {
  currentUser: User | null;
  loading: boolean;
  signup: (email: string, password: string, displayName?: string) => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  updateUserProfile: (displayName: string, photoURL?: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

// ---------------------------------------------------------------------------
// Dev-mode mock user
// ---------------------------------------------------------------------------

/**
 * Lightweight stand-in for Firebase User when running without credentials.
 * Only the properties the rest of the app actually touches are populated.
 * Cast to User so TypeScript is satisfied at the seams.
 */
function createDevUser(): User {
  const devUser = {
    uid: 'dev-user',
    email: 'dev@example.com',
    displayName: 'Dev Trader',
    photoURL: null,
    emailVerified: true,
    isAnonymous: false,
    metadata: {},
    providerData: [],
    providerId: 'dev',
    refreshToken: 'dev-refresh-token',
    tenantId: null,
    phoneNumber: null,

    // The one method the app uses to attach auth headers to API calls.
    getIdToken: async () => 'dev-token',

    getIdTokenResult: async () => ({
      token: 'dev-token',
      claims: {},
      authTime: new Date().toISOString(),
      issuedAtTime: new Date().toISOString(),
      expirationTime: new Date(Date.now() + 3600_000).toISOString(),
      signInProvider: 'dev',
      signInSecondFactor: null,
    }),

    reload: async () => {},
    delete: async () => {},
    toJSON: () => ({ uid: 'dev-user', email: 'dev@example.com' }),
  };

  return devUser as unknown as User;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [currentUser, setCurrentUser] = useState<User | null>(
    isDevAuth ? createDevUser() : null,
  );
  const [loading, setLoading] = useState(!isDevAuth);

  // ---- Firebase-backed auth functions (no-ops in dev mode) ----------------

  async function signup(email: string, password: string, displayName?: string) {
    if (isDevAuth || !auth) return;
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    if (displayName) {
      await updateProfile(userCredential.user, { displayName });
    }
  }

  async function login(email: string, password: string) {
    if (isDevAuth || !auth) return;
    await signInWithEmailAndPassword(auth, email, password);
  }

  async function loginWithGoogle() {
    if (isDevAuth || !auth) return;
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
  }

  async function logout() {
    if (isDevAuth || !auth) return;
    await signOut(auth);
  }

  async function resetPassword(email: string) {
    if (isDevAuth || !auth) return;
    await sendPasswordResetEmail(auth, email);
  }

  async function updateUserProfile(displayName: string, photoURL?: string) {
    if (isDevAuth) return;
    if (!currentUser) throw new Error('No user logged in');
    await updateProfile(currentUser, { displayName, photoURL });
  }

  // ---- Subscribe to real Firebase auth when not in dev mode ---------------

  useEffect(() => {
    if (isDevAuth) {
      console.info('[Auth] Dev mode active — signed in as Dev Trader');
      return;
    }

    if (!auth) {
      // Firebase not configured and dev auth not enabled — remain unauthenticated.
      setLoading(false);
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setCurrentUser(user);
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  const value: AuthContextType = {
    currentUser,
    loading,
    signup,
    login,
    loginWithGoogle,
    logout,
    resetPassword,
    updateUserProfile,
  };

  return (
    <AuthContext.Provider value={value}>
      {!loading && children}
    </AuthContext.Provider>
  );
}