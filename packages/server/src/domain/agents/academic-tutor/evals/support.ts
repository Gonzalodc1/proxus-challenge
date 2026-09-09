import { Context, Effect, Layer, Ref } from "effect";
import { LanguageModel, Prompt } from "effect/unstable/ai";
import { AgentMessage, type AgentMessage as AgentMessageType } from "../../harness/message.ts";
import {
  Artifact,
  ArtifactAttempt,
  ArtifactNotFound,
  ArtifactRepository,
  ArtifactTypeMismatch,
  AttemptNotFound,
  gradeAttempt,
  type ArtifactRepositoryError,
  type CreateArtifactInput,
  type ListArtifactsInput,
  type SubmitAttemptInput
} from "../../../artifacts/artifact.ts";
import {
  MaterialNotFound,
  MaterialRepository,
  type MaterialPageImages,
  type PdfMaterial
} from "../../../materials/material.ts";
import type { FailureAttribution, ScaffoldingSignal } from "../../../observability/trace.ts";
import {
  DEFAULT_STUDENT_ID,
  ProfileRepository,
  mergeNotes,
  type AddProfileNoteInput,
  type ProfileRepository as ProfileRepositoryType,
  type StudentProfile
} from "../../../student/profile.ts";

/**
 * Shared scaffolding for the tutor evals.
 *
 * Extracted so a new eval is a dataset plus its acceptance criteria, instead of
 * another 200-line copy of the in-memory repositories. Anything reusable across
 * eval suites belongs here; anything specific to one question does not.
 */

// --- criteria ---------------------------------------------------------------

export type CriterionStatus = "passed" | "failed";

export interface CriterionResult {
  readonly id: string;
  readonly status: CriterionStatus;
  readonly message: string;
  readonly details?: unknown;
}

export const passed = (id: string, message: string, details?: unknown): CriterionResult => ({
  id,
  status: "passed",
  message,
  ...(details === undefined ? {} : { details })
});

export const failed = (id: string, message: string, details?: unknown): CriterionResult => ({
  id,
  status: "failed",
  message,
  ...(details === undefined ? {} : { details })
});

export interface EvalCaseReport {
  readonly evalId: string;
  readonly caseId: string;
  readonly status: CriterionStatus;
  readonly output: string;
  readonly criteria: readonly CriterionResult[];
  /** Trace attribution for the run that produced this case, when available. */
  readonly attribution?: FailureAttribution | undefined;
  readonly signals?: readonly ScaffoldingSignal[] | undefined;
}

export const formatReport = (evalId: string, reports: readonly EvalCaseReport[]) => {
  const lines: string[] = [evalId];

  for (const report of reports) {
    lines.push(`  ${report.status === "passed" ? "✓" : "✗"} ${report.caseId}`);
    for (const criterion of report.criteria) {
      lines.push(`    ${criterion.status === "passed" ? "✓" : "✗"} ${criterion.id}: ${criterion.message}`);
      if (criterion.status === "failed" && criterion.details !== undefined) {
        lines.push(`      ${JSON.stringify(criterion.details, null, 2).split("\n").join("\n      ")}`);
      }
    }
    if (report.attribution === "scaffolding-suspected") {
      lines.push(`    ! scaffolding signals: ${(report.signals ?? []).join(", ")}`);
    }
  }

  const passedCount = reports.filter((report) => report.status === "passed").length;
  // A failed case on a run whose scaffolding misbehaved is not evidence about
  // the model's ability, so it is counted separately instead of being folded
  // into the headline number.
  const suspect = reports.filter((report) => report.status === "failed" && report.attribution === "scaffolding-suspected").length;

  lines.push("");
  lines.push(`  ${passedCount}/${reports.length} cases passed`);
  if (suspect > 0) {
    lines.push(`  ${suspect} failed case(s) ran with scaffolding signals: treat as inconclusive, not as capability failures`);
  }

  return lines.join("\n");
};

// --- in-memory artifact repository ------------------------------------------

interface ArtifactRepositoryState {
  readonly artifacts: readonly Artifact[];
  readonly attempts: readonly ArtifactAttempt[];
  readonly nextArtifactId: number;
  readonly nextAttemptId: number;
}

