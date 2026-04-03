import { LinearGradient } from "expo-linear-gradient";
import { Link, Redirect, router } from "expo-router";
import { useState } from "react";
import {
    ActivityIndicator,
    KeyboardAvoidingView,
    Platform,
    Pressable,
    ScrollView,
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

  const schoolOptions = ["MPGI", "PSIT", "KIT", "KGI", "AKTU"];
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [schoolName, setSchoolName] = useState("");
  const [showSchoolOptions, setShowSchoolOptions] = useState(false);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  if (!loading && session) {
    return <Redirect href="/(tabs)" />;
  }

  const onSubmit = async () => {
    setMessage("");
    setErrorMessage("");

    if (!fullName.trim() || !email.trim() || !password.trim() || !schoolName) {
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

    const { error } = await signUp(
      fullName.trim(),
      email.trim(),
      password,
      schoolName,
    );
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
        <ScrollView
          contentContainerStyle={styles.scrollContainer}
          keyboardShouldPersistTaps="handled"
        >
          <Animated.View
            entering={FadeInDown.duration(420)}
            style={styles.heroWrap}
          >
            <ThemedText style={styles.heroBadge}>ECO</ThemedText>
            <ThemedText
              type="title"
              style={[styles.title, { color: palette.text }]}
            >
              Student Signup
            </ThemedText>
            <ThemedText style={[styles.subtitle, { color: palette.muted }]}>
              Create your account. School assignment is system controlled.
            </ThemedText>
          </Animated.View>

          <Animated.View entering={FadeInDown.delay(100).duration(420)}>
            <GlassCard style={styles.card}>
              <ThemedText style={styles.label}>Full Name</ThemedText>
              <TextInput
                autoCapitalize="words"
                autoCorrect={false}
                placeholder="Your full name"
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
                value={fullName}
                onChangeText={setFullName}
              />

              <ThemedText style={styles.label}>Email</ThemedText>
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                placeholder="your@email.com"
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

              <ThemedText style={styles.label}>Password</ThemedText>
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
                placeholder="********"
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

              <ThemedText style={styles.label}>School Name</ThemedText>
              <Pressable
                onPress={() => setShowSchoolOptions((prev) => !prev)}
                style={[
                  styles.input,
                  styles.selector,
                  {
                    backgroundColor:
                      resolvedScheme === "dark" ? "rgba(15,23,42,0.7)" : "#fff",
                    borderColor: "#b8c9bf",
                  },
                ]}
              >
                <ThemedText
                  style={[
                    styles.selectorText,
                    { color: schoolName ? palette.text : palette.muted },
                  ]}
                >
                  {schoolName || "Select your school"}
                </ThemedText>
                <ThemedText style={styles.selectorArrow}>v</ThemedText>
              </Pressable>

              {showSchoolOptions ? (
                <View style={styles.optionsList}>
                  {schoolOptions.map((option) => (
                    <Pressable
                      key={option}
                      onPress={() => {
                        setSchoolName(option);
                        setShowSchoolOptions(false);
                      }}
                      style={styles.optionItem}
                    >
                      <ThemedText style={styles.optionText}>
                        {option}
                      </ThemedText>
                    </Pressable>
                  ))}
                </View>
              ) : null}

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
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContainer: {
    flexGrow: 1,
    paddingHorizontal: 18,
    paddingVertical: 22,
    justifyContent: "center",
  },
  heroWrap: {
    alignItems: "center",
    marginBottom: 16,
    gap: 8,
  },
  heroBadge: {
    fontSize: 18,
    fontWeight: "800",
    letterSpacing: 1,
    color: "#166534",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: "rgba(34,197,94,0.14)",
  },
  title: {
    fontSize: 40,
    lineHeight: 44,
    fontWeight: "800",
    textAlign: "center",
  },
  subtitle: {
    fontSize: 16,
    lineHeight: 24,
    textAlign: "center",
  },
  card: {
    gap: 12,
    paddingBottom: 14,
  },
  label: {
    fontSize: 16,
    fontWeight: "700",
    color: "#1d4031",
    marginTop: 2,
  },
  input: {
    borderWidth: 1,
    borderColor: "#b8c9bf",
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  selector: {
    minHeight: 50,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  selectorText: {
    fontSize: 16,
  },
  selectorArrow: {
    fontSize: 18,
    color: "#6d7f74",
  },
  optionsList: {
    borderWidth: 1,
    borderColor: "#b8c9bf",
    borderRadius: 12,
    backgroundColor: "#f7faf8",
    overflow: "hidden",
  },
  optionItem: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#e3ece7",
  },
  optionText: {
    color: "#234539",
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
