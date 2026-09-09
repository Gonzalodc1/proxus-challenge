import { Effect, Schema } from "effect";
import * as AgentCli from "../harness/index.ts";
import { repairInvalidQuoteEscapes } from "../harness/json-payload.ts";
import {
  renderProfile,
  type AddProfileNoteInput,
  type ProfileRepository,
  type ProfileRepositoryStorageError
} from "../../student/profile.ts";

const NoteInput = Schema.Struct({
  kind: Schema.Union([
    Schema.Literal("gap"),
    Schema.Literal("strength"),
    Schema.Literal("preference"),
    Schema.Literal("context")
  ]),
  topic: Schema.String,
  detail: Schema.String
});

// Models send either one object or a list; accepting both saves a retry.
const RememberInput = Schema.Union([NoteInput, Schema.Array(NoteInput)]);
const RememberInputFromJson = Schema.fromJsonString(RememberInput);

const renderProfileError = (error: ProfileRepositoryStorageError | { readonly _tag: string; readonly reason?: unknown }) =>
  `No se pudo acceder al perfil del estudiante: ${String("reason" in error ? error.reason : error._tag)}`;

const decodeRememberInput = (json: string) =>
  Schema.decodeUnknownEffect(RememberInputFromJson)(repairInvalidQuoteEscapes(json)).pipe(
    Effect.map((decoded): readonly AddProfileNoteInput[] =>
      (Array.isArray(decoded) ? decoded : [decoded]).map((note) => ({
        kind: note.kind,
        topic: note.topic,
        detail: note.detail,
        // Anything the agent writes itself came out of the conversation. Quiz
        // results are recorded separately and deterministically, so the source
        // stays a fact rather than something the model can claim.
        source: "chat" as const
      }))
    ),
    Effect.mapError((reason) =>
      `JSON de nota inválido: ${String(reason)}\n\nUsa profile remember --help para ver el formato.`
    )
  );

export const makeProfileCommands = (repository: ProfileRepository, studentId: string) => {
  const show = AgentCli.Command.withExamples([
    { command: "profile show", description: "Ver lo que recuerdas del estudiante" }
  ])(
    AgentCli.Command.withDescription("Mostrar lo que ya sabes del estudiante")(
      AgentCli.Command.exec("show", {}, () =>
        repository.get(studentId).pipe(
          Effect.map(renderProfile),
          Effect.catch((error) => Effect.succeed(renderProfileError(error)))
        )
      )
    )
  );

  const remember = AgentCli.Command.withExamples([
    {
      command: `profile remember '{"kind":"context","topic":"Examen","detail":"tiene el parcial de Redes el 20 de junio"}'`,
      description: "Guardar un dato de contexto"
    },
    {
      command: `profile remember '[{"kind":"gap","topic":"Bucles","detail":"confunde while con for"},{"kind":"preference","topic":"Explicaciones","detail":"prefiere ejemplos antes que teoría"}]'`,
      description: "Guardar varias notas a la vez"
    }
  ])(
    AgentCli.Command.withDescription("Guardar una o varias notas sobre el estudiante")(
      AgentCli.Command.exec("remember", {
        json: AgentCli.Argument.string("json").pipe(
          AgentCli.Argument.withDescription("Nota o lista de notas: kind (gap|strength|preference|context), topic, detail")
        )
      }, ({ json }) =>
        decodeRememberInput(json).pipe(
          Effect.andThen((notes) => repository.addNotes(studentId, notes)),
          Effect.map((profile) => `Guardado. Perfil actual:\n\n${renderProfile(profile)}`),
          Effect.catch((error) => Effect.succeed(
            typeof error === "string" ? error : renderProfileError(error)
          ))
        )
      )
    )
  );

  const forget = AgentCli.Command.withExamples([
    { command: "profile forget a1b2c3d4", description: "Borrar una nota por su id" }
  ])(
    AgentCli.Command.withDescription("Borrar una nota del perfil cuando deje de ser cierta")(
      AgentCli.Command.exec("forget", {
        noteId: AgentCli.Argument.string("noteId").pipe(
          AgentCli.Argument.withDescription("Id de la nota, visible entre corchetes en profile show")
        )
      }, ({ noteId }) =>
        repository.removeNote(studentId, noteId).pipe(
          Effect.map((profile) => `Olvidado. Perfil actual:\n\n${renderProfile(profile)}`),
          Effect.catch((error) => Effect.succeed(renderProfileError(error)))
        )
      )
    )
  );

  return AgentCli.Command.group("profile", [show, remember, forget] as const).pipe(
    AgentCli.Command.withDescription("Memoria del tutor sobre este estudiante")
  );
};
