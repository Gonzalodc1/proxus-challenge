import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import { FeedbackRecord, SubmitFeedbackRequest } from "../schemas/feedback.ts";

export class FeedbackApi extends HttpApiGroup.make("feedback")
  .add(HttpApiEndpoint.post("submit", "/", {
    payload: SubmitFeedbackRequest,
    success: FeedbackRecord
  }))
  .prefix("/feedback")
{}
