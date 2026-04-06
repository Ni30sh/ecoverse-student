import { useEffect } from "react";

import { getSupabaseProjectDiagnostics, supabase } from "@/lib/supabase/client";

const EXPECTED_REF = "vzwvnhgorvqnwluzxtkk";
const CHECK_SUBMISSION_ID = "1a8e414c-0839-4401-8ca9-ffdeb8e0323a";

type DebugSnapshotOptions = {
  reason?: string;
  submissionId?: string;
};

export async function debugMobileSupabaseTarget(
  options?: DebugSnapshotOptions,
) {
  try {
    const reason = String(options?.reason ?? "launch");
    const lookupId = String(
      options?.submissionId ?? CHECK_SUBMISSION_ID,
    ).trim();
    const diagnostics = getSupabaseProjectDiagnostics();

    console.log("[mobile-env] Snapshot reason:", reason);
    console.log("[mobile-env] SUPABASE_URL:", diagnostics.supabaseUrl);
    console.log("[mobile-env] URL ref:", diagnostics.urlRef);
    console.log("[mobile-env] Key ref:", diagnostics.keyRef);
    console.log("[mobile-env] Expected ref:", EXPECTED_REF);
    console.log(
      "[mobile-env] Project match:",
      diagnostics.matchesExpected,
      diagnostics.matchesExpected ? "PASS" : "FAIL",
    );

    const authResult = await supabase.auth.getUser();
    const currentUserId = authResult.data.user?.id ?? null;
    console.log("[mobile-auth] Currently logged in user ID:", currentUserId);

    if (authResult.error) {
      console.log("[mobile-auth] Auth error:", authResult.error);
    }

    const accessibleSubmissions = await supabase
      .from("mission_submissions")
      .select("id,status,user_id,mission_id,submitted_at,updated_at")
      .order("submitted_at", { ascending: false })
      .limit(5);

    if (accessibleSubmissions.error) {
      console.log(
        "[mobile-db] Submissions accessible to this session (first 5) error:",
        accessibleSubmissions.error,
      );
    } else {
      console.log(
        "[mobile-db] mission_submissions accessible to this session (first 5):",
        (accessibleSubmissions.data ?? []).map((row) => ({
          id: row.id,
          user_id: row.user_id,
          status: row.status,
        })),
      );
    }

    const targetVisible = Boolean(
      (accessibleSubmissions.data ?? []).some(
        (row) => String((row as Record<string, unknown>).id ?? "") === lookupId,
      ),
    );

    console.log(
      `[mobile-db] Target submission ${lookupId} visible in accessible list:`,
      targetVisible,
    );

    const { data, error } = await supabase
      .from("mission_submissions")
      .select(
        "id,status,submitted_at,reviewed_at,user_id,mission_id,updated_at",
      )
      .eq("id", lookupId)
      .maybeSingle();

    if (error) {
      console.log("[mobile-db] Submission lookup error:", error);
    } else {
      console.log("[mobile-db] Submission row:", data);
      if (data) {
        console.log(
          "[mobile-db] Submission user_id:",
          data.user_id,
          "Current session user_id:",
          currentUserId,
          "Match:",
          data.user_id === currentUserId,
        );
      }
    }

    const { count, error: pendingError } = await supabase
      .from("mission_submissions")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending");

    if (pendingError) {
      console.log("[mobile-db] Pending count error:", pendingError);
    } else {
      console.log(
        "[mobile-db] Pending count visible from mobile session:",
        count,
      );
    }
  } catch (error) {
    console.log("[mobile-debug] Fatal error:", error);
  }
}

export function SupabaseDebugOnLaunch() {
  useEffect(() => {
    if (__DEV__) {
      void debugMobileSupabaseTarget();
    }
  }, []);

  return null;
}
