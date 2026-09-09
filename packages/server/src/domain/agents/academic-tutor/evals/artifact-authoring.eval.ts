import { Console, Data, Effect, Layer, Ref } from "effect";
import { LanguageModel } from "effect/unstable/ai";
import { GeminiModel } from "../../gemini.ts";
import { AgentSession } from "../../harness/index.ts";
import { type AgentMessage } from "../../harness/message.ts";
import { makeAcademicTutorHarness } from "../../academic-tutor.ts";
import { ArtifactRepository } from "../../../artifacts/artifact.ts";
import { MaterialRepository } from "../../../materials/material.ts";
import { ProfileRepository } from "../../../student/profile.ts";
import {
  ArtifactRepositoryTestRef,
  InMemoryArtifactRepository,
  InMemoryProfileRepository,
  failed,
  formatReport,
  makeMaterialRepository,
  passed,
  type CriterionResult,
  type EvalCaseReport,
  type MaterialFixture
} from "./support.ts";

/**
 * Structural eval: the tutor persists the artifact the user asked for.
 *
 * Scope note: this suite checks shape, not truth — that a quiz exists and has
 * the requested number of questions, not that its content is correct or that it
 * follows the student's material. Content grounding is covered by
 * `grounding.eval.ts`; keeping the two apart means a regression report says
 * which of the two broke.
 *
 * The in-memory repositories and report formatting now come from `support.ts`,
 * so adding an eval means writing a dataset and its criteria.
 */

type ArtifactKind = "note" | "quiz" | "test";

interface ArtifactAuthoringExpected {
  readonly artifactKind: ArtifactKind;
  readonly questionCount?: number;
}

interface ArtifactAuthoringEvalCase {
  readonly id: string;
  readonly input: string;
  readonly expected: ArtifactAuthoringExpected;
  readonly materials?: readonly MaterialFixture[];
  readonly maxSteps?: number;
}

interface EvalCaseContext {
  readonly case: ArtifactAuthoringEvalCase;
  readonly output: string;
  readonly messages: readonly AgentMessage[];
}

const evalId = "academic-tutor.artifact-authoring";

const cases: readonly ArtifactAuthoringEvalCase[] = [
  {
    id: "creates-note",
    input: "Crea una nota breve sobre la regla de la potencia. Usa el comando artifacts create para persistirla. Mantén el markdown en una sola frase simple, sin fórmulas LaTeX, sin comillas y sin saltos de línea.",
    expected: { artifactKind: "note" },
    maxSteps: 8
  },
  {
    id: "creates-quiz",
    input: "Crea un quiz de 3 preguntas sobre derivadas. Usa preguntas true-false o multiple-choice y persiste el quiz con artifacts create.",
    expected: { artifactKind: "quiz", questionCount: 3 },
    maxSteps: 8
  },
  {
    id: "creates-test",
    input: "Crea un test de 2 preguntas sobre límites. Persiste el test con artifacts create.",
    expected: { artifactKind: "test", questionCount: 2 },
    maxSteps: 8
  }
];

const shouldCreateExpectedArtifact = (context: EvalCaseContext) => Effect.gen(function* () {
  const id = "should-create-expected-artifact";
  const ref = yield* ArtifactRepositoryTestRef;
  const state = yield* Ref.get(ref);
  const artifact = state.artifacts.at(-1);
  const expected = context.case.expected;

  if (artifact === undefined) {
    return failed(id, "Expected an artifact to be created.", { artifacts: state.artifacts });
  }

  if (artifact.kind !== expected.artifactKind) {
    return failed(id, `Expected ${expected.artifactKind}, got ${artifact.kind}.`, artifact);
  }

  if (expected.questionCount !== undefined) {
    if (artifact.kind === "note") {
      return failed(id, "Expected questionCount but created a note.", artifact);
    }

    if (artifact.questions.length !== expected.questionCount) {
      return failed(
        id,
        `Expected ${expected.questionCount} questions, got ${artifact.questions.length}.`,
        artifact
      );
    }
  }

  return passed(id, `Created expected ${artifact.kind} artifact ${artifact.id}.`, artifact);
});

