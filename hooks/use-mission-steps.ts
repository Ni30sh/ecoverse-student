import { supabaseQueries } from "@/integrations/supabase/queries";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "./use-auth";

export interface SubmitStepInput {
  missionSubmissionId: string;
  stepId: string;
  checkpointData: any;
  stepNumber?: number;
}

export interface MissionStepData {
  id: string;
  mission_id: string;
  step_number: number;
  title: string;
  description?: string;
  instructions?: string;
  checkpoint_type?: string;
  required_proof?: boolean;
  created_at?: string;
}

export interface StepSubmissionData {
  id: string;
  mission_submission_id: string;
  step_id: string;
  status: "pending" | "in_progress" | "submitted" | "verified" | "rejected";
  checkpoint_data?: any;
  submitted_at?: string;
  verified_at?: string;
  rejection_reason?: string;
}

export interface UseMissionStepsReturn {
  steps: MissionStepData[];
  stepSubmissions: StepSubmissionData[];
  submitStep: any; // Mutation result
  isLoading: boolean;
  error: Error | null;
  isSubmitting: boolean;
  getStepById: (stepId: string) => MissionStepData | undefined;
  getStepSubmission: (stepId: string) => StepSubmissionData | undefined;
  getStepStatus: (stepId: string) => string | null;
}

/**
 * Hook to manage mission steps and their submissions for a student.
 * Handles step navigation, submission tracking, and real-time progress.
 * Optimized for mobile/Expo environments with Supabase integration.
 */
export function useMissionSteps(
  missionId: string,
  missionSubmissionId?: string,
): UseMissionStepsReturn {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // Validate inputs
  const isEnabled = !!user && !!missionId;

  // Fetch user's mission submission if not provided
  const userSubmissionQuery = useQuery({
    queryKey: ["mission-submission-by-mission", user?.id, missionId],
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

        const submission = submissions.find(
          (s: any) => s?.mission_id === missionId,
        );
        return submission || null;
      } catch (error) {
        console.error(
          "[useMissionSteps] Failed to fetch user submission:",
          error,
        );
        throw error;
      }
    },
    enabled: isEnabled && !missionSubmissionId,
    staleTime: 30 * 1000, // 30 seconds
    gcTime: 5 * 60 * 1000, // 5 minutes
    retry: 2,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000),
  });

  // Determine effective submission ID
  const effectiveSubmissionId =
    missionSubmissionId || userSubmissionQuery.data?.id;

  // Fetch mission steps
  const stepsQuery = useQuery({
    queryKey: ["mission-steps", missionId],
    queryFn: async () => {
      if (!missionId) {
        return [];
      }

      try {
        const steps =
          await supabaseQueries.missionSteps.getByMissionId(missionId);
        return steps && Array.isArray(steps)
          ? steps.sort((a, b) => (a?.step_number || 0) - (b?.step_number || 0))
          : [];
      } catch (error) {
        console.error("[useMissionSteps] Failed to fetch steps:", error);
        return [];
      }
    },
    enabled: !!missionId,
    staleTime: 60 * 1000, // 60 seconds (steps are static)
    gcTime: 10 * 60 * 1000, // 10 minutes
    retry: 2,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000),
  });

  // Fetch step submissions
  const stepSubmissionsQuery = useQuery({
    queryKey: ["mission-step-submissions", effectiveSubmissionId],
    queryFn: async () => {
      if (!effectiveSubmissionId) {
        return [];
      }

      try {
        const submissions =
          await supabaseQueries.missionStepSubmissions.getByMissionSubmission(
            effectiveSubmissionId as string,
          );
        return submissions && Array.isArray(submissions) ? submissions : [];
      } catch (error) {
        console.error(
          "[useMissionSteps] Failed to fetch step submissions:",
          error,
        );
        return [];
      }
    },
    enabled: !!effectiveSubmissionId,
    staleTime: 20 * 1000, // 20 seconds (active progress)
    gcTime: 5 * 60 * 1000, // 5 minutes
    retry: 2,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 10000),
  });

  // Submit step with comprehensive error handling
  const submitStepMutation = useMutation({
    mutationFn: async (input: SubmitStepInput) => {
      if (!input.missionSubmissionId || !input.stepId) {
        throw new Error(
          "Missing required fields: missionSubmissionId or stepId",
        );
      }

      try {
        const result = await supabaseQueries.missionStepSubmissions.submitStep(
          input.missionSubmissionId,
          input.stepId,
          input.checkpointData,
        );

        if (result?.error) {
          console.error(
            "[useMissionSteps] Step submission error:",
            result.error,
          );
          throw result.error;
        }

        return result;
      } catch (error) {
        console.error("[useMissionSteps] Failed to submit step:", error);
        throw error;
      }
    },
    onSuccess: () => {
      // Invalidate relevant queries to refresh data
      queryClient.invalidateQueries({
        queryKey: ["mission-step-submissions", effectiveSubmissionId],
      });
      queryClient.invalidateQueries({
        queryKey: ["mission-submission-by-mission", user?.id, missionId],
      });
      queryClient.invalidateQueries({
        queryKey: ["mission-submission", user?.id, missionId],
      });
      queryClient.invalidateQueries({
        queryKey: ["activity", user?.id],
      });
    },
    onError: (error) => {
      console.error("[useMissionSteps] Submit step mutation error:", error);
    },
  });

  // Get step by ID
  const getStepById = (stepId: string): MissionStepData | undefined => {
    if (!stepId) return undefined;
    return stepsQuery.data?.find((s) => s?.id === stepId);
  };

  // Get step submission by step ID
  const getStepSubmission = (
    stepId: string,
  ): StepSubmissionData | undefined => {
    if (!stepId) return undefined;
    return stepSubmissionsQuery.data?.find((ss) => ss?.step_id === stepId);
  };

  // Get step status by step ID
  const getStepStatus = (stepId: string): string | null => {
    const submission = getStepSubmission(stepId);
    return submission?.status || null;
  };

  // Collect all errors
  const queryError =
    userSubmissionQuery.error ||
    stepsQuery.error ||
    stepSubmissionsQuery.error ||
    null;

  // Determine loading state
  const isLoading =
    userSubmissionQuery.isFetching ||
    stepsQuery.isFetching ||
    stepSubmissionsQuery.isFetching;
  const isSubmitting = submitStepMutation.isPending;

  return {
    steps: stepsQuery.data || [],
    stepSubmissions: stepSubmissionsQuery.data || [],
    submitStep: submitStepMutation,
    isLoading,
    error: queryError,
    isSubmitting,
    getStepById,
    getStepSubmission,
    getStepStatus,
  };
}

