import type { Artifact, ArtifactAttempt, QuestionCorrection } from "../artifacts/artifact.ts";
import type { AddProfileNoteInput } from "./profile.ts";

/**
 * Turns a graded attempt into what the tutor should remember about the student.
 *
 * Derived from the correction, not asked of the model: whether an answer was
 * right is already known deterministically, so spending a generation to
 * rediscover it would be slower, more expensive and less reliable. The model is
 * only needed for things that require judgement.
 *
 * This is what makes a quiz more than a score. A wrong answer stops being a
 * number and becomes a gap the tutor still knows about next week.
 */

const MAX_DETAIL = 160;

const truncate = (value: string) =>
  value.length <= MAX_DETAIL ? value : `${value.slice(0, MAX_DETAIL - 1)}…`;

const promptFor = (artifact: Artifact, questionId: string): string | undefined => {
  if (artifact.kind === "note") {
    return undefined;
  }

  return artifact.questions.find((question) => question.id === questionId)?.prompt;
};

/** A correction counts as a miss when it was marked wrong, or scored below full marks. */
const isMiss = (correction: QuestionCorrection): boolean =>
  correction.questionType === "short-answer"
    ? correction.score < correction.maxScore
    : !correction.correct;

export const notesFromAttempt = (
  artifact: Artifact,
  attempt: ArtifactAttempt
): readonly AddProfileNoteInput[] => {
  if (attempt.status !== "graded" || artifact.kind === "note") {
    return [];
  }

  const notes: AddProfileNoteInput[] = [];
  const missed = attempt.corrections.filter(isMiss);

  for (const correction of missed) {
    const prompt = promptFor(artifact, correction.questionId);
    if (prompt === undefined) {
      continue;
    }

    notes.push({
      kind: "gap",
      topic: artifact.title,
      detail: truncate(`falló "${prompt}"`),
      source: "quiz"
    });
  }

  // A clean run is worth remembering too: without it the profile would only
  // ever accumulate weaknesses, and a tutor that only recalls your failures is
  // both a worse teacher and a worse thing to hand a student.
  if (missed.length === 0 && attempt.corrections.length > 0) {
    notes.push({
      kind: "strength",
      topic: artifact.title,
      detail: `resolvió sin fallos (${attempt.corrections.length} preguntas)`,
      source: "quiz"
    });
  }

  return notes;
};
