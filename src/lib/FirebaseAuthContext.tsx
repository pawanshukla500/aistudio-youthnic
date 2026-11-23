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
  sendEmailVerification,
  sendPasswordResetEmail,
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
  /** False until the owner opens the link Firebase emailed; a seller store's free shoot needs it. */
  emailVerified: boolean;
  sendVerificationEmail: () => Promise<void>;
  /** Re-reads the account and, once verified, takes a new ID token that carries the claim. */
  refreshEmailVerified: () => Promise<boolean>;
  resetPassword: (email: string) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<UserCredential>;
  signOut: () => Promise<void>;
};

const FirebaseAuthContext = createContext<FirebaseAuthValue | null>(null);

export function FirebaseAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [emailVerified, setEmailVerified] = useState(false);

  useEffect(() => {
    let expiryTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    // A refreshed token can carry the claim before the cached account object is reloaded.
    const showUser = (next: User | null, verifiedClaim = false) => {
      setUser(next);
      setEmailVerified(Boolean(next?.emailVerified) || verifiedClaim);
    };

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
          showUser(null);
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
            showUser(null);
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
          showUser(activeUser, tokenResult.claims.email_verified === true);
          setIsLoading(false);
        }
      } catch {
        if (!cancelled) {
          showUser(activeUser);
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
      // The store is created either way; the banner offers a resend if this send fails.
      void sendEmailVerification(cred.user).catch(() => undefined);
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

  const sendVerificationEmail = useCallback(async () => {
    if (firebaseAuth.currentUser) {
      await sendEmailVerification(firebaseAuth.currentUser);
    }
  }, []);

  const refreshEmailVerified = useCallback(async () => {
    const current = firebaseAuth.currentUser;
    if (!current) return false;
    await current.reload();
    // email_verified only reaches the server inside a newly issued ID token.
    if (current.emailVerified) await current.getIdToken(true);
    setEmailVerified(current.emailVerified);
    return current.emailVerified;
  }, []);

  const resetPassword = useCallback(async (email: string) => {
    await sendPasswordResetEmail(firebaseAuth, email.trim().toLowerCase());
  }, []);

  const value = useMemo(
    () => ({
      user,
      isLoading,
      emailVerified,
      signIn,
      signUp,
      signOut,
      sendVerificationEmail,
      refreshEmailVerified,
      resetPassword,
    }),
    [
      emailVerified,
      isLoading,
      refreshEmailVerified,
      resetPassword,
      sendVerificationEmail,
      signIn,
      signUp,
      signOut,
      user,
    ],
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
