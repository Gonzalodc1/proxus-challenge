import { Context, Data, Effect } from "effect";

/**
 * What the tutor remembers about a student between conversations.
 *
 * The chat itself is stateless: the browser replays the history on every turn
 * and nothing survives a refresh. That makes MagIA start from zero every time,
 * which for exam prep is the difference between a search box and a tutor. This
 * is the small, inspectable memory that closes that gap.
 *
 * Two deliberate constraints:
 *
 *  - **Notes, not transcripts.** Only short distilled facts are kept, never the
 *    conversation. Cheaper to carry in a prompt, and far less to leak.
 *  - **The student can read and delete it.** A tutor that quietly builds a
 *    dossier is a liability; one whose memory you can inspect and correct is a
 *    feature. The API and the UI expose exactly what is stored.
 */

export type ProfileNoteKind =
  /** Something the student got wrong or struggled with. */
  | "gap"
  /** Something they demonstrably handle well. */
  | "strength"
  /** How they like to be taught. */
  | "preference"
  /** Situational context: exam dates, subject, syllabus scope. */
  | "context";

export type ProfileNoteSource = "quiz" | "debate" | "chat";

export interface ProfileNote {
  readonly id: string;
  readonly kind: ProfileNoteKind;
  readonly topic: string;
  readonly detail: string;
  readonly source: ProfileNoteSource;
  readonly createdAt: string;
}

export interface StudentProfile {
  readonly studentId: string;
  readonly notes: readonly ProfileNote[];
  readonly updatedAt: string;
}

export interface AddProfileNoteInput {
  readonly kind: ProfileNoteKind;
  readonly topic: string;
  readonly detail: string;
  readonly source: ProfileNoteSource;
}

/**
 * There is no authentication in this codebase, so every note belongs to a
 * single local student. Isolating memory per real user is the first thing that
 * has to happen alongside accounts: see the changelog.
 */
export const DEFAULT_STUDENT_ID = "local-student";

/**
 * Upper bound on stored notes.
 *
 * The profile is injected into prompts, so it is a recurring token cost on
 * every conversation, not a one-off storage cost. Capping it keeps that bounded
 * and forces the memory to stay a summary instead of drifting into a log.
 */
export const MAX_NOTES = 60;

const sameNote = (a: AddProfileNoteInput, b: ProfileNote) =>
  a.kind === b.kind
  && a.topic.trim().toLocaleLowerCase() === b.topic.trim().toLocaleLowerCase()
  && a.detail.trim().toLocaleLowerCase() === b.detail.trim().toLocaleLowerCase();

/**
 * Merges new notes into a profile.
 *
 * Pure so the merge rules can be tested without touching the filesystem.
 * Repeating an observation refreshes the existing note rather than stacking
 * duplicates: a student who fails the same topic three times should show one
 * current gap, not three identical lines competing for prompt space.
 */
export const mergeNotes = (
  existing: readonly ProfileNote[],
  incoming: readonly AddProfileNoteInput[],
  now: string,
  makeId: () => string
): readonly ProfileNote[] => {
  let notes = [...existing];

  for (const candidate of incoming) {
    if (candidate.topic.trim().length === 0 || candidate.detail.trim().length === 0) {
      continue;
    }

    const duplicate = notes.findIndex((note) => sameNote(candidate, note));
    if (duplicate >= 0) {
      const previous = notes[duplicate];
      if (previous !== undefined) {
        notes.splice(duplicate, 1);
        notes.push({ ...previous, createdAt: now });
      }
      continue;
    }

    notes.push({
      id: makeId(),
      kind: candidate.kind,
      topic: candidate.topic.trim(),
      detail: candidate.detail.trim(),
      source: candidate.source,
      createdAt: now
    });
  }

  // Oldest first, so the cap drops what the tutor learned longest ago.
  if (notes.length > MAX_NOTES) {
    notes = notes.slice(notes.length - MAX_NOTES);
  }

  return notes;
};

/** Renders a profile as the compact block the agent reads. */
export const renderProfile = (profile: StudentProfile): string => {
  if (profile.notes.length === 0) {
    return "Todavía no sé nada de este estudiante.";
  }

  const byKind: Record<ProfileNoteKind, string> = {
    context: "Contexto",
    gap: "Puntos débiles",
    strength: "Puntos fuertes",
    preference: "Preferencias"
  };

  const order: readonly ProfileNoteKind[] = ["context", "gap", "strength", "preference"];
  const lines: string[] = [];

  for (const kind of order) {
    const notes = profile.notes.filter((note) => note.kind === kind);
    if (notes.length === 0) {
      continue;
    }

    lines.push(`${byKind[kind]}:`);
    for (const note of notes) {
      lines.push(`- [${note.id}] ${note.topic}: ${note.detail}`);
    }
    lines.push("");
  }

  return lines.join("\n").trim();
};

export class ProfileRepositoryStorageError extends Data.TaggedError("ProfileRepositoryStorageError")<{
  readonly reason: unknown;
}> { }

export interface ProfileRepository {
  readonly get: (
    studentId: string
  ) => Effect.Effect<StudentProfile, ProfileRepositoryStorageError>;
  readonly addNotes: (
    studentId: string,
    notes: readonly AddProfileNoteInput[]
  ) => Effect.Effect<StudentProfile, ProfileRepositoryStorageError>;
  readonly removeNote: (
    studentId: string,
    noteId: string
  ) => Effect.Effect<StudentProfile, ProfileRepositoryStorageError>;
  readonly clear: (
    studentId: string
  ) => Effect.Effect<StudentProfile, ProfileRepositoryStorageError>;
}

export const ProfileRepository = Context.Service<ProfileRepository>(
  "@proxus/server/student/ProfileRepository"
);
