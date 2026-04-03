import { supabase } from "@/lib/supabase/client";

// Types - using 'any' for flexibility until proper types are defined
type TablesInsert<T extends string> = Record<string, any>;
type TablesUpdate<T extends string> = Record<string, any>;

/**
 * Profile with school name normalization
 */
type ProfileWithSchoolName = {
  school_name: string | null;
  role?: string;
} & Record<string, any>;

/**
 * Normalize profile data - handle school joins
 */
function normalizeProfileSchool(row: any): ProfileWithSchoolName | null {
  if (!row) return null;

  const schoolFromJoin = Array.isArray(row?.schools)
    ? row.schools[0]?.name
    : row?.schools?.name;
  return {
    ...row,
    school_name: row?.school_name ?? schoolFromJoin ?? null,
  };
}

/**
 * Resolve or create school by name
 */
async function resolveSchoolIdByName(
  schoolName?: string | null,
): Promise<string | null> {
  const normalizedName = (schoolName || "").trim();
  if (!normalizedName) return null;

  try {
    const { data: existing, error: existingError } = await supabase
      .from("schools")
      .select("id")
      .eq("name", normalizedName)
      .maybeSingle();

    if (existingError && existingError.code !== "PGRST116") {
      throw existingError;
    }

    if (existing?.id) return existing.id;

    // Create new school if it doesn't exist
    const { data: created, error: createError } = await supabase
      .from("schools")
      .insert({ name: normalizedName })
      .select("id")
      .single();

    if (createError) throw createError;
    return created?.id || null;
  } catch (error) {
    console.error("[supabaseQueries] Failed to resolve school:", error);
    throw error;
  }
}

/**
 * Comprehensive Supabase database query utilities
 * Optimized for student mobile app with proper error handling
 */