export class ArtifactRepositoryTestRef extends Context.Service<ArtifactRepositoryTestRef, Ref.Ref<ArtifactRepositoryState>>()(
  "@proxus/server/evals/ArtifactRepositoryTestRef"
) {
  static readonly layer = Layer.effect(
    ArtifactRepositoryTestRef,
    Ref.make<ArtifactRepositoryState>({
      artifacts: [],
      attempts: [],
      nextArtifactId: 1,
      nextAttemptId: 1
    })
  );
}

export const InMemoryArtifactRepository = Layer.effect(
  ArtifactRepository,
  Effect.gen(function* () {
    const ref = yield* ArtifactRepositoryTestRef;

    const createArtifact = (input: CreateArtifactInput): Effect.Effect<Artifact, ArtifactRepositoryError> =>
      Ref.modify(ref, (state) => {
        const artifact = { ...input, id: `artifact-${state.nextArtifactId}` } as Artifact;
        return [
          artifact,
          { ...state, artifacts: [...state.artifacts, artifact], nextArtifactId: state.nextArtifactId + 1 }
        ];
      });

    const saveArtifact = (artifact: Artifact): Effect.Effect<void, ArtifactRepositoryError> =>
      Ref.update(ref, (state) => ({
        ...state,
        artifacts: [...state.artifacts.filter((candidate) => candidate.id !== artifact.id), artifact]
      }));

    const getArtifact = (id: string): Effect.Effect<Artifact, ArtifactRepositoryError> =>
      Ref.get(ref).pipe(
        Effect.andThen((state) => {
          const artifact = state.artifacts.find((candidate) => candidate.id === id);
          return artifact === undefined
            ? Effect.fail(new ArtifactNotFound({ artifactId: id }))
            : Effect.succeed(artifact);
        })
      );

    const listArtifacts = (input?: ListArtifactsInput): Effect.Effect<readonly Artifact[], ArtifactRepositoryError> =>
      Ref.get(ref).pipe(
        Effect.map((state) => input?.kind === undefined
          ? state.artifacts
          : state.artifacts.filter((artifact) => artifact.kind === input.kind)
        )
      );

    const submitAttempt = (input: SubmitAttemptInput): Effect.Effect<ArtifactAttempt, ArtifactRepositoryError> =>
      getArtifact(input.artifactId).pipe(
        Effect.andThen((artifact) => {
          if (artifact.kind !== input.artifactKind) {
            return Effect.fail(new ArtifactTypeMismatch({
              artifactId: artifact.id,
              expected: input.artifactKind,
              actual: artifact.kind
            }));
          }

          return Ref.modify(ref, (state) => {
            const attempt = {
              ...input,
              id: `attempt-${state.nextAttemptId}`,
              status: "ungraded" as const
            } as ArtifactAttempt;

            return [
              attempt,
              { ...state, attempts: [...state.attempts, attempt], nextAttemptId: state.nextAttemptId + 1 }
            ];
          });
        })
      );

    const saveAttempt = (attempt: ArtifactAttempt): Effect.Effect<void, ArtifactRepositoryError> =>
      Ref.update(ref, (state) => ({
        ...state,
        attempts: [...state.attempts.filter((candidate) => candidate.id !== attempt.id), attempt]
      }));

    const getAttempt = (id: string): Effect.Effect<ArtifactAttempt, ArtifactRepositoryError> =>
      Ref.get(ref).pipe(
        Effect.andThen((state) => {
          const attempt = state.attempts.find((candidate) => candidate.id === id);
          return attempt === undefined
            ? Effect.fail(new AttemptNotFound({ attemptId: id }))
            : Effect.succeed(attempt);
        })
      );

    const listAttempts = (artifactId?: string): Effect.Effect<readonly ArtifactAttempt[], ArtifactRepositoryError> =>
      Ref.get(ref).pipe(
        Effect.map((state) => artifactId === undefined
          ? state.attempts
          : state.attempts.filter((attempt) => attempt.artifactId === artifactId)
        )
      );

    const gradeSavedAttempt = (attemptId: string): Effect.Effect<ArtifactAttempt, ArtifactRepositoryError> =>
      getAttempt(attemptId).pipe(
        Effect.andThen((attempt) => getArtifact(attempt.artifactId).pipe(
          Effect.andThen((artifact) => gradeAttempt(artifact, attempt)),
          Effect.andThen((gradedAttempt) => saveAttempt(gradedAttempt).pipe(Effect.as(gradedAttempt)))
        ))
      );

    return ArtifactRepository.of({
      createArtifact,
      saveArtifact,
      getArtifact,
      listArtifacts,
      submitAttempt,
      saveAttempt,
      getAttempt,
      listAttempts,
      gradeAttempt: gradeSavedAttempt
    });
  })
).pipe(Layer.provideMerge(ArtifactRepositoryTestRef.layer));

