import { Effect } from "effect";
import * as Atom from "effect/unstable/reactivity/Atom";
import { ApiClient } from "../../api-client/client.ts";
import { apiRuntime } from "../../lib/runtime.ts";

/**
 * The tutor's memory, surfaced to the student it is about.
 *
 * Reactivity is keyed on "profile" so a deletion refreshes the panel, and on
 * "artifacts" too: submitting a quiz writes gaps into the profile server-side,
 * so the memory the student sees has to move when their marks do.
 */
export const profileQuery = apiRuntime
  .atom(
    ApiClient.use((client) => client.profile.get()).pipe(
      Effect.withSpan("profile.get", { kind: "client" })
    )
  )
  .pipe(Atom.keepAlive, Atom.withReactivity(["profile", "artifacts"]));

export const forgetProfileNoteAction = apiRuntime.fn(
  (noteId: string) =>
    ApiClient.use((client) => client.profile.removeNote({ params: { noteId } })).pipe(
      Effect.withSpan("profile.removeNote", { kind: "client" })
    ),
  { reactivityKeys: ["profile"] }
);

export const clearProfileAction = apiRuntime.fn(
  (_: void) =>
    ApiClient.use((client) => client.profile.clear()).pipe(
      Effect.withSpan("profile.clear", { kind: "client" })
    ),
  { reactivityKeys: ["profile"] }
);