export const supabaseQueries = {
  // ============================================================================
  // PROFILES (Student Users)
  // ============================================================================

  profiles: {
    /**
     * Get student profile by ID
     */
    async getById(userId: string): Promise<ProfileWithSchoolName | null> {
      if (!userId) return null;

      try {
        const { data, error } = await supabase
          .from("profiles")
          .select("*, schools(name)")
          .eq("id", userId)
          .single();

        if (error) {
          // Allow for newly created users
          if (error.code === "PGRST116") {
            console.debug(
              "[supabaseQueries] Profile not found (new user):",
              userId,
            );
            return null;
          }
          throw error;
        }

        return data ? normalizeProfileSchool(data) : null;
      } catch (error) {
        console.error("[supabaseQueries] Failed to get profile:", error);
        throw error;
      }
    },

    /**
     * Get all profiles
     */
    async getAll(): Promise<ProfileWithSchoolName[]> {
      try {
        const { data, error } = await supabase
          .from("profiles")
          .select("*, schools(name)")
          .eq("role", "student");

        if (error) throw error;
        return (data || []).map(normalizeProfileSchool).filter(
          (profile): profile is ProfileWithSchoolName => profile !== null,
        );
      } catch (error) {
        console.error("[supabaseQueries] Failed to get all profiles:", error);
        return [];
      }
    },

    /**
     * Get profiles by role (students only)
     */
    async getByRole(
      role: "student" | "teacher" | "admin",
    ): Promise<ProfileWithSchoolName[]> {
      // Enforce student-only for this app
      if (role !== "student") {
        console.warn(
          "[supabaseQueries] Non-student role requested, returning empty array",
        );
        return [];
      }

      try {
        const { data, error } = await supabase
          .from("profiles")
          .select("*, schools(name)")
          .eq("role", "student");

        if (error) throw error;
        return (data || []).map(normalizeProfileSchool).filter(
          (profile): profile is ProfileWithSchoolName => profile !== null,
        );
      } catch (error) {
        console.error(
          "[supabaseQueries] Failed to get profiles by role:",
          error,
        );
        return [];
      }
    },

    /**
     * Update student profile
     */
    async update(
      userId: string,
      updates: TablesUpdate<"profiles"> & { school_name?: string | null },
    ): Promise<ProfileWithSchoolName | null> {
      if (!userId) throw new Error("User ID required");

      try {
        const nextUpdates: Record<string, any> = { ...updates };

        // Handle school name resolution
        if ("school_name" in nextUpdates) {
          nextUpdates.school_id = await resolveSchoolIdByName(
            nextUpdates.school_name,
          );
          delete nextUpdates.school_name;
        }

        // Add timestamp
        nextUpdates.updated_at = new Date().toISOString();

        const { data, error } = await supabase
          .from("profiles")
          .update(nextUpdates)
          .eq("id", userId)
          .select("*, schools(name)")
          .single();

        if (error) throw error;
        return data ? normalizeProfileSchool(data) : null;
      } catch (error) {
        console.error("[supabaseQueries] Failed to update profile:", error);
        throw error;
      }
    },

    /**
     * Create new student profile
     */
    async create(
      profile: TablesInsert<"profiles"> & { school_name?: string | null },
    ): Promise<ProfileWithSchoolName | null> {
      try {
        const { school_name, ...baseProfile } =
          profile as TablesInsert<"profiles"> & {
            school_name?: string | null;
          };

        const payload: TablesInsert<"profiles"> = {
          ...baseProfile,
          role: "student", // Force student role
          school_id: await resolveSchoolIdByName(school_name),
        };

        const { data, error } = await supabase
          .from("profiles")
          .insert(payload)
          .select("*, schools(name)")
          .single();

        if (error) throw error;
        return data ? normalizeProfileSchool(data) : null;
      } catch (error) {
        console.error("[supabaseQueries] Failed to create profile:", error);
        throw error;
      }
    },

    /**
     * Add eco points to student profile
     */
    async addEcoPoints(
      userId: string,
      points: number,
    ): Promise<ProfileWithSchoolName | null> {
      if (!userId || !Number.isFinite(points)) {
        throw new Error("Invalid user ID or points");
      }

      try {
        const profile = await this.getById(userId);
        if (!profile) throw new Error("Profile not found");

        const newPoints = Math.max(0, (profile.eco_points || 0) + points);

        return this.update(userId, {
          eco_points: newPoints,
        });
      } catch (error) {
        console.error("[supabaseQueries] Failed to add eco points:", error);
        throw error;
      }
    },

    /**
     * Update student streak
     */
    async updateStreak(
      userId: string,
      days: number,
    ): Promise<ProfileWithSchoolName | null> {
      if (!userId || !Number.isFinite(days)) {
        throw new Error("Invalid user ID or days");
      }

      try {
        return this.update(userId, {
          streak_days: Math.max(0, days),
          last_active_date: new Date().toISOString(),
        });
      } catch (error) {
        console.error("[supabaseQueries] Failed to update streak:", error);
        throw error;
      }
    },
  },

  // ============================================================================
  // MISSIONS (Eco Tasks)
  // ============================================================================

  missions: {
    /**
     * Get all active missions
     */
    async getAll() {
      try {
        const { data, error } = await supabase
          .from("missions")
          .select("*")
          .eq("is_active", true)
          .order("created_at", { ascending: false });

        if (error) throw error;
        return data || [];
      } catch (error) {
        console.error("[supabaseQueries] Failed to get missions:", error);
        return [];
      }
    },

    /**
     * Get mission by ID
     */
    async getById(missionId: string) {
      if (!missionId) return null;

      try {
        const { data, error } = await supabase
          .from("missions")
          .select("*")
          .eq("id", missionId)
          .single();

        if (error) {
          if (error.code === "PGRST116") return null;
          throw error;
        }

        return data;
      } catch (error) {
        console.error("[supabaseQueries] Failed to get mission:", error);
        throw error;
      }
    },

    /**
     * Get missions by category
     */
    async getByCategory(category: string) {
      if (!category) return [];

      try {
        const { data, error } = await supabase
          .from("missions")
          .select("*")
          .eq("category", category)
          .eq("is_active", true);

        if (error) throw error;
        return data || [];
      } catch (error) {
        console.error(
          "[supabaseQueries] Failed to get missions by category:",
          error,
        );
        return [];
      }
    },

    /**
     * Create new mission (admin)
     */
    async create(mission: TablesInsert<"missions">) {
      try {
        const { data, error } = await supabase
          .from("missions")
          .insert(mission)
          .select()
          .single();

        if (error) throw error;
        return data;
      } catch (error) {
        console.error("[supabaseQueries] Failed to create mission:", error);
        throw error;
      }
    },

    /**
     * Update mission (admin)
     */
    async update(missionId: string, updates: TablesUpdate<"missions">) {
      if (!missionId) throw new Error("Mission ID required");

      try {
        const { data, error } = await supabase
          .from("missions")
          .update(updates)
          .eq("id", missionId)
          .select()
          .single();

        if (error) throw error;
        return data;
      } catch (error) {
        console.error("[supabaseQueries] Failed to update mission:", error);
        throw error;
      }
    },
  },

  // ============================================================================
  // MISSION STEPS (Multi-Step Instructions)
  // ============================================================================

  missionSteps: {
    /**
     * Get all steps for a mission (ordered)
     */
    async getByMissionId(missionId: string) {
      if (!missionId) return [];

      try {
        const { data, error } = await supabase
          .from("mission_steps")
          .select("*")
          .eq("mission_id", missionId)
          .order("step_number", { ascending: true });

        if (error) throw error;
        return data || [];
      } catch (error) {
        console.error("[supabaseQueries] Failed to get mission steps:", error);
        return [];
      }
    },

    /**
     * Get step by ID
     */
    async getById(stepId: string) {
      if (!stepId) return null;

      try {
        const { data, error } = await supabase
          .from("mission_steps")
          .select("*")
          .eq("id", stepId)
          .single();

        if (error) {
          if (error.code === "PGRST116") return null;
          throw error;
        }

        return data;
      } catch (error) {
        console.error("[supabaseQueries] Failed to get mission step:", error);
        throw error;
      }
    },

    /**
     * Create new step (admin)
     */
    async create(step: any) {
      try {
        const { data, error } = await supabase
          .from("mission_steps")
          .insert(step)
          .select()
          .single();

        if (error) throw error;
        return data;
      } catch (error) {
        console.error(
          "[supabaseQueries] Failed to create mission step:",
          error,
        );
        throw error;
      }
    },

    /**
     * Update step (admin)
     */
    async update(stepId: string, updates: any) {
      if (!stepId) throw new Error("Step ID required");

      try {
        const { data, error } = await supabase
          .from("mission_steps")
          .update(updates)
          .eq("id", stepId)
          .select()
          .single();

        if (error) throw error;
        return data;
      } catch (error) {
        console.error(
          "[supabaseQueries] Failed to update mission step:",
          error,
        );
        throw error;
      }
    },
  },

  // ============================================================================
  // MISSION SUBMISSIONS (Student Progress)
  // ============================================================================

  missionSubmissions: {
    /**
     * Get all student's mission submissions
     */
    async getUserSubmissions(userId: string) {
      if (!userId) return [];

      try {
        const canonical = await supabase
          .from("submissions")
          .select("*, missions(*)")
          .eq("user_id", userId)
          .order("updated_at", { ascending: false });

        if (!canonical.error) {
          return canonical.data || [];
        }

        const { data, error } = await supabase
          .from("mission_submissions")
          .select("*, missions(*)")
          .eq("user_id", userId)
          .order("updated_at", { ascending: false });

        if (error) throw error;
        return data || [];
      } catch (error) {
        console.error(
          "[supabaseQueries] Failed to get user submissions:",
          error,
        );
        return [];
      }
    },

    /**
     * Get submission by ID
     */
    async getById(submissionId: string) {
      if (!submissionId) return null;

      try {
        const { data, error } = await supabase
          .from("mission_submissions")
          .select("*, missions(*)")
          .eq("id", submissionId)
          .single();

        if (error) {
          if (error.code === "PGRST116") return null;
          throw error;
        }

        return data;
      } catch (error) {
        console.error("[supabaseQueries] Failed to get submission:", error);
        throw error;
      }
    },

    /**
     * Get submissions by status
     */
    async getByStatus(status: string) {
      if (!status) return [];

      try {
        const { data, error } = await supabase
          .from("mission_submissions")
          .select("*, missions(*)")
          .eq("status", status)
          .order("created_at", { ascending: false });

        if (error) throw error;
        return data || [];
      } catch (error) {
        console.error(
          "[supabaseQueries] Failed to get submissions by status:",
          error,
        );
        return [];
      }
    },

    /**
     * Get submission for specific mission
     */
    async getSubmissionForMission(userId: string, missionId: string) {
      if (!userId || !missionId) return null;

      try {
        const { data, error } = await supabase
          .from("mission_submissions")
          .select("*")
          .eq("user_id", userId)
          .eq("mission_id", missionId)
          .maybeSingle();

        if (error) throw error;
        return data;
      } catch (error) {
        console.error(
          "[supabaseQueries] Failed to get mission submission:",
          error,
        );
        throw error;
      }
    },

    /**
     * Create new mission submission
     */
    async create(submission: TablesInsert<"mission_submissions">) {
      if (!submission?.user_id || !submission?.mission_id) {
        throw new Error("User ID and Mission ID required");
      }

      try {
        const payload = {
          user_id: submission.user_id,
          mission_id: submission.mission_id,
          status: "in_progress",
          updated_at: new Date().toISOString(),
        };

        const { data, error } = await supabase
          .from("submissions")
          .upsert(payload, { onConflict: "user_id,mission_id" })
          .select()
          .single();

        const canonicalNotNullSubmittedAt =
          !!error &&
          /submitted_at/i.test(String(error.message ?? "")) &&
          /not-null|null value/i.test(String(error.message ?? ""));

        const canonicalInvalidStatus =
          !!error &&
          /status/i.test(String(error.message ?? "")) &&
          /(constraint|check)/i.test(String(error.message ?? ""));

        if (canonicalNotNullSubmittedAt) {
          const compat = await supabase
            .from("submissions")
            .upsert(
              { ...payload, submitted_at: new Date().toISOString() },
              { onConflict: "user_id,mission_id" },
            )
            .select()
            .single();

          if (!compat.error) return compat.data;
        }

        if (canonicalInvalidStatus) {
          const compat = await supabase
            .from("submissions")
            .upsert(
              {
                ...payload,
                status: "pending",
                submitted_at: new Date().toISOString(),
              },
              { onConflict: "user_id,mission_id" },
            )
            .select()
            .single();

          if (!compat.error) return compat.data;
        }

        if (!error) return data;

        const legacy = await supabase
          .from("mission_submissions")
          .upsert(payload, { onConflict: "user_id,mission_id" })
          .select()
          .single();

        const legacyNotNullSubmittedAt =
          !!legacy.error &&
          /submitted_at/i.test(String(legacy.error.message ?? "")) &&
          /not-null|null value/i.test(String(legacy.error.message ?? ""));

        const legacyInvalidStatus =
          !!legacy.error &&
          /status/i.test(String(legacy.error.message ?? "")) &&
          /(constraint|check)/i.test(String(legacy.error.message ?? ""));

        if (legacyNotNullSubmittedAt) {
          const compatLegacy = await supabase
            .from("mission_submissions")
            .upsert(
              { ...payload, submitted_at: new Date().toISOString() },
              { onConflict: "user_id,mission_id" },
            )
            .select()
            .single();

          if (!compatLegacy.error) return compatLegacy.data;
        }

        if (legacyInvalidStatus) {
          const compatLegacy = await supabase
            .from("mission_submissions")
            .upsert(
              {
                ...payload,
                status: "pending",
                submitted_at: new Date().toISOString(),
              },
              { onConflict: "user_id,mission_id" },
            )
            .select()
            .single();

          if (!compatLegacy.error) return compatLegacy.data;
        }

        if (legacy.error) throw legacy.error;
        return legacy.data;
      } catch (error) {
        console.error("[supabaseQueries] Failed to create submission:", error);
        throw error;
      }
    },

    /**
     * Update submission
     */
    async update(
      submissionId: string,
      updates: TablesUpdate<"mission_submissions">,
    ) {
      if (!submissionId) throw new Error("Submission ID required");

      try {
        const { data, error } = await supabase
          .from("mission_submissions")
          .update(updates)
          .eq("id", submissionId)
          .select()
          .single();

        if (error) throw error;
        return data;
      } catch (error) {
        console.error("[supabaseQueries] Failed to update submission:", error);
        throw error;
      }
    },

    /**
     * Submit proof for mission
     */
    async submitProof(
      submissionId: string,
      photoUrl: string,
      notes?: string,
      coords?: { lat: number; lng: number },
    ) {
      if (!submissionId || !photoUrl) {
        throw new Error("Submission ID and photo URL required");
      }

      try {
        const rpcAttempts = [
          () =>
            supabase.rpc("submit_mission_proof", {
              p_submission_id: submissionId,
              p_photo_url: photoUrl,
              p_notes: notes || "",
              p_latitude: coords?.lat ?? null,
              p_longitude: coords?.lng ?? null,
            }),
          () =>
            supabase.rpc("submit_mission_proof", {
              submission_id: submissionId,
              photo_url: photoUrl,
              notes: notes || "",
              latitude: coords?.lat ?? null,
              longitude: coords?.lng ?? null,
            }),
          () =>
            supabase.rpc("submit_proof_for_submission", {
              p_submission_id: submissionId,
              p_photo_url: photoUrl,
              p_notes: notes || "",
              p_latitude: coords?.lat ?? null,
              p_longitude: coords?.lng ?? null,
            }),
        ];

        for (const runRpc of rpcAttempts) {
          const { data, error } = await runRpc();
          if (error) continue;
          if (Array.isArray(data)) {
            return data[0] || null;
          }
          return data || null;
        }

        throw new Error(
          "Proof submission RPC failed. Mission status is not updated.",
        );
      } catch (error) {
        console.error("[supabaseQueries] Failed to submit proof:", error);
        throw error;
      }
    },

    /**
     * Approve submission (teacher/admin)
     */
    async approveSubmission(
      submissionId: string,
      reviewedById: string,
      feedback?: string,
    ) {
      if (!submissionId || !reviewedById) {
        throw new Error("Submission ID and reviewer ID required");
      }

      try {
        return this.update(submissionId, {
          status: "approved",
          reviewed_by: reviewedById,
          reviewed_at: new Date().toISOString(),
          feedback: feedback || null,
        });
      } catch (error) {
        console.error("[supabaseQueries] Failed to approve submission:", error);
        throw error;
      }
    },

    /**
     * Reject submission (teacher/admin)
     */
    async rejectSubmission(
      submissionId: string,
      reviewedById: string,
      reason: string,
    ) {
      if (!submissionId || !reviewedById || !reason) {
        throw new Error("Submission ID, reviewer ID, and reason required");
      }

      try {
        return this.update(submissionId, {
          status: "rejected",
          reviewed_by: reviewedById,
          reviewed_at: new Date().toISOString(),
          rejection_reason: reason,
        });
      } catch (error) {
        console.error("[supabaseQueries] Failed to reject submission:", error);
        throw error;
      }
    },
  },

  // ============================================================================
  // MISSION STEP SUBMISSIONS (Individual Step Tracking)
  // ============================================================================

  missionStepSubmissions: {
    /**
     * Get all step submissions for a mission submission
     */
    async getByMissionSubmission(missionSubmissionId: string) {
      if (!missionSubmissionId) return [];

      try {
        const { data, error } = await supabase
          .from("mission_step_submissions")
          .select("*, mission_steps(*)")
          .eq("mission_submission_id", missionSubmissionId)
          .order("created_at", { ascending: true });

        if (error) throw error;
        return data || [];
      } catch (error) {
        console.error(
          "[supabaseQueries] Failed to get step submissions:",
          error,
        );
        return [];
      }
    },

    /**
     * Get step submission by ID
     */
    async getById(stepSubmissionId: string) {
      if (!stepSubmissionId) return null;

      try {
        const { data, error } = await supabase
          .from("mission_step_submissions")
          .select("*, mission_steps(*)")
          .eq("id", stepSubmissionId)
          .single();

        if (error) {
          if (error.code === "PGRST116") return null;
          throw error;
        }

        return data;
      } catch (error) {
        console.error(
          "[supabaseQueries] Failed to get step submission:",
          error,
        );
        throw error;
      }
    },

    /**
     * Submit a mission step
     */
    async submitStep(
      missionSubmissionId: string,
      stepId: string,
      checkpointData?: any,
    ) {
      if (!missionSubmissionId || !stepId) {
        throw new Error("Mission submission ID and step ID required");
      }

      try {
        const { data, error } = await supabase
          .from("mission_step_submissions")
          .upsert(
            {
              mission_submission_id: missionSubmissionId,
              step_id: stepId,
              checkpoint_data: checkpointData || null,
              status: "submitted",
              submitted_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
            { onConflict: "mission_submission_id,step_id" },
          )
          .select()
          .single();

        if (error) throw error;
        return data;
      } catch (error) {
        console.error("[supabaseQueries] Failed to submit step:", error);
        throw error;
      }
    },

    /**
     * Verify step (teacher/admin)
     */
    async verifyStep(
      stepSubmissionId: string,
      verifiedById: string,
      notes?: string,
    ) {
      if (!stepSubmissionId || !verifiedById) {
        throw new Error("Step submission ID and verifier ID required");
      }

      try {
        const { data, error } = await supabase
          .from("mission_step_submissions")
          .update({
            status: "verified",
            verified_by: verifiedById,
            verified_at: new Date().toISOString(),
            verification_notes: notes || null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", stepSubmissionId)
          .select()
          .single();

        if (error) throw error;
        return data;
      } catch (error) {
        console.error("[supabaseQueries] Failed to verify step:", error);
        throw error;
      }
    },

    /**
     * Reject step (teacher/admin)
     */
    async rejectStep(
      stepSubmissionId: string,
      verifiedById: string,
      reason: string,
    ) {
      if (!stepSubmissionId || !verifiedById || !reason) {
        throw new Error("Step submission ID, verifier ID, and reason required");
      }

      try {
        const { data, error } = await supabase
          .from("mission_step_submissions")
          .update({
            status: "rejected",
            verified_by: verifiedById,
            verified_at: new Date().toISOString(),
            verification_notes: reason,
            updated_at: new Date().toISOString(),
          })
          .eq("id", stepSubmissionId)
          .select()
          .single();

        if (error) throw error;
        return data;
      } catch (error) {
        console.error("[supabaseQueries] Failed to reject step:", error);
        throw error;
      }
    },
  },

  // ============================================================================
  // DAILY POINTS (Points Tracking)
  // ============================================================================

  dailyPoints: {
    /**
     * Get points for specific user and date
     */
    async getByUserAndDate(userId: string, date: string) {
      if (!userId || !date) return null;

      try {
        const { data, error } = await supabase
          .from("daily_points")
          .select("*")
          .eq("user_id", userId)
          .eq("date", date)
          .maybeSingle();

        if (error) throw error;
        return data;
      } catch (error) {
        console.error("[supabaseQueries] Failed to get daily points:", error);
        throw error;
      }
    },

    /**
     * Record points for a user on a date
     */
    async recordPoints(userId: string, points: number, date: string) {
      if (!userId || !Number.isFinite(points) || !date) {
        throw new Error("User ID, points, and date required");
      }

      try {
        const { data, error } = await supabase
          .from("daily_points")
          .upsert(
            {
              user_id: userId,
              date: date,
              points_earned: Math.max(0, points),
            },
            { onConflict: "user_id,date" },
          )
          .select()
          .single();

        if (error) throw error;
        return data;
      } catch (error) {
        console.error("[supabaseQueries] Failed to record points:", error);
        throw error;
      }
    },

    /**
     * Get weekly points for a user
     */
    async getWeeklyPoints(userId: string) {
      if (!userId) return [];

      try {
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
        const startDate = sevenDaysAgo.toISOString().split("T")[0];

        const { data, error } = await supabase
          .from("daily_points")
          .select("*")
          .eq("user_id", userId)
          .gte("date", startDate)
          .order("date", { ascending: true });

        if (error) throw error;
        return data || [];
      } catch (error) {
        console.error("[supabaseQueries] Failed to get weekly points:", error);
        return [];
      }
    },

    /**
     * Get monthly points for a user
     */
    async getMonthlyPoints(userId: string) {
      if (!userId) return [];

      try {
        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const startDate = startOfMonth.toISOString().split("T")[0];

        const { data, error } = await supabase
          .from("daily_points")
          .select("*")
          .eq("user_id", userId)
          .gte("date", startDate)
          .order("date", { ascending: true });

        if (error) throw error;
        return data || [];
      } catch (error) {
        console.error("[supabaseQueries] Failed to get monthly points:", error);
        return [];
      }
    },
  },

  // ============================================================================
  // NOTIFICATIONS (Student Alerts)
  // ============================================================================

  notifications: {
    /**
     * Get all notifications for a student
     */
    async getUserNotifications(userId: string) {
      if (!userId) return [];

      try {
        const { data, error } = await supabase
          .from("notifications")
          .select("*")
          .eq("user_id", userId)
          .order("created_at", { ascending: false });

        if (error) throw error;
        return data || [];
      } catch (error) {
        console.error("[supabaseQueries] Failed to get notifications:", error);
        return [];
      }
    },

    /**
     * Create new notification
     */
    async create(notification: TablesInsert<"notifications">) {
      if (!notification?.user_id) {
        throw new Error("User ID required");
      }

      try {
        const { data, error } = await supabase
          .from("notifications")
          .insert(notification)
          .select()
          .single();

        if (error) throw error;
        return data;
      } catch (error) {
        console.error(
          "[supabaseQueries] Failed to create notification:",
          error,
        );
        throw error;
      }
    },

    /**
     * Mark notification as read
     */
    async markAsRead(notificationId: string) {
      if (!notificationId) throw new Error("Notification ID required");

      try {
        const { data, error } = await supabase
          .from("notifications")
          .update({ is_read: true, updated_at: new Date().toISOString() })
          .eq("id", notificationId)
          .select()
          .single();

        if (error) throw error;
        return data;
      } catch (error) {
        console.error(
          "[supabaseQueries] Failed to mark notification as read:",
          error,
        );
        throw error;
      }
    },

    /**
     * Mark all notifications as read for a student
     */
    async markAllAsRead(userId: string) {
      if (!userId) throw new Error("User ID required");

      try {
        const { data, error } = await supabase
          .from("notifications")
          .update({ is_read: true, updated_at: new Date().toISOString() })
          .eq("user_id", userId)
          .eq("is_read", false)
          .select();

        if (error) throw error;
        return data || [];
      } catch (error) {
        console.error(
          "[supabaseQueries] Failed to mark all notifications as read:",
          error,
        );
        throw error;
      }
    },
  },

  // ============================================================================
  // LEADERBOARD (Rankings)
  // ============================================================================

  leaderboard: {
    /**
     * Get top students by eco points
     */
    async getTopUsers(limit: number = 10) {
      if (!Number.isFinite(limit) || limit < 1) return [];

      try {
        const students = await supabaseQueries.profiles.getByRole("student");
        return students
          .filter((s) => s?.eco_points)
          .sort((a, b) => (b.eco_points || 0) - (a.eco_points || 0))
          .slice(0, Math.min(limit, 100));
      } catch (error) {
        console.error("[supabaseQueries] Failed to get top users:", error);
        return [];
      }
    },

    /**
     * Get student's rank
     */
    async getRank(userId: string): Promise<number> {
      if (!userId) return 999;

      try {
        const profile = await supabaseQueries.profiles.getById(userId);
        if (!profile) return 999;

        const { data, error } = await supabase
          .from("profiles")
          .select("id", { count: "exact" })
          .eq("role", "student")
          .gt("eco_points", profile.eco_points || 0);

        if (error) throw error;
        return (data?.length || 0) + 1;
      } catch (error) {
        console.error("[supabaseQueries] Failed to get rank:", error);
        return 999;
      }
    },
  },

  // ============================================================================
  // BADGES (Achievements)
  // ============================================================================

  badges: {
    /**
     * Get all badges
     */
    async getAll() {
      try {
        const { data, error } = await supabase.from("badges").select("*");

        if (error) throw error;
        return data || [];
      } catch (error) {
        console.error("[supabaseQueries] Failed to get badges:", error);
        return [];
      }
    },

    /**
     * Get student's badges
     */
    async getUserBadges(userId: string) {
      if (!userId) return [];

      try {
        const { data, error } = await supabase
          .from("user_badges")
          .select("badges(*)")
          .eq("user_id", userId);

        if (error) throw error;
        return data?.map((ub: any) => ub.badges).filter(Boolean) || [];
      } catch (error) {
        console.error("[supabaseQueries] Failed to get user badges:", error);
        return [];
      }
    },

    /**
     * Award badge to student
     */
    async awardBadge(userId: string, badgeId: string) {
      if (!userId || !badgeId) {
        throw new Error("User ID and badge ID required");
      }

      try {
        const { data, error } = await supabase
          .from("user_badges")
          .upsert(
            {
              user_id: userId,
              badge_id: badgeId,
              earned_at: new Date().toISOString(),
            },
            { onConflict: "user_id,badge_id" },
          )
          .select()
          .single();

        if (error) throw error;
        return data;
      } catch (error) {
        console.error("[supabaseQueries] Failed to award badge:", error);
        throw error;
      }
    },
  },
};