// --- material fixtures ------------------------------------------------------

export interface MaterialPageFixture {
  readonly page: number;
  readonly text: string;
}

export interface MaterialFixture {
  readonly id: string;
  readonly title: string;
  readonly fileName: string;
  readonly uploadedAt: string;
  readonly pages: readonly MaterialPageFixture[];
}

const toPdfMaterial = (material: MaterialFixture): PdfMaterial => ({
  id: material.id,
  title: material.title,
  fileName: material.fileName,
  pageCount: material.pages.length,
  uploadedAt: material.uploadedAt
});

export const makeMaterialRepository = (materials: readonly MaterialFixture[]) => MaterialRepository.of({
  list: () => Effect.succeed(materials.map(toPdfMaterial)),
  get: (id) => {
    const material = materials.find((candidate) => candidate.id === id);
    return material === undefined
      ? Effect.fail(new MaterialNotFound({ materialId: id }))
      : Effect.succeed(toPdfMaterial(material));
  },
  renderPages: (id, pages) => {
    const material = materials.find((candidate) => candidate.id === id);
    if (material === undefined) {
      return Effect.fail(new MaterialNotFound({ materialId: id }));
    }

    const renderedPages = pages.map((page) => {
      const fixturePage = material.pages.find((candidate) => candidate.page === page);
      return {
        page,
        mediaType: "image/png" as const,
        data: `data:image/png;base64,${btoa(fixturePage?.text ?? `Page ${page}`)}`
      };
    });

    return Effect.succeed<MaterialPageImages>({
      type: "material-page-images",
      material: toPdfMaterial(material),
      pages: renderedPages
    });
  }
});

/**
 * Seeds the conversation with material content already "read".
 *
 * Why not drive `materials view` for real: that path renders PDF pages to PNG
 * and relies on the model reading them visually, so a failure would conflate
 * three things — PDF rendering, visual reading, and grounding behaviour. These
 * suites measure the third one, so the material is injected through the
 * tool-result channel as text and the other two are held constant. Rendering
 * itself is covered by the manual QA flow in `docs/testing.md`.
 */
export const materialContextMessages = (
  material: MaterialFixture,
  pages: readonly number[]
): readonly AgentMessageType[] => {
  const selected = material.pages.filter((page) => pages.includes(page.page));
  const body = selected
    .map((page) => `--- ${material.title} · page ${page.page} ---\n${page.text}`)
    .join("\n\n");

  return [
    AgentMessage.toolCall("cli", { input: `materials view ${material.id} ${pages.join(",")}` }),
    AgentMessage.toolResult("cli", body, false)
  ];
};

/**
 * Strips LaTeX decoration before a lexical rule reads an answer.
 *
 * Found by the suite itself. Once the tutor was told to write maths in LaTeX,
 * the control case started failing on a **correct** answer: it replied
 * `El examen practico pondera un $35\\%$ ...`, and the rule looked for
 * `35%`, which no longer appears literally because of the escape. The trace was
 * `clean`, so this was never a capability regression, it was the grader being
 * brittle to formatting.
 *
 * That is the known weakness of a deterministic rule, so the fix belongs here
 * rather than in a looser regex per case: normalise once, and every lexical
 * rule in every suite stops being fooled by the same thing.
 */
