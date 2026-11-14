// oxlint-disable react/only-export-components -- provider and hooks intentionally share the auth contract.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  createUserWithEmailAndPassword,
  onIdTokenChanged,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  type User,
  type UserCredential,
} from "firebase/auth";
import { firebaseAuth } from "./firebase";
import {
  SESSION_LOGIN_AT_KEY,
  SESSION_MAX_AGE_MS,
  clearStoredSessionLoginAtMs,
  extractFirebaseAuthTimeSeconds,
  isFirebaseSessionExpired,
  readStoredSessionLoginAtMs,
  resolveSessionLoginAtMs,
  writeStoredSessionLoginAtMs,
} from "./sessionExpiry";

export {
  SESSION_LOGIN_AT_KEY,
  SESSION_MAX_AGE_MS,
  isFirebaseSessionExpired,
  resolveSessionLoginAtMs,
};

type FirebaseAuthValue = {
  user: User | null;
  isLoading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<UserCredential>;
  signOut: () => Promise<void>;
};

const FirebaseAuthContext = createContext<FirebaseAuthValue | null>(null);

export function FirebaseAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let expiryTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const clearTimer = () => {
      if (expiryTimer !== null) {
        clearTimeout(expiryTimer);
        expiryTimer = null;
      }
    };

    const enforceSessionExpiry = async (activeUser: User | null) => {
      clearTimer();
      if (!activeUser) {
        clearStoredSessionLoginAtMs();
        if (!cancelled) {
          setUser(null);
          setIsLoading(false);
        }
        return;
      }

      try {
        const tokenResult = await activeUser.getIdTokenResult(false);
        const authTimeSec = extractFirebaseAuthTimeSeconds(
          tokenResult,
          activeUser,
        );
        const storedMs = readStoredSessionLoginAtMs();

        if (isFirebaseSessionExpired(authTimeSec, storedMs)) {
          clearStoredSessionLoginAtMs();
          await firebaseSignOut(firebaseAuth);
          if (!cancelled) {
            setUser(null);
            setIsLoading(false);
          }
          return;
        }

        const loginAtMs = resolveSessionLoginAtMs(authTimeSec, storedMs);
        if (loginAtMs !== null) {
          writeStoredSessionLoginAtMs(loginAtMs);
          const remainingMs = Math.max(
            1000,
            SESSION_MAX_AGE_MS - (Date.now() - loginAtMs),
          );
          expiryTimer = setTimeout(() => {
            clearStoredSessionLoginAtMs();
            void firebaseSignOut(firebaseAuth);
          }, remainingMs);
        }

        if (!cancelled) {
          setUser(activeUser);
          setIsLoading(false);
        }
      } catch {
        if (!cancelled) {
          setUser(activeUser);
          setIsLoading(false);
        }
      }
    };

    const unsubscribe = onIdTokenChanged(firebaseAuth, (nextUser) => {
      void enforceSessionExpiry(nextUser);
    });

    const handleVisibilityOrFocus = () => {
      if (document.visibilityState === "visible" && firebaseAuth.currentUser) {
        void enforceSessionExpiry(firebaseAuth.currentUser);
      }
    };

    window.addEventListener("focus", handleVisibilityOrFocus);
    document.addEventListener("visibilitychange", handleVisibilityOrFocus);

    return () => {
      cancelled = true;
      clearTimer();
      unsubscribe();
      window.removeEventListener("focus", handleVisibilityOrFocus);
      document.removeEventListener("visibilitychange", handleVisibilityOrFocus);
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    try {
      await signInWithEmailAndPassword(
        firebaseAuth,
        email.trim().toLowerCase(),
        password,
      );
      writeStoredSessionLoginAtMs(Date.now());
    } catch (err) {
      if (!firebaseAuth.currentUser) {
        clearStoredSessionLoginAtMs();
      }
      throw err;
    }
  }, []);

  const signUp = useCallback(async (email: string, password: string) => {
    try {
      const cred = await createUserWithEmailAndPassword(
        firebaseAuth,
        email.trim().toLowerCase(),
        password,
      );
      writeStoredSessionLoginAtMs(Date.now());
      return cred;
    } catch (err) {
      if (!firebaseAuth.currentUser) {
        clearStoredSessionLoginAtMs();
      }
      throw err;
    }
  }, []);

  const signOut = useCallback(async () => {
    clearStoredSessionLoginAtMs();
    await firebaseSignOut(firebaseAuth);
  }, []);

  const value = useMemo(
    () => ({ user, isLoading, signIn, signUp, signOut }),
    [isLoading, signIn, signUp, signOut, user],
  );

  return (
    <FirebaseAuthContext.Provider value={value}>
      {children}
    </FirebaseAuthContext.Provider>
  );
}

export function useFirebaseAuth() {
  const value = useContext(FirebaseAuthContext);
  if (!value)
    throw new Error(
      "useFirebaseAuth must be used inside FirebaseAuthProvider.",
    );
  return value;
}
