import { Effect, Layer, Schema, Stream } from "effect";
import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http";
import { HttpApiBuilder, HttpApiScalar } from "effect/unstable/httpapi";
import { LanguageModel } from "effect/unstable/ai";
import { ProxusApi, TutorChatRequest, TutorChatStreamEvent } from "@proxus/shared";
import { MaterialRepository } from "../../domain/materials/material.ts";
import { GeminiModel } from "../../domain/agents/gemini.ts";
import { TutorChatService, TutorChatServiceLive } from "../../domain/agents/academic-tutor/tutor-chat-service.ts";
import { FileArtifactRepository } from "../../infra/artifacts/file-artifact-repository.ts";
import { FileFeedbackRepository } from "../../infra/feedback/file-feedback-repository.ts";
import { FileTraceRepository } from "../../infra/observability/file-trace-repository.ts";
import { FileProfileRepository } from "../../infra/student/file-profile-repository.ts";
import { FileMaterialRepository } from "../../infra/materials/file-material-repository.ts";
import { PopplerPdfService } from "../../infra/materials/poppler-pdf-service.ts";
import { HttpHandlersLive } from "./handlers.ts";

const ApiRoutes = HttpApiBuilder.layer(ProxusApi, {
  openapiPath: "/openapi.json"
}).pipe(
  Layer.provide(HttpHandlersLive)
);

const DocsRoute = HttpApiScalar.layer(ProxusApi, {
  path: "/docs"
});

const encoder = new TextEncoder();

const encodeNdjson = (event: TutorChatStreamEvent) =>
  encoder.encode(`${JSON.stringify(Schema.encodeSync(TutorChatStreamEvent)(event))}\n`);

const TutorStreamRoute = HttpRouter.add("POST", "/api/tutor/chat/stream", () =>
  Effect.gen(function* () {
    const input = yield* HttpServerRequest.schemaBodyJson(TutorChatRequest);
    const tutor = yield* TutorChatService;
    const languageModel = yield* LanguageModel.LanguageModel;
    const body = tutor.streamMessage(input).pipe(
      Stream.provideService(LanguageModel.LanguageModel, languageModel),
      Stream.map(encodeNdjson)
    );

    return HttpServerResponse.stream(body, {
      contentType: "application/x-ndjson",
      headers: {
        "cache-control": "no-cache",
        "x-accel-buffering": "no"
      }
    });
  })
);

// Serves the raw source PDF so the UI can open a material in a new tab.
// Manual route (like the NDJSON stream) because the typed HttpApi is oriented
// to schema-shaped JSON, not binary responses. Base path mirrors the one the
// FileMaterialRepository is mounted on below.
const MaterialPdfRoute = HttpRouter.add("GET", "/api/materials/:id/pdf", () =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const materials = yield* MaterialRepository;

    // Path is /api/materials/<id>/pdf; pull the id segment out of the raw url.
    const rawPath = request.url.split("?")[0] ?? request.url;
    const segments = rawPath.split("/").filter((segment) => segment.length > 0);
    const idSegment = segments[2];
    const id = segments.length >= 4 && idSegment !== undefined ? decodeURIComponent(idSegment) : undefined;

    if (id === undefined) {
      return HttpServerResponse.empty({ status: 400 });
    }

    const material = yield* Effect.orDie(materials.get(id));
    const bytes = yield* Effect.promise(() => readFile(`.data/materials/pdfs/${material.fileName}`));

    return HttpServerResponse.uint8Array(bytes, {
      contentType: "application/pdf",
      headers: {
        "content-disposition": `inline; filename="${material.fileName}"`,
        "cache-control": "no-store"
      }
    });
  })
);

const Routes = Layer.mergeAll(ApiRoutes, DocsRoute, TutorStreamRoute, MaterialPdfRoute);

const DomainLive = Layer.mergeAll(
  TutorChatServiceLive,
  GeminiModel
);

const InfraLive = Layer.mergeAll(
  FileMaterialRepository.layer(".data/materials/pdfs").pipe(
    Layer.provide(PopplerPdfService.layer)
  ),
  FileArtifactRepository.layer(".data/artifacts"),
  FileTraceRepository.layer(".data/traces"),
  FileFeedbackRepository.layer(".data/feedback"),
  FileProfileRepository.layer(".data/profiles")
);

export const HttpServerLive = HttpRouter.serve(Routes).pipe(
  Layer.provide(DomainLive),
  Layer.provide(InfraLive),
  Layer.provide(NodeHttpServer.layer(
    () => createServer(),
    { port: Number(process.env.PORT ?? "3000") }
  ))
);
