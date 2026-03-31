import { LinearGradient } from "expo-linear-gradient";
import { Link, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import Animated, {
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
} from "react-native-reanimated";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { GlassCard } from "@/components/ui/glass-card";
import { PremiumButton } from "@/components/ui/premium-button";
import { useToast } from "@/components/ui/toast-provider";
import { Colors } from "@/constants/theme";
import { isValidEmail } from "@/lib/utils/resilience";
import { logTelemetry } from "@/lib/utils/telemetry";
import { useAuth } from "@/providers/auth-provider";
import { useAppTheme } from "@/providers/theme-provider";

export default function LoginScreen() {
  const { session, profile, loading, signIn, signingIn } = useAuth();
  const router = useRouter();
  const { showToast } = useToast();
  const { resolvedScheme } = useAppTheme();
  const palette = Colors[resolvedScheme];
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [hasNavigated, setHasNavigated] = useState(false);
  const [focusedInput, setFocusedInput] = useState<"email" | "password" | null>(
    null,
  );
  const shakeX = useSharedValue(0);

  const shakeStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: shakeX.value }],
  }));

  useEffect(() => {
    console.log("Render Login Screen");
    console.log("User:", session?.user?.id ?? null);

    if (!loading && session && profile && !hasNavigated) {
      setHasNavigated(true);
      router.replace("/(tabs)");
    }
  }, [hasNavigated, loading, profile, router, session]);

  if (loading || (session && !profile)) {
    return (
      <ThemedView style={styles.container}>
        <View style={styles.card}>
          <ActivityIndicator size="large" />
          <ThemedText style={styles.loadingSubtitle}>
            Preparing your dashboard...
          </ThemedText>
        </View>
      </ThemedView>
    );
  }

  if (session && profile) {
    return null;
  }

  const onSubmit = async () => {
    setErrorMessage("");

    if (!email.trim() || !password.trim()) {
      logTelemetry(
        "warn",
        "login_validation_missing_fields",
        "Email or password missing.",
        {
          screen: "login",
        },
      );
      setErrorMessage("Enter email and password.");
      showToast("Enter email and password.", "error");
      shakeX.value = withSequence(withSpring(-8), withSpring(8), withSpring(0));
      return;
    }

    if (!isValidEmail(email.trim())) {
      logTelemetry(
        "warn",
        "login_validation_bad_email",
        "Invalid email format.",
        {
          screen: "login",
        },
      );
      setErrorMessage("Enter a valid email address.");
      showToast("Enter a valid email address.", "error");
      shakeX.value = withSequence(withSpring(-8), withSpring(8), withSpring(0));
      return;
    }

    if (password.trim().length < 6) {
      logTelemetry(
        "warn",
        "login_validation_short_password",
        "Password too short.",
        {
          screen: "login",
        },
      );
      setErrorMessage("Password must be at least 6 characters.");
      showToast("Password must be at least 6 characters.", "error");
      shakeX.value = withSequence(withSpring(-8), withSpring(8), withSpring(0));
      return;
    }

    const { error } = await signIn(email.trim(), password);
    if (error) {
      logTelemetry("warn", "login_submit_failed", error.message, {
        screen: "login",
      });
      setErrorMessage(error.message);
      showToast(error.message, "error");
      shakeX.value = withSequence(
        withSpring(-10),
        withSpring(10),
        withSpring(0),
      );
      return;
    }

    showToast("Welcome back. Starting your quest.", "success");
  };

  return (
    <LinearGradient
      colors={[palette.background, "#dcfce7"]}
      style={styles.container}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.container}
      >
        <Animated.View
          entering={FadeInDown.duration(420)}
          style={styles.heroWrap}
        >
          <ThemedText style={styles.heroBadge}>EcoQuest</ThemedText>
          <ThemedText
            type="title"
            style={[styles.heroTitle, { color: palette.text }]}
          >
            Start Your Quest
          </ThemedText>
          <ThemedText style={[styles.heroSubtitle, { color: palette.muted }]}>
            Build your streak and grow your impact every day.
          </ThemedText>
        </Animated.View>

        <Animated.View
          entering={FadeInDown.delay(120).duration(420)}
          style={[styles.cardShell, shakeStyle]}
        >
          <GlassCard style={styles.card}>
            <View style={styles.fieldGroup}>
              <ThemedText
                style={[
                  styles.label,
                  focusedInput === "email" ? { color: palette.primary } : null,
                ]}
              >
                Email
              </ThemedText>
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                placeholder="you@student.edu"
                placeholderTextColor={
                  resolvedScheme === "dark" ? "#94a3b8" : "#64748b"
                }
                style={[
                  styles.input,
                  {
                    color: palette.text,
                    backgroundColor:
                      resolvedScheme === "dark"
                        ? "rgba(15,23,42,0.7)"
                        : "#ffffff",
                    borderColor:
                      focusedInput === "email"
                        ? palette.primary
                        : resolvedScheme === "dark"
                          ? "#334155"
                          : "#d1d5db",
                  },
                ]}
                value={email}
                onChangeText={setEmail}
                onFocus={() => setFocusedInput("email")}
                onBlur={() => setFocusedInput(null)}
              />
            </View>

            <View style={styles.fieldGroup}>
              <ThemedText
                style={[
                  styles.label,
                  focusedInput === "password"
                    ? { color: palette.primary }
                    : null,
                ]}
              >
                Password
              </ThemedText>
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
                placeholder="Enter your password"
                placeholderTextColor={
                  resolvedScheme === "dark" ? "#94a3b8" : "#64748b"
                }
                style={[
                  styles.input,
                  {
                    color: palette.text,
                    backgroundColor:
                      resolvedScheme === "dark"
                        ? "rgba(15,23,42,0.7)"
                        : "#ffffff",
                    borderColor:
                      focusedInput === "password"
                        ? palette.primary
                        : resolvedScheme === "dark"
                          ? "#334155"
                          : "#d1d5db",
                  },
                ]}
                value={password}
                onChangeText={setPassword}
                onFocus={() => setFocusedInput("password")}
                onBlur={() => setFocusedInput(null)}
              />
            </View>

            {errorMessage ? (
              <ThemedText style={styles.errorText}>{errorMessage}</ThemedText>
            ) : null}

            {signingIn ? (
              <View style={styles.loadingButton}>
                <ActivityIndicator color="#ffffff" />
              </View>
            ) : (
              <PremiumButton
                label="Start Your Quest ->"
                onPress={() => void onSubmit()}
                disabled={signingIn}
              />
            )}

            <Link href="/signup" asChild>
              <Pressable style={styles.secondaryButton}>
                <ThemedText
                  style={[
                    styles.secondaryButtonLabel,
                    { color: palette.accent },
                  ]}
                >
                  Create a student account
                </ThemedText>
              </Pressable>
            </Link>
          </GlassCard>
        </Animated.View>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 18,
    justifyContent: "center",
  },
  heroWrap: {
    marginBottom: 18,
    gap: 8,
  },
  heroBadge: {
    alignSelf: "flex-start",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
    backgroundColor: "rgba(34,197,94,0.14)",
    color: "#166534",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  heroTitle: {
    fontSize: 26,
    lineHeight: 30,
    fontWeight: "800",
  },
  heroSubtitle: {
    fontSize: 15,
    lineHeight: 22,
  },
  loadingSubtitle: {
    fontSize: 15,
    color: "#64748b",
  },
  cardShell: {
    gap: 12,
  },
  card: {
    borderRadius: 24,
    padding: 18,
    gap: 14,
  },
  fieldGroup: {
    gap: 8,
  },
  label: {
    fontSize: 12,
    letterSpacing: 0.3,
    fontWeight: "700",
    color: "#64748b",
  },
  input: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  loadingButton: {
    minHeight: 52,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#16A34A",
  },
  secondaryButton: {
    minHeight: 42,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(56,189,248,0.12)",
  },
  secondaryButtonLabel: {
    fontSize: 15,
    fontWeight: "800",
  },
  errorText: {
    color: "#ef4444",
    fontSize: 13,
  },
});
