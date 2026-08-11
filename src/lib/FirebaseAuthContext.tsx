// oxlint-disable react/only-export-components -- provider and hooks intentionally share the auth contract.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  onIdTokenChanged,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  type User,
} from "firebase/auth";
import { firebaseAuth } from "./firebase";

type FirebaseAuthValue = {
  user: User | null;
  isLoading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const FirebaseAuthContext = createContext<FirebaseAuthValue | null>(null);

export function FirebaseAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => onIdTokenChanged(firebaseAuth, (nextUser) => {
    setUser(nextUser);
    setIsLoading(false);
  }), []);

  const signIn = useCallback(async (email: string, password: string) => {
    await signInWithEmailAndPassword(firebaseAuth, email.trim().toLowerCase(), password);
  }, []);
  const signOut = useCallback(() => firebaseSignOut(firebaseAuth), []);
  const value = useMemo(() => ({ user, isLoading, signIn, signOut }), [isLoading, signIn, signOut, user]);

  return <FirebaseAuthContext.Provider value={value}>{children}</FirebaseAuthContext.Provider>;
}

export function useFirebaseAuth() {
  const value = useContext(FirebaseAuthContext);
  if (!value) throw new Error("useFirebaseAuth must be used inside FirebaseAuthProvider.");
  return value;
}
