import { Effect, Layer } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { ProxusApi } from "@proxus/shared";
import { TutorChatService } from "../../domain/agents/academic-tutor/tutor-chat-service.ts";
import { ArtifactRepository, type Artifact } from "../../domain/artifacts/artifact.ts";
import { MaterialRepository } from "../../domain/materials/material.ts";
import { FeedbackRepository } from "../../domain/feedback/feedback.ts";
import { DEFAULT_STUDENT_ID, ProfileRepository } from "../../domain/student/profile.ts";
import { notesFromAttempt } from "../../domain/student/learning-signals.ts";

export const TutorHttpHandlers = HttpApiBuilder.group(
  ProxusApi,
  "tutor",
  Effect.fn(function* (handlers) {
    const tutor = yield* TutorChatService;

    return handlers.handle("chat", ({ payload }) =>
      tutor.sendMessage(payload).pipe(Effect.orDie)
    );
  })
);

export const MaterialsHttpHandlers = HttpApiBuilder.group(
  ProxusApi,
  "materials",
  Effect.fn(function* (handlers) {
    const materials = yield* MaterialRepository;

    return handlers
      .handle("list", () => materials.list().pipe(
        Effect.map((items) => ({ materials: items })),
        Effect.orDie
      ))
      .handle("get", ({ params }) => materials.get(params.id).pipe(Effect.orDie));
  })
);

const artifactSummary = (artifact: Artifact) => ({
  id: artifact.id,
  kind: artifact.kind,
  title: artifact.title
});

export const ArtifactsHttpHandlers = HttpApiBuilder.group(
  ProxusApi,
  "artifacts",
  Effect.fn(function* (handlers) {
    const artifacts = yield* ArtifactRepository;
    const profiles = yield* ProfileRepository;

    return handlers
      .handle("list", ({ query }) => artifacts.listArtifacts({ kind: query.kind }).pipe(
        Effect.map((items) => ({ artifacts: items.map(artifactSummary) })),
        Effect.orDie
      ))
      .handle("get", ({ params }) => artifacts.getArtifact(params.id).pipe(Effect.orDie))
      .handle("submit", ({ params, payload }) => Effect.gen(function* () {
        const attempt = yield* artifacts.submitAttempt({ ...payload, artifactId: params.id });
        const graded = yield* artifacts.gradeAttempt(attempt.id);
        const artifact = yield* artifacts.getArtifact(graded.artifactId);

        // What the student got wrong is already known here, deterministically.
        // Recording it as memory is what turns a score into something the tutor
        // still knows next week; asking a model to rediscover it would be
        // slower, costlier and less reliable.
        //
        // Wrapped so a memory write can never fail a submission: the student's
        // marks are the product, the profile is a side effect of it.
        yield* profiles.addNotes(DEFAULT_STUDENT_ID, notesFromAttempt(artifact, graded)).pipe(
          Effect.matchEffect({
            onFailure: () => Effect.void,
            onSuccess: () => Effect.void
          })
        );

        return graded;
      }).pipe(Effect.orDie));
  })
);

export const FeedbackHttpHandlers = HttpApiBuilder.group(
  ProxusApi,
  "feedback",
  Effect.fn(function* (handlers) {
    const feedback = yield* FeedbackRepository;

    return handlers.handle("submit", ({ payload }) => feedback.submit(payload).pipe(Effect.orDie));
  })
);

export const ProfileHttpHandlers = HttpApiBuilder.group(
  ProxusApi,
  "profile",
  Effect.fn(function* (handlers) {
    const profiles = yield* ProfileRepository;

    return handlers
      .handle("get", () => profiles.get(DEFAULT_STUDENT_ID).pipe(Effect.orDie))
      .handle("removeNote", ({ params }) =>
        profiles.removeNote(DEFAULT_STUDENT_ID, params.noteId).pipe(Effect.orDie)
      )
      .handle("clear", () => profiles.clear(DEFAULT_STUDENT_ID).pipe(Effect.orDie));
  })
);

export const HttpHandlersLive = Layer.mergeAll(
  TutorHttpHandlers,
  MaterialsHttpHandlers,
  ArtifactsHttpHandlers,
  FeedbackHttpHandlers,
  ProfileHttpHandlers
);
