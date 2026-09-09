import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import { StudentProfile } from "../schemas/profile.ts";

export class ProfileApi extends HttpApiGroup.make("profile")
  .add(
    HttpApiEndpoint.get("get", "/", {
      success: StudentProfile
    }),
    // Every mutation answers with the profile as it now stands, so the client
    // never has to guess what the server ended up storing.
    HttpApiEndpoint.delete("removeNote", "/notes/:noteId", {
      params: {
        noteId: Schema.String
      },
      success: StudentProfile
    }),
    HttpApiEndpoint.delete("clear", "/", {
      success: StudentProfile
    })
  )
  .prefix("/profile")
{}
