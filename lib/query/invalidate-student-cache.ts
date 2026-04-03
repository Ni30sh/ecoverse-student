import { QueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/lib/query/query-keys";

export async function invalidateStudentCache(
  queryClient: QueryClient,
  userId: string,
) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.profile(userId) }),
    queryClient.invalidateQueries({ queryKey: queryKeys.missions() }),
    queryClient.invalidateQueries({ queryKey: ["dashboard-missions"] }),
    queryClient.invalidateQueries({ queryKey: queryKeys.submissions(userId) }),
    queryClient.invalidateQueries({ queryKey: ["activity", userId] }),
    queryClient.invalidateQueries({ queryKey: queryKeys.leaderboard() }),
    queryClient.invalidateQueries({ queryKey: ["rank", userId] }),
    queryClient.invalidateQueries({ queryKey: queryKeys.dailyPoints(userId) }),
    queryClient.invalidateQueries({ queryKey: ["weekly-points", userId] }),
    queryClient.invalidateQueries({
      queryKey: queryKeys.notifications(userId),
    }),
  ]);
}
