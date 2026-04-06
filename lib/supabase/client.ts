import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import { Buffer } from "buffer";
import { Platform } from "react-native";

const supabaseUrl =
  process.env.EXPO_PUBLIC_SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const supabaseAnonKey =
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ??
  process.env.VITE_SUPABASE_ANON_KEY;
const EXPECTED_PROJECT_REF = "vzwvnhgorvqnwluzxtkk";

function extractRefFromUrl(url?: string | null) {
  if (!url) {
    return null;
  }

  const match = url.match(/^https:\/\/([a-z0-9-]+)\.supabase\.co/i);
  return match?.[1] ?? null;
}

function decodeJwtPayload(
  token?: string | null,
): Record<string, unknown> | null {
  if (!token) {
    return null;
  }

  try {
    const parts = token.split(".");
    if (parts.length < 2) {
      return null;
    }

    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = Buffer.from(payload, "base64").toString("utf8");
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function getSupabaseProjectDiagnostics() {
  const urlRef = extractRefFromUrl(supabaseUrl);
  const keyPayload = decodeJwtPayload(supabaseAnonKey);
  const keyRef = String(keyPayload?.ref ?? "").trim() || null;
  const matchesExpected =
    urlRef === EXPECTED_PROJECT_REF &&
    (keyRef === EXPECTED_PROJECT_REF || keyRef === null);

  return {
    supabaseUrl,
    expectedRef: EXPECTED_PROJECT_REF,
    urlRef,
    keyRef,
    matchesExpected,
  };
}

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("Missing Supabase environment variables.");
}

const noopStorage = {
  getItem: async (_key: string) => null,
  setItem: async (_key: string, _value: string) => {},
  removeItem: async (_key: string) => {},
};

const webStorage = {
  getItem: async (key: string) => {
    if (typeof window === "undefined") {
      return null;
    }

    return window.localStorage.getItem(key);
  },
  setItem: async (key: string, value: string) => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(key, value);
  },
  removeItem: async (key: string) => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.removeItem(key);
  },
};

const authStorage =
  Platform.OS === "web"
    ? typeof window === "undefined"
      ? noopStorage
      : webStorage
    : AsyncStorage;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: authStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

if (__DEV__) {
  const diagnostics = getSupabaseProjectDiagnostics();
  console.log("[supabase-project-check] mobile target", {
    expectedRef: diagnostics.expectedRef,
    activeRef: diagnostics.urlRef ?? "unknown",
    keyRef: diagnostics.keyRef ?? "unknown",
    matches: diagnostics.matchesExpected,
  });
}
