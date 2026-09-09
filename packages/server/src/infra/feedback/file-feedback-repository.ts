import { Effect, FileSystem, Layer, Path } from "effect";
import type { FeedbackRecord } from "@proxus/shared";
import {
  FeedbackRepository,
  FeedbackRepositoryStorageError,
  type FeedbackRepository as FeedbackRepositoryType,
  type SubmitFeedbackInput
} from "../../domain/feedback/feedback.ts";

/** Append-only JSONL, same rationale as the trace log. */
export const FileFeedbackRepository = {
  make: (directory: string): Effect.Effect<FeedbackRepositoryType, never, FileSystem.FileSystem | Path.Path> =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const file = path.join(directory, "feedback.jsonl");

      const mapStorageError = (reason: unknown) => new FeedbackRepositoryStorageError({ reason });

      const submit = (input: SubmitFeedbackInput) => {
        const record: FeedbackRecord = {
          id: crypto.randomUUID(),
          ...(input.traceId === undefined ? {} : { traceId: input.traceId }),
          rating: input.rating,
          ...(input.comment === undefined ? {} : { comment: input.comment }),
          ...(input.excerpt === undefined ? {} : { excerpt: input.excerpt }),
          createdAt: new Date().toISOString()
        };

        return fs.makeDirectory(directory, { recursive: true }).pipe(
          Effect.andThen(() => fs.writeFileString(file, `${JSON.stringify(record)}\n`, { flag: "a" })),
          Effect.mapError(mapStorageError),
          Effect.as(record)
        );
      };

      const list = (limit?: number) =>
        fs.exists(file).pipe(
          Effect.andThen((exists) =>
            exists
              ? fs.readFileString(file).pipe(
                  Effect.map((text) => {
                    const lines = text.split("\n").filter((line) => line.trim().length > 0);
                    const selected = limit === undefined ? lines : lines.slice(-limit);
                    return selected.flatMap((line) => {
                      try {
                        return [JSON.parse(line) as FeedbackRecord];
                      } catch {
                        return [];
                      }
                    });
                  })
                )
              : Effect.succeed<readonly FeedbackRecord[]>([])
          ),
          Effect.mapError(mapStorageError)
        );

      return { submit, list };
    }),
  layer: (directory: string) => Layer.effect(FeedbackRepository)(FileFeedbackRepository.make(directory))
};
