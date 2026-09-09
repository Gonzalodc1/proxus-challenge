import { Effect, FileSystem, Layer, Path } from "effect";
import {
  ProfileRepository,
  ProfileRepositoryStorageError,
  mergeNotes,
  type AddProfileNoteInput,
  type ProfileRepository as ProfileRepositoryType,
  type StudentProfile
} from "../../domain/student/profile.ts";

/**
 * One JSON document per student, rewritten on change.
 *
 * A whole-file rewrite rather than an append log because a profile is current
 * state, not history: notes get refreshed and deleted, and the reader always
 * wants the latest view. Traces and feedback are append-only for the opposite
 * reason.
 */
export const FileProfileRepository = {
  make: (directory: string): Effect.Effect<ProfileRepositoryType, never, FileSystem.FileSystem | Path.Path> =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;

      const mapStorageError = (reason: unknown) => new ProfileRepositoryStorageError({ reason });
      const fileFor = (studentId: string) => path.join(directory, `${encodeURIComponent(studentId)}.json`);

      const empty = (studentId: string): StudentProfile => ({
        studentId,
        notes: [],
        updatedAt: new Date().toISOString()
      });

      const read = (studentId: string): Effect.Effect<StudentProfile, ProfileRepositoryStorageError> =>
        fs.exists(fileFor(studentId)).pipe(
          Effect.andThen((exists) =>
            exists
              ? fs.readFileString(fileFor(studentId)).pipe(
                  Effect.map((text) => {
                    try {
                      return JSON.parse(text) as StudentProfile;
                    } catch {
                      // A corrupted profile must not brick the tutor: an empty
                      // memory degrades the experience, an unreadable one would
                      // block every conversation.
                      return empty(studentId);
                    }
                  })
                )
              : Effect.succeed(empty(studentId))
          ),
          Effect.mapError(mapStorageError)
        );

      const write = (profile: StudentProfile): Effect.Effect<StudentProfile, ProfileRepositoryStorageError> =>
        fs.makeDirectory(directory, { recursive: true }).pipe(
          Effect.andThen(() => fs.writeFileString(
            fileFor(profile.studentId),
            `${JSON.stringify(profile, null, 2)}\n`
          )),
          Effect.mapError(mapStorageError),
          Effect.as(profile)
        );

      const addNotes = (studentId: string, incoming: readonly AddProfileNoteInput[]) =>
        read(studentId).pipe(
          Effect.andThen((profile) => {
            if (incoming.length === 0) {
              return Effect.succeed(profile);
            }

            const now = new Date().toISOString();
            return write({
              studentId,
              notes: mergeNotes(profile.notes, incoming, now, () => crypto.randomUUID().slice(0, 8)),
              updatedAt: now
            });
          })
        );

      const removeNote = (studentId: string, noteId: string) =>
        read(studentId).pipe(
          Effect.andThen((profile) => write({
            studentId,
            notes: profile.notes.filter((note) => note.id !== noteId),
            updatedAt: new Date().toISOString()
          }))
        );

      const clear = (studentId: string) => write(empty(studentId));

      return { get: read, addNotes, removeNote, clear };
    }),
  layer: (directory: string) => Layer.effect(ProfileRepository)(FileProfileRepository.make(directory))
};
