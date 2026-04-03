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
  signUp: (
    fullName: string,
    email: string,
    password: string,
    schoolName: string,
  ) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const SUPPORTED_SCHOOLS = new Set(["MPGI", "PSIT", "KIT", "KGI", "AKTU"]);

function isTransientNetworkError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message.toLowerCase()
      : String(error).toLowerCase();

  return (
    message.includes("failed to fetch") ||
    message.includes("network request failed") ||
    message.includes("load failed") ||
    message.includes("networkerror")
  );
}

function mapAuthError(error: unknown, fallback: string): Error {
  if (isTransientNetworkError(error)) {
    return new Error(
      "Cannot reach Supabase right now. Check internet, VPN/proxy, and Supabase URL/Anon key, then retry.",
    );
  }

  if (error instanceof Error) {
    return error;
  }

  return new Error(fallback);
}

function isMissingProfileError(error: Error | null): boolean {
  if (!error) {
    return false;
  }

  return error.message
    .toLowerCase()
    .includes("profile was not created automatically");
}

function normalizeSchoolName(value: string) {
  return value.trim().toUpperCase();
}

async function resolveSchoolIdByName(
  schoolName: string,
): Promise<string | null> {
  const normalizedName = normalizeSchoolName(schoolName);
  if (!normalizedName) {
    return null;
  }

  try {
    const existing = await supabase
      .from("schools")
      .select("id,name")
      .ilike("name", normalizedName)
      .maybeSingle();

    if (!existing.error && existing.data?.id) {
      return String(existing.data.id);
    }

    const inserted = await supabase
      .from("schools")
      .insert({ name: normalizedName })
      .select("id")
      .maybeSingle();

    if (!inserted.error && inserted.data?.id) {
      return String(inserted.data.id);
    }

    return null;
  } catch {
    return null;
  }
}

async function syncStudentSchoolMapping(
  userId: string,
  fullName: string,
  schoolName: string,
) {
  const schoolId = await resolveSchoolIdByName(schoolName);
  const now = new Date().toISOString();

  const studentUpdate = await supabase
    .from("students")
    .update({
      full_name: fullName,
      school_id: schoolId,
      updated_at: now,
    })
    .eq("id", userId);

  if (studentUpdate.error) {
    logTelemetry(
      "warn",
      "auth_signup_students_school_update_failed",
      studentUpdate.error.message,
      {
        userId,
        schoolName,
      },
    );
  }

  const profileUpsert = await supabase.from("profiles").upsert(
    {
      id: userId,
      full_name: fullName,
      role: "student",
      school_id: schoolId,
      school_name: schoolName,
      updated_at: now,
    },
    { onConflict: "id" },
  );

  if (profileUpsert.error) {
    // Fallback for older schemas that may not have school_name.
    await supabase.from("profiles").upsert(
      {
        id: userId,
        full_name: fullName,
        role: "student",
        school_id: schoolId,
        updated_at: now,
      },
      { onConflict: "id" },
    );
  }
}

/**
 * Fetch student profile from the students table.
 * The trigger ensures this row exists after signup.
 */