/**
 * Hook to get current step with detailed information
 */
export function useMissionCurrentStep(
  missionId: string,
  missionSubmissionId?: string,
) {
  const { steps, stepSubmissions } = useMissionSteps(
    missionId,
    missionSubmissionId,
  );

  // Find first unverified step
  const completedSteps = stepSubmissions.filter(
    (ss) => ss?.status === "verified",
  );
  const nextStepIndex = completedSteps.length;
  const currentStep = steps[nextStepIndex] || null;
  const previousSteps = steps.slice(0, nextStepIndex);
  const remainingSteps = steps.slice(nextStepIndex + 1);

  return {
    currentStep,
    currentStepNumber: nextStepIndex + 1,
    previousSteps,
    remainingSteps,
    completedCount: completedSteps.length,
    totalCount: steps.length,
  };
}

/**
 * Hook to track step completion status
 */
export function useMissionStepStatus(
  stepId: string,
  missionId: string,
  missionSubmissionId?: string,
) {
  const { getStepStatus, stepSubmissions, isLoading } = useMissionSteps(
    missionId,
    missionSubmissionId,
  );
  const status = getStepStatus(stepId);
  const submission = stepSubmissions.find((ss) => ss?.step_id === stepId);

  return {
    status:
      (status as
        | "pending"
        | "in_progress"
        | "submitted"
        | "verified"
        | "rejected"
        | null) || null,
    submission,
    isVerified: status === "verified",
    isPending: status === "pending",
    isInProgress: status === "in_progress",
    isSubmitted: status === "submitted",
    isRejected: status === "rejected",
    isLoading,
  };
}

/**
 * Hook to get steps by status
 */
export function useMissionStepsByStatus(
  missionId: string,
  status: "pending" | "in_progress" | "submitted" | "verified" | "rejected",
  missionSubmissionId?: string,
) {
  const { steps, stepSubmissions } = useMissionSteps(
    missionId,
    missionSubmissionId,
  );

  const stepsWithStatus = steps
    .map((step) => {
      const submission = stepSubmissions.find((ss) => ss?.step_id === step.id);
      return {
        step,
        submission,
        hasStatus: submission?.status === status,
      };
    })
    .filter((item) => item.hasStatus)
    .map((item) => item.step);

  return stepsWithStatus;
}

/**
 * Hook to get progress metrics for mission steps
 */
export function useMissionStepProgress(
  missionId: string,
  missionSubmissionId?: string,
) {
  const { steps, stepSubmissions } = useMissionSteps(
    missionId,
    missionSubmissionId,
  );

  const verifiedCount = stepSubmissions.filter(
    (ss) => ss?.status === "verified",
  ).length;
  const submittedCount = stepSubmissions.filter(
    (ss) => ss?.status === "submitted",
  ).length;
  const inProgressCount = stepSubmissions.filter(
    (ss) => ss?.status === "in_progress",
  ).length;
  const pendingCount = stepSubmissions.filter(
    (ss) => ss?.status === "pending",
  ).length;
  const rejectedCount = stepSubmissions.filter(
    (ss) => ss?.status === "rejected",
  ).length;

  const totalSteps = steps.length;
  const progressPercentage =
    totalSteps > 0 ? Math.min(100, (verifiedCount / totalSteps) * 100) : 0;
  const isComplete = totalSteps > 0 && verifiedCount === totalSteps;

  return {
    verifiedCount,
    submittedCount,
    inProgressCount,
    pendingCount,
    rejectedCount,
    totalSteps,
    progressPercentage,
    isComplete,
  };
}
