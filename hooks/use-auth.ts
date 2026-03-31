import { supabase } from "@/integrations/supabase/client";
import type {
    Session as SupabaseSession,
    User as SupabaseUser,
} from "@supabase/supabase-js";
import React, {
    createContext,
    ReactNode,
    useCallback,
    useContext,
    useEffect,
    useRef,
    useState,
} from "react";

/**
 * Student profile interface
 */
export interface StudentProfile {
  id: string;
  full_name: string;
  avatar_emoji: string;
  eco_points: number;
  streak_days: number;
  last_active_date: string | null;
  interests: string[];
  daily_goal: number;
  school_name: string;
  city: string;
  created_at: string;
}

/**
 * Student user type
 */
export type StudentAuthUser = {
  id: string;
  email: string;
  user_metadata?: {
    full_name?: string;
    school_name?: string;
  };
};

/**
 * Student auth session
 */
export type StudentAuthSession = {
  user: StudentAuthUser;
  token: string;
};

/**
 * Student auth context type
 */
export interface StudentAuthContextType {
  user: StudentAuthUser | null;
  session: StudentAuthSession | null;
  profile: StudentProfile | null;
  loading: boolean;
  error: Error | null;
  signUp: (
    email: string,
    password: string,
    fullName: string,
    schoolName?: string,
  ) => Promise<{ error: Error | null; needsEmailConfirmation: boolean }>;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<{ error: Error | null }>;
  refreshProfile: () => Promise<{ error: Error | null }>;
  updateProfile: (updates: {
    full_name?: string;
    school_name?: string;
    city?: string;
    avatar_emoji?: string;
    interests?: string[];
    daily_goal?: number;
  }) => Promise<{ error: Error | null }>;
  isAuthenticated: boolean;
}

const StudentAuthContext = createContext<StudentAuthContextType | undefined>(
  undefined,
);

/**
 * Convert Supabase user to student auth user
 */
function toStudentAuthUser(user: SupabaseUser): StudentAuthUser {
  return {
    id: user.id,
    email: user.email ?? "",
    user_metadata: {
      full_name:
        typeof user.user_metadata?.full_name === "string"
          ? user.user_metadata.full_name
          : undefined,
      school_name:
        typeof user.user_metadata?.school_name === "string"
          ? user.user_metadata.school_name
          : undefined,
    },
  };
}

/**
 * Convert Supabase session to student auth session
 */
function toStudentAuthSession(session: SupabaseSession): StudentAuthSession {
  return {
    user: toStudentAuthUser(session.user),
    token: session.access_token,
  };
}

/**
 * Convert database row to student profile
 */
function toStudentProfile(row: any): StudentProfile {
  const schoolFromJoin = Array.isArray(row?.schools)
    ? row.schools[0]?.name
    : row?.schools?.name;

  return {
    id: row.id,
    full_name: row.full_name ?? "Student",
    avatar_emoji: row.avatar_emoji ?? "🌱",
    eco_points: Math.max(0, row.eco_points ?? 0),
    streak_days: Math.max(0, row.streak_days ?? 0),
    last_active_date: row.last_active_date ?? null,
    interests: Array.isArray(row.interests) ? row.interests : [],
    daily_goal: Math.max(1, row.daily_goal ?? 2),
    school_name: row.school_name ?? schoolFromJoin ?? "",
    city: row.city ?? "",
    created_at: row.created_at ?? new Date().toISOString(),
  };
}

/**
 * Build fallback profile for newly created student
 */
function buildFallbackStudentProfile(user: StudentAuthUser): StudentProfile {
  const emailPrefix = user.email?.split("@")[0] || "Student";
  const fullName = user.user_metadata?.full_name?.trim() || emailPrefix;

  return {
    id: user.id,
    full_name: fullName,
    avatar_emoji: "🌱",
    eco_points: 0,
    streak_days: 0,
    last_active_date: null,
    interests: [],
    daily_goal: 2,
    school_name: user.user_metadata?.school_name?.trim() || "",
    city: "",
    created_at: new Date().toISOString(),
  };
}