async function fetchStudentProfile(userId: string): Promise<{
  profile: StudentProfile | null;
  error: Error | null;
}> {
  try {
    let studentsResponse = await supabase
      .from("students")
      .select("*")
      .eq("id", userId)
      .maybeSingle();

    if (
      studentsResponse.error &&
      isTransientNetworkError(studentsResponse.error)
    ) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      studentsResponse = await supabase
        .from("students")
        .select("*")
        .eq("id", userId)
        .maybeSingle();
    }

    let data = studentsResponse.data;
    let error = studentsResponse.error;

    // Backward-compatible fallback for older schemas still using profiles.
    if (error || !data) {
      let profileResponse = await supabase
        .from("profiles")
        .select("*")
        .eq("id", userId)
        .maybeSingle();

      if (
        profileResponse.error &&
        isTransientNetworkError(profileResponse.error)
      ) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        profileResponse = await supabase
          .from("profiles")
          .select("*")
          .eq("id", userId)
          .maybeSingle();
      }

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
    const role = String(data.role ?? "")
      .toLowerCase()
      .trim();
    if (role && role !== "student") {
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

async function recoverMissingStudentProfile(user: User): Promise<boolean> {
  try {
    const metadata =
      (user.user_metadata as Record<string, unknown> | null) ?? null;
    const fullName = String(metadata?.full_name ?? "").trim();
    const schoolName = String(metadata?.school_name ?? "").trim();

    const { error } = await supabase.rpc("ensure_student_profile", {
      p_user_id: user.id,
      p_email: user.email ?? "",
      p_full_name: fullName || null,
      p_school_name: schoolName || null,
    });

    if (error) {
      logTelemetry("warn", "auth_profile_recovery_rpc_failed", error.message, {
        userId: user.id,
      });
      return false;
    }

    return true;
  } catch (error) {
    logTelemetry(
      "warn",
      "auth_profile_recovery_exception",
      error instanceof Error ? error.message : "Unknown profile recovery error",
      { userId: user.id },
    );
    return false;
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
        let profileResult = await fetchStudentProfile(data.session.user.id);
        if (isMissingProfileError(profileResult.error)) {
          const recovered = await recoverMissingStudentProfile(
            data.session.user,
          );
          if (recovered) {
            profileResult = await fetchStudentProfile(data.session.user.id);
          }
        }

        if (profileResult.error) {
          logTelemetry(
            "warn",
            "auth_profile_load_failed",
            profileResult.error.message,
          );
          if (isTransientNetworkError(profileResult.error)) {
            // Keep session and use a minimal student profile fallback on transient fetch errors.
            setProfile({ id: data.session.user.id, role: "student" });
          } else {
            // Keep session to avoid login bounce loops; user can retry data load in-app.
            setProfile({ id: data.session.user.id, role: "student" });
          }
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
          let profileResult = await fetchStudentProfile(nextSession.user.id);
          if (isMissingProfileError(profileResult.error)) {
            const recovered = await recoverMissingStudentProfile(
              nextSession.user,
            );
            if (recovered) {
              profileResult = await fetchStudentProfile(nextSession.user.id);
            }
          }

          if (profileResult.error) {
            logTelemetry(
              "warn",
              "auth_profile_load_failed_after_state_change",
              profileResult.error.message,
              { event },
            );
            setProfile({ id: nextSession.user.id, role: "student" });
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
      let response = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });

      // Retry once for transient network fetch issues commonly seen on unstable links.
      if (response.error && isTransientNetworkError(response.error)) {
        await new Promise((resolve) => setTimeout(resolve, 500));
        response = await supabase.auth.signInWithPassword({
          email: email.trim().toLowerCase(),
          password,
        });
      }

      const { data, error } = response;

      if (error) {
        const mappedError = mapAuthError(error, "Failed to sign in");
        logTelemetry("warn", "auth_signin_failed", mappedError.message, {
          email,
        });
        return { error: mappedError };
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
      const mappedError = mapAuthError(error, "Failed to sign in");
      logTelemetry("error", "auth_signin_exception", mappedError.message);
      return {
        error: mappedError,
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
  const signUp = async (
    fullName: string,
    email: string,
    password: string,
    schoolName: string,
  ) => {
    setSigningUp(true);

    try {
      const normalizedFullName = fullName.trim();
      const normalizedEmail = email.trim().toLowerCase();
      const normalizedSchool = normalizeSchoolName(schoolName);

      if (
        !normalizedFullName ||
        !normalizedEmail ||
        !password ||
        !normalizedSchool
      ) {
        return {
          error: new Error(
            "Full name, email, password, and school are required.",
          ),
        };
      }

      if (!SUPPORTED_SCHOOLS.has(normalizedSchool)) {
        return {
          error: new Error(
            "Please select a valid school: MPGI, PSIT, KIT, KGI, AKTU.",
          ),
        };
      }

      const { data, error } = await supabase.auth.signUp({
        email: normalizedEmail,
        password,
        options: {
          data: {
            full_name: normalizedFullName,
            school_name: normalizedSchool,
            role: "student",
          },
        },
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
      await syncStudentSchoolMapping(
        data.user.id,
        normalizedFullName,
        normalizedSchool,
      );

      logTelemetry(
        "info",
        "auth_signup_success",
        `Account created: ${data.user.email}`,
        {
          userId: data.user.id,
          school: normalizedSchool,
        },
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
