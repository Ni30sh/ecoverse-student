export const queryKeys = {
  profile: (userId: string) => ["profile", userId] as const,
  missions: () => ["missions"] as const,
  submissions: (userId: string) => ["submissions", userId] as const,
  leaderboard: () => ["leaderboard"] as const,
  dailyPoints: (userId: string) => ["daily_points", userId] as const,
  notifications: (userId: string) => ["notifications", userId] as const,
  missionDetail: (missionId: string, userId: string) =>
    ["mission_detail", missionId, userId] as const,
  lessonDetail: (lessonId: string, userId: string) =>
    ["lesson_detail", lessonId, userId] as const,
};