const shouldMentionCreatedArtifact = (context: EvalCaseContext) => Effect.gen(function* () {
  const id = "should-mention-created-artifact";
  const ref = yield* ArtifactRepositoryTestRef;
  const state = yield* Ref.get(ref);
  const artifact = state.artifacts.at(-1);

  if (artifact === undefined) {
    return failed(id, "No artifact was created, so the final answer cannot mention it.");
  }

  const output = context.output.toLocaleLowerCase();
  const leaksId = output.includes(artifact.id.toLocaleLowerCase());
  const pointsToIt = /cread|created|listo|disponible|panel|estudio|lo tienes|tienes (el|la|un|una)/.test(output);

  // This used to pass if the answer contained the artifact **id**, which is now
  // the opposite of what the product wants: `artefacto-sin-id-ni-duplicado` in
  // the scenario suite fails when the id leaks, so the two suites were asserting
  // contradictory things. An id is an internal address and means nothing to a
  // student; what the answer owes them is knowing the thing exists and where to
  // find it.
  if (leaksId) {
    return failed(id, "Final answer leaked the internal artifact id.", { output: context.output, artifact });
  }

  return pointsToIt
    ? passed(id, "Final answer points the student to the created artifact, without its id.")
    : failed(id, "Final answer did not point the student to the created artifact.", { output: context.output, artifact });
});

const shouldNotHaveToolFailures = (context: EvalCaseContext): Effect.Effect<CriterionResult> => {
  const id = "should-not-have-tool-failures";
  const failures = context.messages.filter((message) => message.role === "tool-result" && message.isFailure);
  return Effect.succeed(failures.length === 0
    ? passed(id, "No tool failures were produced.")
    : failed(id, "Expected no tool failures.", failures)
  );
};

const makeEvalLayer = (testCase: ArtifactAuthoringEvalCase) => Layer.mergeAll(
  InMemoryArtifactRepository,
  InMemoryProfileRepository,
  Layer.succeed(MaterialRepository, makeMaterialRepository(testCase.materials ?? [])),
  GeminiModel
);

const runCase = (testCase: ArtifactAuthoringEvalCase): Effect.Effect<
  EvalCaseReport,
  unknown,
  MaterialRepository | ArtifactRepository | ArtifactRepositoryTestRef | ProfileRepository | LanguageModel.LanguageModel
> => Effect.gen(function* () {
  const materialRepository = yield* MaterialRepository;
  const artifactRepository = yield* ArtifactRepository;
  const profileRepository = yield* ProfileRepository;
  const harness = makeAcademicTutorHarness(materialRepository, artifactRepository, profileRepository);
  const session = AgentSession.make(harness);

  const result = yield* session.run({
    input: testCase.input,
    maxSteps: testCase.maxSteps ?? 8
  }).pipe(Effect.provide(harness.layer));

  const context: EvalCaseContext = {
    case: testCase,
    output: result.output,
    messages: result.messages
  };

  const criteria = yield* Effect.all([
    shouldCreateExpectedArtifact(context),
    shouldMentionCreatedArtifact(context),
    shouldNotHaveToolFailures(context)
  ], { concurrency: 1 });

  const status = criteria.every((criterion) => criterion.status === "passed") ? "passed" : "failed";

  return {
    evalId,
    caseId: testCase.id,
    status,
    output: result.output,
    criteria,
    attribution: result.trace.attribution,
    signals: result.trace.signals
  } satisfies EvalCaseReport;
});

const runDataset = Effect.gen(function* () {
  const reports: EvalCaseReport[] = [];

  for (const testCase of cases) {
    const report = yield* runCase(testCase).pipe(Effect.provide(makeEvalLayer(testCase)));
    reports.push(report);
  }

  return reports;
});

class ArtifactAuthoringEvalFailed extends Data.TaggedError("ArtifactAuthoringEvalFailed")<{}> {}

export const artifactAuthoringEval = runDataset.pipe(
  Effect.tap((reports) => Console.log(formatReport(evalId, reports))),
  Effect.andThen((reports) => reports.some((report) => report.status === "failed")
    ? Effect.fail(new ArtifactAuthoringEvalFailed())
    : Effect.succeed(reports)
  )
);

if (import.meta.main) {
  Effect.runPromise(artifactAuthoringEval);
}
