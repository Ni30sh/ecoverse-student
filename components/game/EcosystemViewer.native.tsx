import { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import Svg, {
    Circle,
    Defs,
    Ellipse,
    LinearGradient,
    Path,
    Rect,
    Stop,
} from "react-native-svg";

type EcosystemViewerProps = {
  ecoPoints: number;
  className?: string;
  darkWrapper?: boolean;
};

function getState(ecoPoints: number): number {
  if (ecoPoints >= 10000) return 6;
  if (ecoPoints >= 2500) return 5;
  if (ecoPoints >= 1200) return 4;
  if (ecoPoints >= 600) return 3;
  if (ecoPoints >= 200) return 2;
  return 1;
}

function skyStops(state: number) {
  switch (state) {
    case 1:
      return ["#C4956A", "#D4A574", "#B8C4CE"];
    case 2:
      return ["#D4A574", "#B8D4E3", "#E8D5A0"];
    case 3:
      return ["#87CEEB", "#B0E0F0", "#87CEEB"];
    case 4:
      return ["#7EC8E3", "#A0D8EF", "#7EC8E3"];
    case 5:
      return ["#6BBFE0", "#8ED0E8", "#6BBFE0"];
    default:
      return ["#1B2A4A", "#2D4A6A", "#1B3A5A"];
  }
}

export default function EcosystemViewer({
  ecoPoints,
  darkWrapper = false,
}: EcosystemViewerProps) {
  const state = getState(ecoPoints);
  const [top, mid, bottom] = useMemo(() => skyStops(state), [state]);

  const groundColor =
    state === 1 ? "#5C4033" : state === 2 ? "#4A3728" : "#2D6A4F";
  const canopyColor =
    state <= 2
      ? "#95D5B2"
      : state <= 4
        ? "#52B788"
        : state <= 5
          ? "#40916C"
          : "#2D6A4F";

  const treeScale =
    state === 1
      ? 0.35
      : state === 2
        ? 0.5
        : state === 3
          ? 0.7
          : state === 4
            ? 0.9
            : 1;

  return (
    <View style={[styles.wrapper, darkWrapper ? styles.darkWrap : null]}>
      <Svg viewBox="0 0 800 450" width="100%" height={220}>
        <Defs>
          <LinearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0%" stopColor={top} />
            <Stop offset="50%" stopColor={mid} />
            <Stop offset="100%" stopColor={bottom} />
          </LinearGradient>
        </Defs>

        <Rect x={0} y={0} width={800} height={450} fill="url(#sky)" />

        {state > 1 ? (
          <Circle cx={650} cy={80} r={32} fill="#F4A261" opacity={0.85} />
        ) : null}

        <Path
          d="M0,370 Q200,360 400,368 Q600,376 800,365 L800,450 L0,450 Z"
          fill={groundColor}
        />

        {state >= 2 ? (
          <Path
            d="M0,368 Q200,358 400,366 Q600,374 800,363 L800,372 Q600,378 400,370 Q200,362 0,370 Z"
            fill="#52B788"
            opacity={0.5}
          />
        ) : null}

        {state >= 3 ? (
          <Path
            d="M0,395 Q200,388 400,393 Q600,398 800,390"
            stroke="#48CAE4"
            strokeWidth={state >= 4 ? 12 : 6}
            fill="none"
            opacity={0.5}
            strokeLinecap="round"
          />
        ) : null}

        <Rect
          x={398 - 10 * treeScale}
          y={370 - 70 * treeScale}
          width={20 * treeScale}
          height={70 * treeScale}
          rx={6 * treeScale}
          fill="#6B4226"
        />

        <Ellipse
          cx={400}
          cy={295}
          rx={60 * treeScale}
          ry={52 * treeScale}
          fill={canopyColor}
        />
        <Ellipse
          cx={360}
          cy={310}
          rx={36 * treeScale}
          ry={30 * treeScale}
          fill="#74C69D"
          opacity={0.8}
        />
        <Ellipse
          cx={440}
          cy={310}
          rx={34 * treeScale}
          ry={28 * treeScale}
          fill="#74C69D"
          opacity={0.8}
        />

        {state >= 5 ? (
          <Circle cx={220} cy={325} r={24} fill="#40916C" opacity={0.9} />
        ) : null}
        {state >= 5 ? (
          <Circle cx={580} cy={322} r={26} fill="#40916C" opacity={0.9} />
        ) : null}

        {state >= 6 ? (
          <Circle cx={140} cy={70} r={1.6} fill="#FFFFFF" opacity={0.8} />
        ) : null}
        {state >= 6 ? (
          <Circle cx={260} cy={52} r={1.4} fill="#FFFFFF" opacity={0.7} />
        ) : null}
        {state >= 6 ? (
          <Circle cx={470} cy={28} r={1.5} fill="#FFFFFF" opacity={0.8} />
        ) : null}
        {state >= 6 ? (
          <Circle cx={700} cy={44} r={1.3} fill="#FFFFFF" opacity={0.75} />
        ) : null}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    width: "100%",
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: "#F8FAFC",
  },
  darkWrap: {
    backgroundColor: "#111827",
  },
});
