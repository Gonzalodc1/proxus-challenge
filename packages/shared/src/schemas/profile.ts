import { Schema } from "effect";

export const ProfileNoteKind = Schema.Union([
  Schema.Literal("gap"),
  Schema.Literal("strength"),
  Schema.Literal("preference"),
  Schema.Literal("context")
]);
export type ProfileNoteKind = typeof ProfileNoteKind.Type;

export const ProfileNoteSource = Schema.Union([
  Schema.Literal("quiz"),
  Schema.Literal("debate"),
  Schema.Literal("chat")
]);
export type ProfileNoteSource = typeof ProfileNoteSource.Type;

export const ProfileNote = Schema.Struct({
  id: Schema.String,
  kind: ProfileNoteKind,
  topic: Schema.String,
  detail: Schema.String,
  source: ProfileNoteSource,
  createdAt: Schema.String
});
export type ProfileNote = typeof ProfileNote.Type;

/**
 * The tutor's memory, exposed to the student who it is about.
 *
 * Deliberately readable and deletable from the UI: a tutor that quietly
 * accumulates judgements about someone is a liability, while one whose memory
 * you can inspect and correct is a feature. The `source` field is part of that
 * — the student can tell what was inferred from a quiz and what came out of a
 * conversation.
 */
export const StudentProfile = Schema.Struct({
  studentId: Schema.String,
  notes: Schema.Array(ProfileNote),
  updatedAt: Schema.String
});
export type StudentProfile = typeof StudentProfile.Type;
