import {
    Feather,
    FontAwesome5,
    MaterialCommunityIcons,
} from "@expo/vector-icons";
import { ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
    Easing,
    FadeInDown,
    useAnimatedStyle,
    useSharedValue,
    withRepeat,
    withSpring,
    withTiming,
} from "react-native-reanimated";
import Svg, { Circle } from "react-native-svg";

type Badge = {
  name: string;
  icon: string;
  description: string;
  earned?: boolean;
};

type BadgeSize = "sm" | "default" | "lg";

const COLOR = {
  card: "#FFFFFF",
  cardMuted: "rgba(148,163,184,0.12)",
  border: "#D1D5DB",
  text: "#0F172A",
  muted: "#64748B",
  eco: "#22C55E",
  ecoDark: "#166534",
  gold: "#F59E0B",
  lock: "#94A3B8",
};

function getSizeToken(size: BadgeSize) {
  if (size === "sm") {
    return {
      fontSize: 14,
      icon: 14,
      px: 10,
      py: 5,
      gap: 6,
    };
  }

  if (size === "lg") {
    return {
      fontSize: 28,
      icon: 24,
      px: 20,
      py: 10,
      gap: 10,
    };
  }

  return {
    fontSize: 20,
    icon: 18,
    px: 14,
    py: 7,
    gap: 8,
  };
}

function resolveBorderColor(borderColor?: string) {
  if (!borderColor) {
    return COLOR.eco;
  }

  // Accept either direct hex/rgb color or legacy web class tokens.
  if (borderColor.startsWith("#") || borderColor.startsWith("rgb")) {
    return borderColor;
  }

  if (borderColor.includes("jungle-bright")) {
    return COLOR.eco;
  }

  if (borderColor.includes("sun-gold")) {
    return COLOR.gold;
  }

  return COLOR.eco;
}

export function EcoPointsBadge({
  points,
  size = "default",
}: {
  points: number;
  size?: BadgeSize;
}) {
  const [display, setDisplay] = useState(0);
  const displayRef = useRef(0);
  const rafIdRef = useRef<number | null>(null);
  const pressScale = useSharedValue(1);

  const token = getSizeToken(size);

  useEffect(() => {
    const start = displayRef.current;
    const safePoints = Number.isFinite(points) ? points : 0;
    const diff = safePoints - start;

    if (diff === 0) {
      return;
    }

    const duration = 1000;
    const startTime = performance.now();

    const animate = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const nextValue = Math.round(start + diff * progress);
      displayRef.current = nextValue;
      setDisplay(nextValue);

      if (progress < 1) {
        rafIdRef.current = requestAnimationFrame(animate);
      }
    };

    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
    }

    rafIdRef.current = requestAnimationFrame(animate);

    return () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }
    };
  }, [points]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pressScale.value }],
  }));

  return (
    <Pressable
      onPressIn={() => {
        pressScale.value = withSpring(0.97, { damping: 15, stiffness: 250 });
      }}
      onPressOut={() => {
        pressScale.value = withSpring(1, { damping: 15, stiffness: 250 });
      }}
    >
      <Animated.View
        style={[
          styles.ecoBadge,
          {
            paddingHorizontal: token.px,
            paddingVertical: token.py,
          },
          animatedStyle,
        ]}
      >
        <MaterialCommunityIcons
          name="leaf"
          size={token.icon}
          color={COLOR.eco}
        />
        <Text style={[styles.ecoBadgeText, { fontSize: token.fontSize }]}>
          {display.toLocaleString()}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

export function StreakFlame({ days }: { days: number }) {
  const pulse = useSharedValue(1);

  useEffect(() => {
    pulse.value = withRepeat(
      withTiming(1.15, {
        duration: 700,
        easing: Easing.inOut(Easing.ease),
      }),
      -1,
      true,
    );
  }, [pulse]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulse.value }],
  }));

  return (
    <View style={styles.inlineRow}>
      <Animated.View style={animatedStyle}>
        <MaterialCommunityIcons name="fire" size={20} color={COLOR.gold} />
      </Animated.View>
      <Text style={styles.streakText}>{days}</Text>
    </View>
  );
}

export function LevelBadge({ level, title }: { level: number; title: string }) {
  return (
    <View style={styles.levelBadge}>
      <Feather name="star" size={16} color={COLOR.eco} />
      <Text style={styles.levelText}>Lv.{level}</Text>
      <Text style={styles.levelTitle}>{title}</Text>
    </View>
  );
}

export function RankBadge({ rank }: { rank: number }) {
  return (
    <View style={styles.inlineRow}>
      <FontAwesome5 name="trophy" size={14} color={COLOR.gold} />
      <Text style={styles.rankText}>#{rank}</Text>
    </View>
  );
}

