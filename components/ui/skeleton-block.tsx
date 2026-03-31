import { useEffect } from "react";
import { StyleProp, StyleSheet, View, ViewStyle } from "react-native";
import Animated, {
    cancelAnimation,
    Easing,
    interpolate,
    useAnimatedStyle,
    useSharedValue,
    withRepeat,
    withTiming,
} from "react-native-reanimated";

type SkeletonBlockProps = {
  width?: number | `${number}%`;
  height?: number;
  style?: StyleProp<ViewStyle>;
};

export function SkeletonBlock({
  width = "100%",
  height = 16,
  style,
}: SkeletonBlockProps) {
  const phase = useSharedValue(0);

  useEffect(() => {
    phase.value = withRepeat(
      withTiming(1, {
        duration: 1000,
        easing: Easing.inOut(Easing.ease),
      }),
      -1,
      true,
    );

    return () => {
      cancelAnimation(phase);
    };
  }, [phase]);

  const animatedStyle = useAnimatedStyle(() => {
    return {
      opacity: interpolate(phase.value, [0, 1], [0.45, 1]),
    };
  });

  return (
    <View style={[{ width, height }, style]}>
      <Animated.View style={[styles.block, animatedStyle]} />
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    flex: 1,
    borderRadius: 10,
    backgroundColor: "#dbe4dd",
  },
});
