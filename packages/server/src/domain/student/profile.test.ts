import { strict as assert } from "node:assert";
import type { Artifact, ArtifactAttempt } from "../artifacts/artifact.ts";
import { notesFromAttempt } from "./learning-signals.ts";
import { MAX_NOTES, mergeNotes, renderProfile, type ProfileNote } from "./profile.ts";

/**
 * Deterministic tests for the student profile rules. No model, no filesystem:
 * the merge policy and the quiz-to-memory mapping are pure functions precisely
 * so they can be pinned down like this.
 */

let passed = 0;
const check = (name: string, assertion: () => void) => {
  assertion();
  passed++;
  console.log(`  ✓ ${name}`);
};

const now = "2026-01-01T00:00:00.000Z";
let counter = 0;
const makeId = () => `note-${++counter}`;

console.log("student.profile");

check("adds a new note", () => {
  counter = 0;
  const notes = mergeNotes([], [
    { kind: "gap", topic: "Bucles", detail: "falló while", source: "quiz" }
  ], now, makeId);

  assert.equal(notes.length, 1);
  assert.equal(notes[0]?.topic, "Bucles");
  assert.equal(notes[0]?.id, "note-1");
});

// Repeating an observation must not stack duplicates competing for prompt space.
check("refreshes a repeated observation instead of duplicating it", () => {
  counter = 0;
  const first = mergeNotes([], [
    { kind: "gap", topic: "Bucles", detail: "falló while", source: "quiz" }
  ], "2026-01-01T00:00:00.000Z", makeId);

  const second = mergeNotes(first, [
    { kind: "gap", topic: "  bucles ", detail: "FALLÓ WHILE", source: "quiz" }
  ], "2026-02-02T00:00:00.000Z", makeId);

  assert.equal(second.length, 1, "should still be one note");
  assert.equal(second[0]?.id, "note-1", "should keep the original id");
  assert.equal(second[0]?.createdAt, "2026-02-02T00:00:00.000Z", "should refresh the date");
});

check("keeps notes that differ in kind or topic", () => {
  counter = 0;
  const notes = mergeNotes([], [
    { kind: "gap", topic: "Bucles", detail: "falló while", source: "quiz" },
    { kind: "strength", topic: "Bucles", detail: "falló while", source: "quiz" },
    { kind: "gap", topic: "Listas", detail: "falló while", source: "quiz" }
  ], now, makeId);

  assert.equal(notes.length, 3);
});

check("ignores empty topics or details", () => {
  counter = 0;
  const notes = mergeNotes([], [
    { kind: "gap", topic: "   ", detail: "algo", source: "chat" },
    { kind: "gap", topic: "Bucles", detail: "  ", source: "chat" }
  ], now, makeId);

  assert.equal(notes.length, 0);
});

check("caps the profile and drops the oldest notes", () => {
  counter = 0;
  const many = Array.from({ length: MAX_NOTES + 10 }, (_, index) => ({
    kind: "gap" as const,
    topic: `Tema ${index}`,
    detail: "detalle",
    source: "quiz" as const
  }));

  const notes = mergeNotes([], many, now, makeId);
  assert.equal(notes.length, MAX_NOTES);
  assert.equal(notes[0]?.topic, "Tema 10", "oldest should be dropped first");
});

check("renders an empty profile without crashing", () => {
  const text = renderProfile({ studentId: "s", notes: [], updatedAt: now });
  assert.ok(text.includes("Todavía no sé nada"));
});

check("renders notes grouped by kind, with ids for deletion", () => {
  const notes: readonly ProfileNote[] = [
    { id: "n1", kind: "gap", topic: "Bucles", detail: "falló while", source: "quiz", createdAt: now },
    { id: "n2", kind: "context", topic: "Examen", detail: "el 20 de junio", source: "chat", createdAt: now }
  ];
  const text = renderProfile({ studentId: "s", notes, updatedAt: now });

  assert.ok(text.indexOf("Contexto") < text.indexOf("Puntos débiles"), "context comes first");
  assert.ok(text.includes("[n1]"), "note ids are visible so they can be removed");
});

console.log("\nstudent.learning-signals");

const quiz: Artifact = {
  kind: "quiz",
  id: "artifact-1",
  title: "Bucles en Python",
  questions: [
    { type: "true-false", id: "q1", prompt: "while repite mientras la condición sea cierta", correctAnswer: true, explanation: "" },
    { type: "true-false", id: "q2", prompt: "for solo funciona con números", correctAnswer: false, explanation: "" }
  ]
};

const gradedWith = (corrections: ReadonlyArray<{ id: string; correct: boolean }>): ArtifactAttempt => ({
  artifactKind: "quiz",
  status: "graded",
  id: "attempt-1",
  artifactId: "artifact-1",
  answers: [],
  score: corrections.filter((c) => c.correct).length,
  maxScore: corrections.length,
  summary: "",
  corrections: corrections.map((c) => ({
    questionType: "true-false" as const,
    questionId: c.id,
    correct: c.correct,
    answer: true,
    correctAnswer: true,
    explanation: ""
  }))
});

check("records a gap for each missed question", () => {
  const notes = notesFromAttempt(quiz, gradedWith([
    { id: "q1", correct: true },
    { id: "q2", correct: false }
  ]));

  assert.equal(notes.length, 1);
  assert.equal(notes[0]?.kind, "gap");
  assert.equal(notes[0]?.topic, "Bucles en Python");
  assert.ok(notes[0]?.detail.includes("for solo funciona con números"));
});

check("records a strength when nothing was missed", () => {
  const notes = notesFromAttempt(quiz, gradedWith([
    { id: "q1", correct: true },
    { id: "q2", correct: true }
  ]));

  assert.equal(notes.length, 1);
  assert.equal(notes[0]?.kind, "strength");
});

check("records nothing for an ungraded attempt", () => {
  const ungraded: ArtifactAttempt = {
    artifactKind: "quiz",
    status: "ungraded",
    id: "attempt-2",
    artifactId: "artifact-1",
    answers: []
  };

  assert.deepEqual(notesFromAttempt(quiz, ungraded), []);
});

check("records nothing for a note artifact", () => {
  const note: Artifact = { kind: "note", id: "a", title: "t", markdown: "m" };
  assert.deepEqual(notesFromAttempt(note, gradedWith([{ id: "q1", correct: false }])), []);
});

console.log(`\n  ${passed} assertions passed`);
