import * as Haptics from "expo-haptics";
import {
    PropsWithChildren,
    createContext,
    useContext,
    useMemo,
    useState,
} from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, {
    FadeInDown,
    FadeOutUp,
    Layout,
} from "react-native-reanimated";

type ToastType = "success" | "error" | "info";

type ToastItem = {
  id: string;
  message: string;
  type: ToastType;
};

type ToastContextValue = {
  showToast: (message: string, type?: ToastType) => void;
};

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

export function ToastProvider({ children }: PropsWithChildren) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const showToast = (message: string, type: ToastType = "info") => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    if (type === "success") {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }

    if (type === "error") {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }

    setToasts((prev) => [...prev, { id, message, type }]);

    setTimeout(() => {
      setToasts((prev) => prev.filter((item) => item.id !== id));
    }, 2400);
  };

  const value = useMemo<ToastContextValue>(
    () => ({
      showToast,
    }),
    [],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <View pointerEvents="none" style={styles.container}>
        {toasts.map((toast) => (
          <Animated.View
            key={toast.id}
            entering={FadeInDown.duration(250)}
            exiting={FadeOutUp.duration(200)}
            layout={Layout.springify().damping(14)}
            style={[
              styles.toast,
              toast.type === "success" ? styles.success : null,
              toast.type === "error" ? styles.error : null,
              toast.type === "info" ? styles.info : null,
            ]}
          >
            <Text style={styles.text}>{toast.message}</Text>
          </Animated.View>
        ))}
      </View>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);

  if (!context) {
    throw new Error("useToast must be used inside ToastProvider");
  }

  return context;
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 22,
    gap: 10,
  },
  toast: {
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    shadowColor: "#0f172a",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 5,
  },
  success: {
    backgroundColor: "#166534",
  },
  error: {
    backgroundColor: "#b91c1c",
  },
  info: {
    backgroundColor: "#0f766e",
  },
  text: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "700",
  },
});