/**
 * Resolve or create school by name
 */
async function resolveSchoolIdByName(
  schoolName?: string,
): Promise<string | null> {
  const normalized = (schoolName || "").trim();
  if (!normalized) return null;

  try {
    const { data: existing, error: existingError } = await supabase
      .from("schools")
      .select("id")
      .eq("name", normalized)
      .maybeSingle();

    if (existingError && existingError.code !== "PGRST116") {
      throw existingError;
    }

    if (existing?.id) return existing.id;

    // Create new school
    const { data: created, error: createError } = await supabase
      .from("schools")
      .insert({ name: normalized })
      .select("id")
      .single();

    if (createError) throw createError;
    return created?.id || null;
  } catch (error) {
    console.error("[useAuth] Failed to resolve school:", error);
    return null;
  }
}

/**
 * Fetch student profile from database
 */
async function fetchStudentProfile(
  userId: string,
): Promise<StudentProfile | null> {
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("*, schools(name)")
      .eq("id", userId)
      .single();

    if (error) {
      // Allow newly created users before profile insert completes
      if (error.code === "PGRST116") {
        console.debug(
          "[useAuth] Profile not yet created for new user:",
          userId,
        );
        return null;
      }
      throw error;
    }

    return data ? toStudentProfile(data) : null;
  } catch (error) {
    console.error("[useAuth] Failed to fetch profile:", error);
    return null;
  }
}

/**
 * Ensure profile exists for session user
 */
async function ensureStudentProfileForSessionUser(
  sessionUser: SupabaseUser,
): Promise<StudentProfile | null> {
  const existing = await fetchStudentProfile(sessionUser.id);
  if (existing) return existing;

  try {
    const now = new Date().toISOString();
    const school_name =
      typeof sessionUser.user_metadata?.school_name === "string"
        ? sessionUser.user_metadata.school_name
        : "";
    const school_id = await resolveSchoolIdByName(school_name);

    const payload = {
      id: sessionUser.id,
      full_name:
        typeof sessionUser.user_metadata?.full_name === "string" &&
        sessionUser.user_metadata.full_name.trim().length > 0
          ? sessionUser.user_metadata.full_name.trim()
          : (sessionUser.email || "").split("@")[0] || "Student",
      role: "student",
      school_id,
      avatar_emoji: "🌱",
      eco_points: 0,
      streak_days: 0,
      daily_goal: 2,
      interests: [],
      city: null,
      last_active_date: null,
      updated_at: now,
    } as any;

    const { error } = await supabase
      .from("profiles")
      .upsert(payload, { onConflict: "id" });

    if (error) {
      console.error("[useAuth] Failed to create profile:", error);
      return null;
    }

    return await fetchStudentProfile(sessionUser.id);
  } catch (error) {
    console.error("[useAuth] Error ensuring profile:", error);
    return null;
  }
}

/**
 * Student Auth Provider
 */
