import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider,
} from "@react-navigation/native";
import { QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import "react-native-reanimated";

import { AppErrorBoundary } from "@/components/app-error-boundary";
import { ToastProvider } from "@/components/ui/toast-provider";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { queryClient } from "@/lib/query/query-client";
import { SupabaseDebugOnLaunch } from "@/mobile-debug/SupabaseProjectCheckSnippet";
import { AuthProvider } from "@/providers/auth-provider";
import { AppThemeProvider } from "@/providers/theme-provider";

export const unstable_settings = {
  anchor: "(tabs)",
};

export default function RootLayout() {
  return (
    <AppErrorBoundary>
      <AppThemeProvider>
        <RootLayoutNav />
      </AppThemeProvider>
    </AppErrorBoundary>
  );
}

function RootLayoutNav() {
  const colorScheme = useColorScheme();

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ToastProvider>
          <ThemeProvider
            value={colorScheme === "dark" ? DarkTheme : DefaultTheme}
          >
            <SupabaseDebugOnLaunch />
            <Stack>
              <Stack.Screen name="login" options={{ headerShown: false }} />
              <Stack.Screen name="signup" options={{ headerShown: false }} />
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
              <Stack.Screen
                name="mission/[missionId]"
                options={{ title: "Mission Detail" }}
              />
              <Stack.Screen
                name="lesson/[lessonId]"
                options={{ title: "Lesson Detail" }}
              />
              <Stack.Screen
                name="modal"
                options={{ presentation: "modal", title: "Modal" }}
              />
            </Stack>
            <StatusBar style={colorScheme === "dark" ? "light" : "dark"} />
          </ThemeProvider>
        </ToastProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