export function ProgressRing({
  progress,
  size = 60,
  strokeWidth = 4,
  children,
}: {
  progress: number;
  size?: number;
  strokeWidth?: number;
  children?: ReactNode;
}) {
  const clampedProgress = Math.max(
    0,
    Math.min(1, Number.isFinite(progress) ? progress : 0),
  );
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const [animatedProgress, setAnimatedProgress] = useState(clampedProgress);
  const ringRafRef = useRef<number | null>(null);

  useEffect(() => {
    const start = animatedProgress;
    const diff = clampedProgress - start;

    if (Math.abs(diff) < 0.001) {
      return;
    }

    const duration = 1000;
    const startTime = performance.now();

    const animate = (now: number) => {
      const elapsed = now - startTime;
      const t = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      const next = start + diff * eased;
      setAnimatedProgress(next);

      if (t < 1) {
        ringRafRef.current = requestAnimationFrame(animate);
      }
    };

    if (ringRafRef.current !== null) {
      cancelAnimationFrame(ringRafRef.current);
    }

    ringRafRef.current = requestAnimationFrame(animate);

    return () => {
      if (ringRafRef.current !== null) {
        cancelAnimationFrame(ringRafRef.current);
      }
    };
  }, [clampedProgress, animatedProgress]);

  return (
    <View
      style={{
        width: size,
        height: size,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <Svg
        width={size}
        height={size}
        style={{ transform: [{ rotate: "-90deg" }] }}
      >
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={COLOR.border}
          strokeWidth={strokeWidth}
          fill="none"
        />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={COLOR.eco}
          strokeWidth={strokeWidth}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference - animatedProgress * circumference}
        />
      </Svg>
      {children ? <View style={styles.progressCenter}>{children}</View> : null}
    </View>
  );
}

export function StatCard({
  icon,
  label,
  value,
  borderColor,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
  borderColor?: string;
}) {
  const pressScale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pressScale.value }],
  }));

  const resolvedBorderColor = useMemo(
    () => resolveBorderColor(borderColor),
    [borderColor],
  );

  return (
    <Pressable
      onPressIn={() => {
        pressScale.value = withSpring(0.97, { damping: 15, stiffness: 240 });
      }}
      onPressOut={() => {
        pressScale.value = withSpring(1, { damping: 15, stiffness: 240 });
      }}
    >
      <Animated.View
        entering={FadeInDown.duration(200)}
        style={[
          styles.statCard,
          { borderLeftColor: resolvedBorderColor },
          animatedStyle,
        ]}
      >
        <View style={styles.statRow}>
          <View>{icon}</View>
          <View>
            <Text style={styles.statLabel}>{label}</Text>
            <Text style={styles.statValue}>{value}</Text>
          </View>
        </View>
      </Animated.View>
    </Pressable>
  );
}

export function BadgeCard({ badge }: { badge: Badge }) {
  const pressScale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pressScale.value }],
  }));

  const earned = Boolean(badge.earned);

  return (
    <Pressable
      disabled={!earned}
      onPressIn={() => {
        if (earned) {
          pressScale.value = withSpring(0.97, { damping: 15, stiffness: 240 });
        }
      }}
      onPressOut={() => {
        if (earned) {
          pressScale.value = withSpring(1, { damping: 15, stiffness: 240 });
        }
      }}
    >
      <Animated.View
        style={[
          styles.badgeCard,
          earned ? styles.badgeCardEarned : styles.badgeCardLocked,
          animatedStyle,
        ]}
      >
        <View style={styles.badgeIconWrap}>
          <Text style={styles.badgeIcon}>{badge.icon}</Text>
          {!earned ? (
            <View style={styles.badgeLockWrap}>
              <Feather name="lock" size={12} color={COLOR.lock} />
            </View>
          ) : null}
        </View>

        <Text style={styles.badgeName}>{badge.name}</Text>
        <Text style={styles.badgeDescription}>{badge.description}</Text>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  ecoBadge: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 999,
    backgroundColor: "rgba(34,197,94,0.12)",
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 4,
    gap: 8,
  },
  ecoBadgeText: {
    fontWeight: "800",
    color: COLOR.ecoDark,
  },
  inlineRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  streakText: {
    fontSize: 18,
    fontWeight: "800",
    color: COLOR.gold,
  },
  levelBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(34,197,94,0.35)",
    backgroundColor: "rgba(34,197,94,0.12)",
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  levelText: {
    fontSize: 13,
    fontWeight: "800",
    color: COLOR.text,
  },
  levelTitle: {
    fontSize: 13,
    color: COLOR.muted,
  },
  rankText: {
    fontSize: 16,
    fontWeight: "800",
    color: COLOR.gold,
  },
  progressCenter: {
    position: "absolute",
    inset: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  statCard: {
    borderRadius: 16,
    backgroundColor: COLOR.card,
    borderLeftWidth: 4,
    padding: 16,
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 5,
  },
  statRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  statLabel: {
    fontSize: 13,
    color: COLOR.muted,
    fontWeight: "600",
  },
  statValue: {
    fontSize: 20,
    fontWeight: "800",
    color: COLOR.text,
  },
  badgeCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    alignItems: "center",
    gap: 8,
  },
  badgeCardEarned: {
    backgroundColor: COLOR.card,
    borderColor: "rgba(34,197,94,0.35)",
  },
  badgeCardLocked: {
    backgroundColor: COLOR.cardMuted,
    borderColor: COLOR.border,
    opacity: 0.6,
  },
  badgeIconWrap: {
    position: "relative",
  },
  badgeIcon: {
    fontSize: 30,
  },
  badgeLockWrap: {
    position: "absolute",
    right: -5,
    bottom: -5,
  },
  badgeName: {
    fontSize: 14,
    fontWeight: "800",
    color: COLOR.text,
    textAlign: "center",
  },
  badgeDescription: {
    fontSize: 12,
    color: COLOR.muted,
    textAlign: "center",
  },
});
