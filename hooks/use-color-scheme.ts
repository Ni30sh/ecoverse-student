import { useAppTheme } from "@/providers/theme-provider";

export function useColorScheme() {
  const { resolvedScheme } = useAppTheme();
  return resolvedScheme;
}
