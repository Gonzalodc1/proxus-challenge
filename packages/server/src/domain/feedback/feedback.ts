import { Context, Data, Effect } from "effect";
import type { FeedbackRating, FeedbackRecord } from "@proxus/shared";

export interface SubmitFeedbackInput {
  readonly traceId?: string | undefined;
  readonly rating: FeedbackRating;
  readonly comment?: string | undefined;
  readonly excerpt?: string | undefined;
}

export class FeedbackRepositoryStorageError extends Data.TaggedError("FeedbackRepositoryStorageError")<{
  readonly reason: unknown;
}> { }

export interface FeedbackRepository {
  readonly submit: (
    input: SubmitFeedbackInput
  ) => Effect.Effect<FeedbackRecord, FeedbackRepositoryStorageError>;
  readonly list: (
    limit?: number
  ) => Effect.Effect<readonly FeedbackRecord[], FeedbackRepositoryStorageError>;
}

export const FeedbackRepository = Context.Service<FeedbackRepository>(
  "@proxus/server/feedback/FeedbackRepository"
);
