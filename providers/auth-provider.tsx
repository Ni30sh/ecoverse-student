import { Session, User } from "@supabase/supabase-js";
import {
  createContext,
  PropsWithChildren,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { supabase } from "@/lib/supabase/client";
import { logTelemetry } from "@/lib/utils/telemetry";

type StudentProfile = Record<string, unknown>;

type AuthContextValue = {
  session: Session | null;
  user: User | null;
  profile: StudentProfile | null;
  loading: boolean;
  signingIn: boolean;
  signingUp: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUp: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

/**
 * Fetch student profile from the students table.
 * The trigger ensures this row exists after signup.
 */
async function fetchStudentProfile(userId: string): Promise<{
  profile: StudentProfile | null;
  error: Error | null;
}> {
  try {
    const studentsResponse = await supabase
      .from("students")
      .select("*")
      .eq("id", userId)
      .maybeSingle();

    let data = studentsResponse.data;
    let error = studentsResponse.error;

    // Backward-compatible fallback for older schemas still using profiles.
    if (error || !data) {
      const profileResponse = await supabase
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .maybeSingle();

      if (!profileResponse.error && profileResponse.data) {
        data = profileResponse.data;
        error = null;
      }
    }

    if (error) {
      logTelemetry("error", "auth_fetch_profile_error", error.message, {
        userId,
        code: error.code,
      });
      return {
        profile: null,
        error: new Error(`Failed to load student profile: ${error.message}`),
      };
    }

    if (!data) {
      logTelemetry(
        "warn",
        "auth_fetch_profile_missing",
        "Student profile not found after login",
        {
          userId,
        },
      );
      return {
        profile: null,
        error: new Error(
          "Your student profile was not created automatically. Please contact your teacher or admin.",
        ),
      };
    }

    // Verify role is student
    const role = String(data.role ?? "").toLowerCase();
    if (role !== "student") {
      logTelemetry("warn", "auth_role_not_student", `User has role: ${role}`, {
        userId,
      });
      return {
        profile: null,
        error: new Error("Only student accounts can access this app."),
      };
    }

    return { profile: data, error: null };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    logTelemetry("error", "auth_fetch_profile_exception", errorMessage, {
      userId,
    });
    return {
      profile: null,
      error:
        error instanceof Error ? error : new Error("Failed to load profile"),
    };
  }
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<StudentProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [signingIn, setSigningIn] = useState(false);
  const [signingUp, setSigningUp] = useState(false);

  /**
   * Initialize auth state on app launch.
   * Check for existing session and fetch profile if authenticated.
   */
  useEffect(() => {
    let isMounted = true;

    const initializeAuth = async () => {
      try {
        // Get existing session with timeout
        const sessionPromise = supabase.auth.getSession();
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Session check timeout")), 8000),
        );

        const { data, error } = (await Promise.race([
          sessionPromise,
          timeoutPromise,
        ])) as {
          data: { session: Session | null };
          error: Error | null;
        };

        if (!isMounted) return;

        if (error) {
          logTelemetry("warn", "auth_session_check_failed", error.message);
          setSession(null);
          setProfile(null);
          setLoading(false);
          return;
        }

        if (!data?.session) {
          setSession(null);
          setProfile(null);
          setLoading(false);
          return;
        }

        // Session exists, fetch profile
        setSession(data.session);
        const profileResult = await fetchStudentProfile(data.session.user.id);
        if (profileResult.error) {
          logTelemetry(
            "warn",
            "auth_profile_load_failed",
            profileResult.error.message,
          );
          // Sign out if profile can't be loaded (security issue)
          await supabase.auth.signOut();
          setSession(null);
          setProfile(null);
        } else {
          setProfile(profileResult.profile);
        }
        setLoading(false);
      } catch (error) {
        if (isMounted) {
          logTelemetry(
            "error",
            "auth_init_exception",
            error instanceof Error ? error.message : "Unknown",
          );
          setLoading(false);
        }
      }
    };

    void initializeAuth();

    // Listen for auth changes
    const { data: authListener } = supabase.auth.onAuthStateChange(
      (event, nextSession) => {
        if (!isMounted) return;

        setSession(nextSession);

        if (!nextSession) {
          setProfile(null);
          setLoading(false);
          return;
        }

        // Fetch profile when auth state changes
        setLoading(true);

        void (async () => {
          const profileResult = await fetchStudentProfile(nextSession.user.id);
          if (profileResult.error) {
            await supabase.auth.signOut();
            setSession(null);
            setProfile(null);
          } else {
            setProfile(profileResult.profile);
          }
          setLoading(false);
        })();
      },
    );

    return () => {
      isMounted = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  /**
   * Sign in with email and password.
   * Profile is fetched automatically by onAuthStateChange listener.
   */
  const signIn = async (email: string, password: string) => {
    setSigningIn(true);

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });

      if (error) {
        logTelemetry("warn", "auth_signin_failed", error.message, { email });
        return { error };
      }

      if (!data.user || !data.session) {
        const err = new Error("No user or session returned from login");
        logTelemetry("error", "auth_signin_invalid_response", err.message);
        return { error: err };
      }

      logTelemetry(
        "info",
        "auth_signin_success",
        `Signed in as ${data.user.email}`,
      );
      return { error: null };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown login error";
      logTelemetry("error", "auth_signin_exception", errorMessage);
      return {
        error: error instanceof Error ? error : new Error("Failed to sign in"),
      };
    } finally {
      setSigningIn(false);
    }
  };

  /**
   * Sign up with email and password.
   * Do NOT manually create profile — the PostgreSQL trigger handles it.
   * After signup, user is redirected to login (they need to verify if required).
   */
  const signUp = async (email: string, password: string) => {
    setSigningUp(true);

    try {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim().toLowerCase(),
        password,
      });

      if (error) {
        logTelemetry("warn", "auth_signup_failed", error.message, { email });

        // Check if user already exists (common race condition)
        if (
          error.message.includes("already registered") ||
          error.status === 400
        ) {
          return {
            error: new Error(
              "This email is already registered. Please log in instead.",
            ),
          };
        }

        return { error };
      }

      if (!data.user) {
        const err = new Error("No user returned from signup");
        logTelemetry("error", "auth_signup_invalid_response", err.message);
        return { error: err };
      }

      // Trigger creates the student profile automatically
      // No need to manually insert
      logTelemetry(
        "info",
        "auth_signup_success",
        `Account created: ${data.user.email}`,
      );

      return { error: null };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown signup error";
      logTelemetry("error", "auth_signup_exception", errorMessage);
      return {
        error: error instanceof Error ? error : new Error("Failed to sign up"),
      };
    } finally {
      setSigningUp(false);
    }
  };

  /**
   * Sign out and clear auth state.
   */
  const signOut = async () => {
    try {
      await supabase.auth.signOut();
      setSession(null);
      setProfile(null);
      logTelemetry("info", "auth_signout_success", "User signed out");
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      logTelemetry("error", "auth_signout_failed", errorMessage);
    }
  };

  const value: AuthContextValue = useMemo(
    () => ({
      session,
      user: session?.user ?? null,
      profile,
      loading,
      signingIn,
      signingUp,
      signIn,
      signUp,
      signOut,
    }),
    [session, profile, loading, signingIn, signingUp],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth() must be used inside AuthProvider");
  }
  return context;
}
