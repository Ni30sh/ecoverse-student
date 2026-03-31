import { supabaseQueries } from "@/integrations/supabase/queries";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "./useAuth";

export interface MissionProgressData {
  submission: any | null;
  steps: any[];
  stepSubmissions: any[];
  completedSteps: number;
  totalSteps: number;
  progressPercentage: number;
  currentStep: number;
  isComplete: boolean;
  isLoading: boolean;
  error: Error | null;
}

/**
 * Hook to track mission step progress for a student.
 * Shows current step, completed steps, and overall progress percentage.
 * Optimized for mobile/Expo with proper error handling, caching, and retry logic.
 */
export function useMissionProgress(missionId: string): MissionProgressData {
  const { user } = useAuth();

  // Validate inputs
  const isEnabled = !!user && !!missionId;

  // Get the user's mission submission
  const submissionQuery = useQuery({
    queryKey: ["mission-submission", user?.id, missionId],
    queryFn: async () => {
      if (!user?.id) {
        return null;
      }

      try {
        const submissions =
          await supabaseQueries.missionSubmissions.getUserSubmissions(user.id);

        if (!submissions || submissions.length === 0) {
          return null;
        }

        const submission = submissions.find((s) => s?.mission_id === missionId);
        return submission || null;
      } catch (error) {
        console.error(
          "[useMissionProgress] Failed to fetch submission:",
          error,
        );
        throw error;
      }
    },
    enabled: isEnabled,
    staleTime: 30 * 1000, // 30 seconds
    gcTime: 5 * 60 * 1000, // 5 minutes
    retry: 2,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000),
  });

  // Get all steps in the mission
  const stepsQuery = useQuery({
    queryKey: ["mission-steps", missionId],
    queryFn: async () => {
      if (!missionId) {
        return [];
      }

      try {
        const steps =
          await supabaseQueries.missionSteps.getByMissionId(missionId);
        return steps && Array.isArray(steps) ? steps : [];
      } catch (error) {
        console.error(
          "[useMissionProgress] Failed to fetch mission steps:",
          error,
        );
        return [];
      }
    },
    enabled: !!missionId,
    staleTime: 60 * 1000, // 60 seconds (steps don't change often)
    gcTime: 10 * 60 * 1000, // 10 minutes
    retry: 2,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000),
  });

  // Get all step submissions for this mission
  const stepSubmissionsQuery = useQuery({
    queryKey: ["step-submissions", submissionQuery.data?.id],
    queryFn: async () => {
      if (!submissionQuery.data?.id) {
        return [];
      }

      try {
        const stepSubmissions =
          await supabaseQueries.missionStepSubmissions.getByMissionSubmission(
            submissionQuery.data.id,
          );
        return stepSubmissions && Array.isArray(stepSubmissions)
          ? stepSubmissions
          : [];
      } catch (error) {
        console.error(
          "[useMissionProgress] Failed to fetch step submissions:",
          error,
        );
        return [];
      }
    },
    enabled: !!submissionQuery.data?.id,
    staleTime: 20 * 1000, // 20 seconds (more frequent updates for active progress)
    gcTime: 5 * 60 * 1000, // 5 minutes
    retry: 2,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000),
  });

  // Calculate progress metrics
  const steps = stepsQuery.data || [];
  const stepSubmissions = stepSubmissionsQuery.data || [];

  // Safe calculation of completed steps
  const completedSteps = Array.isArray(stepSubmissions)
    ? stepSubmissions.filter((ss) => ss && ss.status === "verified").length
    : 0;

  const totalSteps = Array.isArray(steps) ? steps.length : 0;

  // Calculate progress percentage with proper validation
  const progressPercentage =
    totalSteps > 0 ? Math.min(100, (completedSteps / totalSteps) * 100) : 0;

  // Calculate current step (1-indexed)
  const currentStep = Math.min(completedSteps + 1, Math.max(totalSteps, 1));

  // Check completion state
  const isComplete = totalSteps > 0 && completedSteps === totalSteps;

  // Determine loading state
  const isLoading =
    submissionQuery.isFetching ||
    stepsQuery.isFetching ||
    stepSubmissionsQuery.isFetching;

  // Collect errors
  const queryError =
    submissionQuery.error ||
    stepsQuery.error ||
    stepSubmissionsQuery.error ||
    null;

  return {
    submission: submissionQuery.data || null,
    steps,
    stepSubmissions,
    completedSteps,
    totalSteps,
    progressPercentage,
    currentStep,
    isComplete,
    isLoading,
    error: queryError,
  };
}

/**
 * Hook to get just the progress percentage (lightweight)
 */
export function useMissionProgressPercentage(missionId: string): {
  percentage: number;
  isLoading: boolean;
} {
  const { completedSteps, totalSteps, isLoading } =
    useMissionProgress(missionId);
  const percentage =
    totalSteps > 0 ? Math.min(100, (completedSteps / totalSteps) * 100) : 0;

  return { percentage, isLoading };
}

/**
 * Hook to check if a mission is complete
 */
export function useMissionIsComplete(missionId: string): {
  isComplete: boolean;
  isLoading: boolean;
} {
  const { isComplete, isLoading } = useMissionProgress(missionId);
  return { isComplete, isLoading };
}

/**
 * Hook to get current mission step info
 */
export function useMissionCurrentStep(missionId: string): {
  currentStep: number;
  totalSteps: number;
  stepData: any | null;
  isLoading: boolean;
} {
  const { currentStep, totalSteps, steps, isLoading } =
    useMissionProgress(missionId);
  const stepIndex = currentStep - 1;
  const stepData =
    stepIndex >= 0 && stepIndex < steps.length ? steps[stepIndex] : null;

  return { currentStep, totalSteps, stepData, isLoading };
}
