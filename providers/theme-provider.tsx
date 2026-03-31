import AsyncStorage from "@react-native-async-storage/async-storage";
import {
    PropsWithChildren,
    createContext,
    useContext,
    useEffect,
    useMemo,
    useState,
} from "react";
import { useColorScheme as useNativeColorScheme } from "react-native";

type ThemeMode = "system" | "light" | "dark";

type ThemeContextValue = {
  themeMode: ThemeMode;
  resolvedScheme: "light" | "dark";
  setThemeMode: (mode: ThemeMode) => Promise<void>;
};

const THEME_STORAGE_KEY = "ecoverse_theme_mode";

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function AppThemeProvider({ children }: PropsWithChildren) {
  const nativeScheme = useNativeColorScheme();
  const [themeMode, setThemeModeState] = useState<ThemeMode>("system");
  const [bootstrapped, setBootstrapped] = useState(false);

  useEffect(() => {
    let mounted = true;

    const loadThemeMode = async () => {
      try {
        const stored = await AsyncStorage.getItem(THEME_STORAGE_KEY);
        if (!mounted) {
          return;
        }

        if (stored === "light" || stored === "dark" || stored === "system") {
          setThemeModeState(stored);
        }
      } finally {
        if (mounted) {
          setBootstrapped(true);
        }
      }
    };

    void loadThemeMode();

    return () => {
      mounted = false;
    };
  }, []);

  const resolvedScheme: "light" | "dark" =
    themeMode === "system"
      ? nativeScheme === "dark"
        ? "dark"
        : "light"
      : themeMode;

  const setThemeMode = async (mode: ThemeMode) => {
    setThemeModeState(mode);
    await AsyncStorage.setItem(THEME_STORAGE_KEY, mode);
  };

  const value = useMemo<ThemeContextValue>(
    () => ({
      themeMode,
      resolvedScheme,
      setThemeMode,
    }),
    [themeMode, resolvedScheme],
  );

  if (!bootstrapped) {
    return null;
  }

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useAppTheme() {
  const context = useContext(ThemeContext);

  if (!context) {
    throw new Error("useAppTheme must be used inside AppThemeProvider");
  }

  return context;
}