export const plainText = (output: string) =>
  output
    // `\%` -> `%`, and the same for the other characters LaTeX makes you escape.
    .replace(/\\([%$&_#{}])/g, "$1")
    // Spacing commands (`\,` `\;`) exist only to nudge kerning.
    .replace(/\\[,;:!]/g, " ")
    // Math delimiters, once nothing depends on them any more.
    .replace(/\$/g, "")
    .replace(/\s+/g, " ");

// --- model-as-judge ---------------------------------------------------------

export interface JudgeVerdict {
  readonly passed: boolean;
  readonly reason: string;
}

/**
 * Second opinion from a model, used alongside a deterministic rule check.
 *
 * Neither grader is trusted on its own: the rule check is cheap and
 * reproducible but blind to paraphrase, and the judge reads meaning but is
 * itself a language model and can be wrong. Each criterion records both plus
 * whether they agreed, so disagreement is visible in the report instead of
 * being hidden behind a single number.
 */
export const judge = (input: {
  readonly question: string;
  readonly answer: string;
  readonly rubric: string;
}): Effect.Effect<JudgeVerdict, never, LanguageModel.LanguageModel> => {
  const prompt: readonly Prompt.MessageEncoded[] = [
    {
      role: "system",
      content: [
        "You grade a tutor's answer against one rubric. You are strict and literal.",
        "Reply with exactly one line: `PASS: <reason>` or `FAIL: <reason>`.",
        "Judge only the rubric. Do not judge style, length, or language."
      ].join("\n")
    },
    {
      role: "user",
      content: [
        `RUBRIC: ${input.rubric}`,
        "",
        `STUDENT QUESTION: ${input.question}`,
        "",
        "TUTOR ANSWER:",
        input.answer
      ].join("\n")
    }
  ];

  return LanguageModel.generateText({ prompt }).pipe(
    Effect.map((response): JudgeVerdict => {
      const text = response.text.trim();
      const verdict = /^\s*PASS\b/i.test(text);
      return { passed: verdict, reason: text.slice(0, 300) };
    }),
    // A judge that cannot be reached must not silently turn into a pass.
    Effect.matchEffect({
      onFailure: (error) => Effect.succeed<JudgeVerdict>({
        passed: false,
        reason: `judge unavailable: ${String(error)}`
      }),
      onSuccess: (verdict) => Effect.succeed(verdict)
    })
  );
};

/** Combines a deterministic rule result with the judge, recording agreement. */
export const combineGraders = (input: {
  readonly id: string;
  readonly rulePassed: boolean;
  readonly ruleMessage: string;
  readonly verdict: JudgeVerdict;
  readonly output: string;
}): CriterionResult => {
  const agreed = input.rulePassed === input.verdict.passed;
  const details = {
    rule: { passed: input.rulePassed, message: input.ruleMessage },
    judge: { passed: input.verdict.passed, reason: input.verdict.reason },
    graderAgreement: agreed,
    output: input.output
  };

  // Conservative on disagreement: a criterion only passes when both graders
  // pass. Overcounting a pass would quietly inflate the quality number, which
  // is the exact failure mode these suites exist to catch.
  const status = input.rulePassed && input.verdict.passed;

  return status
    ? passed(input.id, `rule and judge agree: ${input.ruleMessage}`, details)
    : failed(
        input.id,
        agreed
          ? `rule and judge agree it failed: ${input.ruleMessage}`
          : `graders disagree (rule=${input.rulePassed}, judge=${input.verdict.passed}); counted as failure`,
        details
      );
};

// --- in-memory student profile ----------------------------------------------

/**
 * Profile memory for evals: same behaviour, nothing written to disk.
 *
 * The evals build the same harness the product does, memory included, so a
 * suite measures the agent that actually ships rather than a stripped-down
 * variant of it. Each case gets a fresh, empty profile, which keeps runs
 * independent and reproducible.
 */
export const makeInMemoryProfileRepository = (): ProfileRepositoryType => {
  let profile: StudentProfile = {
    studentId: DEFAULT_STUDENT_ID,
    notes: [],
    updatedAt: new Date().toISOString()
  };
  let counter = 0;

  const save = (notes: StudentProfile["notes"]): StudentProfile => {
    profile = { ...profile, notes, updatedAt: new Date().toISOString() };
    return profile;
  };

  return {
    get: () => Effect.succeed(profile),
    addNotes: (_studentId: string, incoming: readonly AddProfileNoteInput[]) =>
      Effect.sync(() => save(mergeNotes(
        profile.notes,
        incoming,
        new Date().toISOString(),
        () => `n${++counter}`
      ))),
    removeNote: (_studentId: string, noteId: string) =>
      Effect.sync(() => save(profile.notes.filter((note) => note.id !== noteId))),
    clear: () => Effect.sync(() => save([]))
  };
};

export const InMemoryProfileRepository = Layer.effect(
  ProfileRepository,
  Effect.sync(() => makeInMemoryProfileRepository())
);
