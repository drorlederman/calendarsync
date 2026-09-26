"use client";

import { createContext, useContext, useEffect, useState, ReactNode } from "react";

type AppUser = {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
};

type AuthContextType = {
  user: AppUser | null;
  loading: boolean;
  error: string | null;
  loginWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    let unsubscribe: (() => void) | undefined;

    const init = async () => {
      try {
        const [{ auth, db }, { onAuthStateChanged }] = await Promise.all([
          import("./client"),
          import("firebase/auth"),
        ]);

        if (!mounted) return;

        unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
          if (!mounted) return;
          try {
            if (firebaseUser) {
              const { doc, getDoc, setDoc, serverTimestamp } = await import("firebase/firestore");
              const userRef = doc(db, "users", firebaseUser.uid);
              const snap = await getDoc(userRef);
              if (!snap.exists()) {
                await setDoc(userRef, {
                  email: firebaseUser.email,
                  displayName: firebaseUser.displayName,
                  photoURL: firebaseUser.photoURL,
                  createdAt: serverTimestamp(),
                });
              }
              if (mounted) {
                setUser({
                  uid: firebaseUser.uid,
                  email: firebaseUser.email,
                  displayName: firebaseUser.displayName,
                  photoURL: firebaseUser.photoURL,
                });
              }
            } else if (mounted) {
              setUser(null);
            }
          } catch (err) {
            console.error("Error loading user:", err);
          } finally {
            if (mounted) setLoading(false);
          }
        });
      } catch (err) {
        console.error("Firebase init error:", err);
        if (mounted) {
          setError("שגיאה בטעינת Firebase");
          setLoading(false);
        }
      }
    };

    init();

    return () => {
      mounted = false;
      unsubscribe?.();
    };
  }, []);

  const loginWithGoogle = async () => {
    setError(null);
    const { auth } = await import("./client");
    const { signInWithPopup, GoogleAuthProvider } = await import("firebase/auth");
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    await signInWithPopup(auth, provider);
  };

  const logout = async () => {
    setError(null);
    const { auth } = await import("./client");
    const { signOut } = await import("firebase/auth");
    await signOut(auth);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, error, loginWithGoogle, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
}
