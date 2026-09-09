import type { FeedbackRating, SubmitFeedbackRequest } from "@proxus/shared";
import { apiClientConfig } from "../../api-client/config.ts";

/**
 * Sends a rating for one tutor answer.
 *
 * `traceId` is what makes the rating worth storing: it joins the student's
 * judgement to the run that produced the answer, so a thumbs-down can later be
 * split into "the scaffolding failed" and "the model was wrong".
 */
export const submitFeedback = async (input: {
  readonly traceId: string | undefined;
  readonly rating: FeedbackRating;
  readonly excerpt: string;
}): Promise<void> => {
  const payload: SubmitFeedbackRequest = {
    rating: input.rating,
    ...(input.traceId === undefined ? {} : { traceId: input.traceId }),
    excerpt: input.excerpt.slice(0, 500)
  };

  const response = await fetch(`${apiClientConfig.apiUrl}/api/feedback`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }
};
