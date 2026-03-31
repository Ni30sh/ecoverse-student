import { Component, ErrorInfo, PropsWithChildren, ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { logTelemetry } from "@/lib/utils/telemetry";

type State = {
  hasError: boolean;
  message: string;
};

export class AppErrorBoundary extends Component<PropsWithChildren, State> {
  public state: State = {
    hasError: false,
    message: "",
  };

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      message: error.message || "Unknown runtime error",
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    logTelemetry("error", "app_runtime_error_boundary", error.message, {
      stack: errorInfo.componentStack,
    });
  }

  private handleRetry = () => {
    this.setState({ hasError: false, message: "" });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <View style={styles.container}>
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.message}>{this.state.message}</Text>
          <Text style={styles.hint}>
            This screen replaces the blank page and shows the runtime error.
          </Text>
          <Pressable onPress={this.handleRetry} style={styles.button}>
            <Text style={styles.buttonText}>Try Again</Text>
          </Pressable>
        </View>
      );
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    gap: 10,
    backgroundColor: "#f9fbfc",
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    color: "#11181C",
  },
  message: {
    fontSize: 14,
    color: "#b00020",
    textAlign: "center",
  },
  hint: {
    fontSize: 13,
    color: "#51626d",
    textAlign: "center",
  },
  button: {
    marginTop: 6,
    minHeight: 44,
    minWidth: 130,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0a7ea4",
    paddingHorizontal: 14,
  },
  buttonText: {
    color: "#ffffff",
    fontWeight: "700",
  },
});
