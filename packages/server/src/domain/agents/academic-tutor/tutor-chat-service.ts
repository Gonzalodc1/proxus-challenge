import { Context, Effect, Layer, Stream } from "effect";
import { LanguageModel } from "effect/unstable/ai";
import type { TutorChatRequest, TutorChatResponse, TutorChatStreamEvent } from "@proxus/shared";
import { ArtifactRepository } from "../../artifacts/artifact.ts";
import { MaterialRepository } from "../../materials/material.ts";
import { ProfileRepository } from "../../student/profile.ts";
import { TraceRepository, type AgentTrace } from "../../observability/trace.ts";
import { AgentSession } from "../harness/index.ts";
import { makeAcademicTutorHarness } from "../academic-tutor.ts";

export interface TutorChatService {
  readonly sendMessage: (
    input: TutorChatRequest
  ) => Effect.Effect<TutorChatResponse, unknown, LanguageModel.LanguageModel>;
  readonly streamMessage: (
    input: TutorChatRequest
  ) => Stream.Stream<TutorChatStreamEvent, unknown, LanguageModel.LanguageModel>;
}

export const TutorChatService = Context.Service<TutorChatService>(
  "@proxus/server/agents/academic-tutor/TutorChatService"
);

export const TutorChatServiceLive = Layer.effect(
  TutorChatService,
  Effect.gen(function* () {
    const materialRepository = yield* MaterialRepository;
    const artifactRepository = yield* ArtifactRepository;
    const profileRepository = yield* ProfileRepository;
    const traces = yield* TraceRepository;
    const harness = makeAcademicTutorHarness(materialRepository, artifactRepository, profileRepository);
    const session = AgentSession.make(harness);

    /**
     * Persisting a trace must never break the answer the student is waiting
     * for, so a storage failure is swallowed here on purpose: observability is
     * a side channel, not part of the product path.
     */
    const recordTrace = (trace: AgentTrace) => traces.append(trace).pipe(
      Effect.matchEffect({
        onFailure: () => Effect.void,
        onSuccess: () => Effect.void
      })
    );

    const sessionInput = (input: TutorChatRequest, onTrace: (trace: AgentTrace) => Effect.Effect<void>) => ({
      input: input.input,
      messages: input.messages,
      maxSteps: input.maxSteps ?? 8,
      onTrace
    });

    return {
      sendMessage: (input) => session.run(sessionInput(input, recordTrace)).pipe(
        Effect.map((result): TutorChatResponse => ({
          output: result.output,
          newMessages: result.newMessages,
          messages: result.messages
        })),
        Effect.provide(harness.layer)
      ),
      streamMessage: (input) => {
        // Captured while the run finishes so the terminating `done` event can
        // carry the trace id, which is what lets the UI attach feedback to the
        // exact run that produced the answer.
        let traceId: string | undefined;

        const onTrace = (trace: AgentTrace) => Effect.gen(function* () {
          traceId = trace.traceId;
          yield* recordTrace(trace);
        });

        return session.stream(sessionInput(input, onTrace)).pipe(
          Stream.map((message): TutorChatStreamEvent => ({ type: "message", message })),
          Stream.concat(Stream.fromEffect(Effect.sync((): TutorChatStreamEvent =>
            traceId === undefined ? { type: "done" } : { type: "done", traceId }
          ))),
          Stream.provide(harness.layer)
        );
      }
    };
  })
);