export function StudentAuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<StudentAuthUser | null>(null);
  const [session, setSession] = useState<StudentAuthSession | null>(null);
  const [profile, setProfile] = useState<StudentProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const signUpInFlightRef = useRef(false);
  const signInInFlightRef = useRef(false);

  /**
   * Clear all auth state
   */
  const clearAuthState = useCallback(() => {
    setUser(null);
    setSession(null);
    setProfile(null);
    setError(null);
  }, []);

  /**
   * Apply session to state
   */
  const applySession = useCallback(
    async (nextSession: SupabaseSession | null) => {
      if (!nextSession) {
        clearAuthState();
        return;
      }

      try {
        const nextUser = toStudentAuthUser(nextSession.user);
        setUser(nextUser);
        setSession(toStudentAuthSession(nextSession));

        const fetchedProfile = await ensureStudentProfileForSessionUser(
          nextSession.user,
        );
        const fallbackProfile = buildFallbackStudentProfile(nextUser);
        const effectiveProfile = fetchedProfile ?? fallbackProfile;

        setProfile(effectiveProfile);
        setError(null);
      } catch (err) {
        const error =
          err instanceof Error ? err : new Error("Failed to apply session");
        console.error("[useAuth] Error applying session:", error);
        setError(error);
        clearAuthState();
      }
    },
    [clearAuthState],
  );

  /**
   * Initialize auth on mount
   */
  useEffect(() => {
    let mounted = true;

    const initAuth = async () => {
      try {
        const { data, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;

        if (mounted) {
          await applySession(data.session);
        }
      } catch (err) {
        const error =
          err instanceof Error ? err : new Error("Failed to initialize auth");
        if (mounted) {
          console.error("[useAuth] Auth initialization error:", error);
          setError(error);
          clearAuthState();
        }
      } finally {
        if (mounted) setLoading(false);
      }
    };

    initAuth();

    // Listen for auth state changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!mounted) return;
      setLoading(false);
      void applySession(nextSession);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [applySession, clearAuthState]);

  /**
   * Student sign up
   */
  const signUp = useCallback(
    async (
      email: string,
      password: string,
      fullName: string,
      schoolName?: string,
    ): Promise<{ error: Error | null; needsEmailConfirmation: boolean }> => {
      if (signUpInFlightRef.current) {
        return {
          error: new Error("Signup already in progress"),
          needsEmailConfirmation: false,
        };
      }

      signUpInFlightRef.current = true;
      try {
        const cleanEmail = email.trim().toLowerCase();
        const cleanName = fullName.trim();

        if (!cleanEmail || !cleanName || !password) {
          throw new Error("Missing required signup fields");
        }

        if (cleanEmail.length < 5) {
          throw new Error("Invalid email format");
        }

        if (password.length < 6) {
          throw new Error("Password must be at least 6 characters");
        }

        const { data, error: authError } = await supabase.auth.signUp({
          email: cleanEmail,
          password,
          options: {
            data: {
              full_name: cleanName,
              school_name: (schoolName || "").trim(),
            },
          },
        });

        if (authError) {
          throw new Error(authError.message);
        }

        if (data.user) {
          const now = new Date().toISOString();
          const school_id = await resolveSchoolIdByName(schoolName);

          const baseProfile = {
            id: data.user.id,
            full_name: cleanName,
            role: "student",
            school_id,
            avatar_emoji: "🌱",
            eco_points: 0,
            streak_days: 0,
            daily_goal: 2,
            interests: [],
            city: null,
            last_active_date: null,
            updated_at: now,
          } as any;

          const { error: profileError } = await supabase
            .from("profiles")
            .upsert(baseProfile, { onConflict: "id" });

          if (profileError) {
            console.error("[useAuth] Profile creation error:", profileError);
            throw new Error(profileError.message);
          }
        }

        if (data.session) {
          await applySession(data.session);
        }

        return {
          error: null,
          needsEmailConfirmation: !data.session,
        };
      } catch (err) {
        const error = err instanceof Error ? err : new Error("Signup failed");
        console.error("[useAuth] Signup error:", error);
        setError(error);
        return {
          error,
          needsEmailConfirmation: false,
        };
      } finally {
        signUpInFlightRef.current = false;
      }
    },
    [applySession],
  );

  /**
   * Student sign in
   */
  const signIn = useCallback(
    async (
      email: string,
      password: string,
    ): Promise<{ error: Error | null }> => {
      if (signInInFlightRef.current) {
        return { error: new Error("Login already in progress") };
      }

      signInInFlightRef.current = true;
      try {
        const cleanEmail = email.trim().toLowerCase();

        if (!cleanEmail || !password) {
          throw new Error("Email and password required");
        }

        const { data, error: authError } =
          await supabase.auth.signInWithPassword({
            email: cleanEmail,
            password,
          });

        if (authError || !data.session) {
          throw new Error(authError?.message || "Invalid email or password");
        }

        await applySession(data.session);
        return { error: null };
      } catch (err) {
        const error = err instanceof Error ? err : new Error("Login failed");
        console.error("[useAuth] Sign in error:", error);
        setError(error);
        return { error };
      } finally {
        signInInFlightRef.current = false;
      }
    },
    [applySession],
  );

  /**
   * Student sign out
   */
  const signOut = useCallback(async (): Promise<{ error: Error | null }> => {
    try {
      const { error: signOutError } = await supabase.auth.signOut();
      if (signOutError) throw signOutError;
      clearAuthState();
      return { error: null };
    } catch (err) {
      const error = err instanceof Error ? err : new Error("Sign out failed");
      console.error("[useAuth] Sign out error:", error);
      setError(error);
      return { error };
    }
  }, [clearAuthState]);

  /**
   * Refresh student profile
   */
  const refreshProfile = useCallback(async (): Promise<{
    error: Error | null;
  }> => {
    if (!user?.id) {
      return { error: new Error("Not authenticated") };
    }

    try {
      const fetchedProfile = await fetchStudentProfile(user.id);
      const effectiveProfile =
        fetchedProfile ?? buildFallbackStudentProfile(user);
      setProfile(effectiveProfile);
      setError(null);
      return { error: null };
    } catch (err) {
      const error =
        err instanceof Error ? err : new Error("Failed to refresh profile");
      console.error("[useAuth] Refresh profile error:", error);
      setError(error);
      return { error };
    }
  }, [user?.id]);

  /**
   * Update student profile
   */
  const updateProfile = useCallback(
    async (updates: {
      full_name?: string;
      school_name?: string;
      city?: string;
      avatar_emoji?: string;
      interests?: string[];
      daily_goal?: number;
    }): Promise<{ error: Error | null }> => {
      if (!user?.id) {
        return { error: new Error("Not authenticated") };
      }

      if (!updates || Object.keys(updates).length === 0) {
        return { error: new Error("No fields to update") };
      }

      try {
        const payload: any = {
          ...updates,
          updated_at: new Date().toISOString(),
        };

        // Handle school name -> school_id resolution
        if (updates.school_name !== undefined) {
          const school_id = await resolveSchoolIdByName(updates.school_name);
          payload.school_id = school_id;
        }

        const { error: updateError } = await supabase
          .from("profiles")
          .update(payload)
          .eq("id", user.id);

        if (updateError) {
          throw updateError;
        }

        // Refresh profile to get latest data
        await refreshProfile();
        return { error: null };
      } catch (err) {
        const error =
          err instanceof Error ? err : new Error("Failed to update profile");
        console.error("[useAuth] Update profile error:", error);
        setError(error);
        return { error };
      }
    },
    [user?.id, refreshProfile],
  );

  const isAuthenticated = !!user && !!session;

  const contextValue: StudentAuthContextType = {
    user,
    session,
    profile,
    loading,
    error,
    signUp,
    signIn,
    signOut,
    refreshProfile,
    updateProfile,
    isAuthenticated,
  };

  return React.createElement(
    StudentAuthContext.Provider,
    { value: contextValue },
    children,
  );
}

/**
 * Hook to use student auth context
 */
export function useAuth() {
  const context = useContext(StudentAuthContext);
  if (!context) {
    throw new Error("useAuth must be used within StudentAuthProvider");
  }
  return context;
}

/**
 * Hook to check if student is authenticated
 */
export function useAuthSession() {
  const { user, session, loading } = useAuth();
  return {
    isAuthenticated: !!user && !!session,
    isLoading: loading,
    user,
    session,
  };
}

/**
 * Hook for student profile only
 */
export function useStudentProfile() {
  const { profile, loading, refreshProfile } = useAuth();
  return {
    profile,
    isLoading: loading,
    refreshProfile,
  };
}
