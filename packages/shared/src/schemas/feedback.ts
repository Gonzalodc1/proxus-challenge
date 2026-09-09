import { Schema } from "effect";

export const FeedbackRating = Schema.Union([
  Schema.Literal("up"),
  Schema.Literal("down")
]);
export type FeedbackRating = typeof FeedbackRating.Type;

/**
 * Feedback is attached to a *trace*, not just to a message.
 *
 * That link is the whole point: a thumbs-down on its own only says "this was
 * bad". A thumbs-down joined to the run's trace says whether that answer came
 * from a run whose step budget ran out, whose tool calls failed, or which never
 * opened the material it was asked about. Bad answers can then be split into
 * "the scaffolding got in the way" and "the model actually got it wrong",
 * which are fixed in completely different places.
 */
export const SubmitFeedbackRequest = Schema.Struct({
  traceId: Schema.optional(Schema.String),
  rating: FeedbackRating,
  comment: Schema.optional(Schema.String),
  /** Short excerpt of the rated answer, so stored feedback is readable on its own. */
  excerpt: Schema.optional(Schema.String)
});
export type SubmitFeedbackRequest = typeof SubmitFeedbackRequest.Type;

export const FeedbackRecord = Schema.Struct({
  id: Schema.String,
  traceId: Schema.optional(Schema.String),
  rating: FeedbackRating,
  comment: Schema.optional(Schema.String),
  excerpt: Schema.optional(Schema.String),
  createdAt: Schema.String
});
export type FeedbackRecord = typeof FeedbackRecord.Type;
