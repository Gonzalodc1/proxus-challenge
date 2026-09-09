import { Effect, FileSystem, Layer, Path } from "effect";
import {
  TraceRepository,
  TraceRepositoryStorageError,
  type AgentTrace,
  type TraceRepository as TraceRepositoryType
} from "../../domain/observability/trace.ts";

/**
 * Appends traces to a JSONL file (one JSON object per line).
 *
 * JSONL over a database on purpose: the challenge asks to keep local
 * persistence simple, and append-only lines are the natural shape for an
 * event log — cheap to write, greppable by hand, and trivially streamable
 * into analysis later.
 */
export const FileTraceRepository = {
  make: (directory: string): Effect.Effect<TraceRepositoryType, never, FileSystem.FileSystem | Path.Path> =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const file = path.join(directory, "traces.jsonl");

      const mapStorageError = (reason: unknown) => new TraceRepositoryStorageError({ reason });

      const append = (trace: AgentTrace) =>
        fs.makeDirectory(directory, { recursive: true }).pipe(
          Effect.andThen(() => fs.writeFileString(file, `${JSON.stringify(trace)}\n`, { flag: "a" })),
          Effect.mapError(mapStorageError)
        );

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
                        return [JSON.parse(line) as AgentTrace];
                      } catch {
                        // A truncated last line should not take the whole read down.
                        return [];
                      }
                    });
                  })
                )
              : Effect.succeed<readonly AgentTrace[]>([])
          ),
          Effect.mapError(mapStorageError)
        );

      return { append, list };
    }),
  layer: (directory: string) => Layer.effect(TraceRepository)(FileTraceRepository.make(directory))
};
