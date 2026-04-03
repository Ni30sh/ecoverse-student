import { useEffect } from "react";
import { Buffer } from "buffer";

import { supabase } from "@/lib/supabase/client";

const EXPECTED_REF = "vzwvnhgorvqnwluzxtkk";
const CHECK_SUBMISSION_ID = "1a8e414c-0839-4401-8ca9-ffdeb8e0323a";

function extractRefFromUrl(url?: string | null) {
  if (!url) return null;
  const m = url.match(/^https:\/\/([a-z0-9-]+)\.supabase\.co/i);
  return m?.[1] ?? null;
}

function decodeJwtPayload(token?: string | null): Record<string, unknown> | null {
  if (!token) return null;
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = Buffer.from(payload, "base64").toString("utf8");
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function debugMobileSupabaseTarget() {
  try {
    const supabaseUrl =
      (process.env.EXPO_PUBLIC_SUPABASE_URL as string) ||
      (process.env.SUPABASE_URL as string) ||
      null;

    const anonKey =
      (process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY as string) ||
      (process.env.SUPABASE_ANON_KEY as string) ||
      null;

    const urlRef = extractRefFromUrl(supabaseUrl);
    const jwtPayload = decodeJwtPayload(anonKey);
    const keyRef = String(jwtPayload?.ref ?? "") || null;

    console.log("[mobile-env] SUPABASE_URL:", supabaseUrl);
    console.log("[mobile-env] URL ref:", urlRef);
    console.log("[mobile-env] Key ref:", keyRef);
    console.log("[mobile-env] Expected ref:", EXPECTED_REF);

    const sameProject =
      urlRef === EXPECTED_REF && (keyRef === EXPECTED_REF || keyRef == null);

    console.log(
      "[mobile-env] Project match:",
      sameProject,
      sameProject ? "PASS" : "FAIL",
    );

    const authResult = await supabase.auth.getUser();
    const currentUserId = authResult.data.user?.id ?? null;
    console.log(
      "[mobile-auth] Currently logged in user ID:",
      currentUserId,
    );

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
        (row) => String((row as Record<string, unknown>).id ?? "") === CHECK_SUBMISSION_ID,
      ),
    );

    console.log(
      "[mobile-db] Target submission 1a8e414c-0839-4401-8ca9-ffdeb8e0323a visible in accessible list:",
      targetVisible,
    );

    const { data, error } = await supabase
      .from("mission_submissions")
      .select("id,status,submitted_at,reviewed_at,user_id,mission_id,updated_at")
      .eq("id", CHECK_SUBMISSION_ID)
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
      console.log("[mobile-db] Pending count visible from mobile session:", count);
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
