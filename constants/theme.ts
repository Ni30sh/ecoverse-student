/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import { Platform } from "react-native";

const tintColorLight = "#22C55E";
const tintColorDark = "#4ADE80";

export const Colors = {
  light: {
    text: "#0F172A",
    background: "#F6F8F7",
    surface: "#FFFFFF",
    muted: "#64748B",
    primary: "#22C55E",
    primaryStart: "#16A34A",
    primaryEnd: "#4ADE80",
    accent: "#38BDF8",
    tint: tintColorLight,
    icon: "#64748B",
    tabIconDefault: "#94A3B8",
    tabIconSelected: tintColorLight,
  },
  dark: {
    text: "#E2E8F0",
    background: "#0F172A",
    surface: "#1E293B",
    muted: "#94A3B8",
    primary: "#22C55E",
    primaryStart: "#16A34A",
    primaryEnd: "#4ADE80",
    accent: "#38BDF8",
    tint: tintColorDark,
    icon: "#94A3B8",
    tabIconDefault: "#64748B",
    tabIconSelected: tintColorDark,
  },
};

export const Spacing = {
  screen: 18,
  card: 16,
  gap: 14,
};

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: "system-ui",
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: "ui-serif",
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: "ui-rounded",
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: "ui-monospace",
  },
  default: {
    sans: "normal",
    serif: "serif",
    rounded: "normal",
    mono: "monospace",
  },
  web: {
    sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    rounded:
      "'SF Pro Rounded', 'Hiragino Maru Gothic ProN', Meiryo, 'MS PGothic', sans-serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },
});
