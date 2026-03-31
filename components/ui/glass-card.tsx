import { PropsWithChildren } from "react";
import { StyleProp, StyleSheet, View, ViewStyle } from "react-native";

import { useAppTheme } from "@/providers/theme-provider";

type GlassCardProps = PropsWithChildren<{
  style?: StyleProp<ViewStyle>;
}>;

export function GlassCard({ children, style }: GlassCardProps) {
  const { resolvedScheme } = useAppTheme();
  const isDark = resolvedScheme === "dark";

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: isDark
            ? "rgba(30,41,59,0.68)"
            : "rgba(255,255,255,0.72)",
          borderColor: isDark
            ? "rgba(148,163,184,0.22)"
            : "rgba(255,255,255,0.92)",
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 22,
    borderWidth: 1,
    padding: 16,
    shadowColor: "#0f172a",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.12,
    shadowRadius: 18,
    elevation: 6,
  },
});
