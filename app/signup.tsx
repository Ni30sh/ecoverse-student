import { LinearGradient } from "expo-linear-gradient";
import { Link, Redirect, router } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";

import { ThemedText } from "@/components/themed-text";
import { GlassCard } from "@/components/ui/glass-card";
import { PremiumButton } from "@/components/ui/premium-button";
import { useToast } from "@/components/ui/toast-provider";
import { Colors } from "@/constants/theme";
import { isValidEmail } from "@/lib/utils/resilience";
import { useAuth } from "@/providers/auth-provider";
import { useAppTheme } from "@/providers/theme-provider";

export default function SignupScreen() {
  const { session, loading, signUp, signingUp } = useAuth();
  const { showToast } = useToast();
  const { resolvedScheme } = useAppTheme();
  const palette = Colors[resolvedScheme];

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  if (!loading && session) {
    return <Redirect href="/(tabs)" />;
  }

  const onSubmit = async () => {
    setMessage("");
    setErrorMessage("");

    if (!email.trim() || !password.trim() || !confirmPassword.trim()) {
      setErrorMessage("Please fill in all fields.");
      showToast("Please fill in all fields.", "error");
      return;
    }

    if (!isValidEmail(email.trim())) {
      setErrorMessage("Enter a valid email address.");
      showToast("Enter a valid email address.", "error");
      return;
    }

    if (password.length < 6) {
      setErrorMessage("Password must be at least 6 characters.");
      showToast("Password must be at least 6 characters.", "error");
      return;
    }

    if (password !== confirmPassword) {
      setErrorMessage("Passwords do not match.");
      showToast("Passwords do not match.", "error");
      return;
    }

    const { error } = await signUp(email.trim(), password);
    if (error) {
      setErrorMessage(error.message);
      showToast(error.message, "error");
      return;
    }

    setMessage("Account created. You can now log in.");
    showToast("Account created successfully.", "success");
    setTimeout(() => {
      router.replace("/login");
    }, 500);
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
          style={styles.headerWrap}
        >
          <ThemedText style={styles.badge}>EcoQuest</ThemedText>
          <ThemedText
            type="title"
            style={[styles.title, { color: palette.text }]}
          >
            Create Your Student Account
          </ThemedText>
          <ThemedText style={[styles.subtitle, { color: palette.muted }]}>
            Join the eco challenge and start earning points.
          </ThemedText>
        </Animated.View>

        <Animated.View entering={FadeInDown.delay(100).duration(420)}>
          <GlassCard style={styles.card}>
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              placeholder="Email"
              placeholderTextColor={
                resolvedScheme === "dark" ? "#94a3b8" : "#64748b"
              }
              style={[
                styles.input,
                {
                  color: palette.text,
                  backgroundColor:
                    resolvedScheme === "dark" ? "rgba(15,23,42,0.7)" : "#fff",
                },
              ]}
              value={email}
              onChangeText={setEmail}
            />

            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              placeholder="Password"
              placeholderTextColor={
                resolvedScheme === "dark" ? "#94a3b8" : "#64748b"
              }
              style={[
                styles.input,
                {
                  color: palette.text,
                  backgroundColor:
                    resolvedScheme === "dark" ? "rgba(15,23,42,0.7)" : "#fff",
                },
              ]}
              value={password}
              onChangeText={setPassword}
            />

            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              placeholder="Confirm Password"
              placeholderTextColor={
                resolvedScheme === "dark" ? "#94a3b8" : "#64748b"
              }
              style={[
                styles.input,
                {
                  color: palette.text,
                  backgroundColor:
                    resolvedScheme === "dark" ? "rgba(15,23,42,0.7)" : "#fff",
                },
              ]}
              value={confirmPassword}
              onChangeText={setConfirmPassword}
            />

            {errorMessage ? (
              <ThemedText style={styles.errorText}>{errorMessage}</ThemedText>
            ) : null}
            {message ? (
              <ThemedText style={styles.successText}>{message}</ThemedText>
            ) : null}

            {signingUp ? (
              <View style={styles.loadingButton}>
                <ActivityIndicator color="#ffffff" />
              </View>
            ) : (
              <PremiumButton
                label="Create Account"
                onPress={() => void onSubmit()}
                disabled={signingUp}
              />
            )}

            <Link href="/login" asChild>
              <Pressable style={styles.secondaryButton}>
                <ThemedText
                  style={[
                    styles.secondaryButtonLabel,
                    { color: palette.accent },
                  ]}
                >
                  Back to login
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
  headerWrap: {
    marginBottom: 18,
    gap: 8,
  },
  badge: {
    alignSelf: "flex-start",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
    backgroundColor: "rgba(34,197,94,0.14)",
    color: "#166534",
    fontSize: 12,
    fontWeight: "800",
  },
  title: {
    fontSize: 24,
    lineHeight: 28,
    fontWeight: "800",
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
  },
  card: {
    gap: 12,
  },
  input: {
    borderWidth: 1,
    borderColor: "#d1d5db",
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
  successText: {
    color: "#16A34A",
  },
  errorText: {
    color: "#ef4444",
  },
});
