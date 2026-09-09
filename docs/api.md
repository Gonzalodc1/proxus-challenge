# API

La API principal se define en `packages/shared/src/api/*` con Effect HTTP API.

En local:

- Docs interactivas: `http://localhost:3000/docs`
- OpenAPI JSON: `http://localhost:3000/openapi.json`

## Endpoints

### Tutor

```http
POST /api/tutor/chat
POST /api/tutor/chat/stream
```

`/stream` devuelve NDJSON:

```json
{ "type": "message", "message": {} }
{ "type": "done", "traceId": "834d0b48-..." }
```

La ruta streaming está implementada manualmente para soportar eventos incrementales.

El evento `done` lleva el `traceId` de la ejecución que acaba de terminar. Es lo que
permite que el voto de feedback en la UI apunte a la ejecución exacta que produjo esa
respuesta, en lugar de a un mensaje suelto.

### Materials

```http
GET /api/materials/
GET /api/materials/:id
GET /api/materials/:id/pdf
```

Los materiales representan PDFs disponibles para el tutor. El server puede renderizar páginas vía Poppler para que Gemini las procese como imágenes.

`/pdf` sirve el PDF original con `content-type: application/pdf` en modo `inline`, para
que la web pueda abrirlo en una pestaña nueva. Es una ruta manual, como el stream, porque
el HttpApi tipado está orientado a JSON con schema y no a binario.

El `id` de un material es un **slug** derivado del nombre del fichero
(`Redes - Fundamentos.pdf` da `redes-fundamentos`), mientras que el `title` conserva el
nombre legible. Los ids son direcciones y viajan como un único token por la CLI del
agente; los títulos son para personas.

### Artifacts

```http
GET /api/artifacts/
GET /api/artifacts/:id
POST /api/artifacts/:id/submit
```

`submit` crea y corrige un intento, devolviendo un attempt con estado `graded` cuando aplica.
Además deriva señales de aprendizaje de la corrección y las guarda en el perfil del
estudiante, sin pasar por el modelo.

### Feedback

```http
POST /api/feedback
```

Guarda la valoración de una respuesta del tutor (`up` / `down`) junto al `traceId` de la
ejecución que la produjo y un extracto. Se persiste como JSONL en
`.data/feedback/feedback.jsonl`.

### Profile

```http
GET    /api/profile/
DELETE /api/profile/notes/:noteId
DELETE /api/profile/
```

La memoria del estudiante entre conversaciones, como notas cortas y no como
transcripciones. Es legible y borrable desde la propia UI: si el producto guarda algo de
ti, tienes que poder verlo y quitarlo. Sin autenticación, todas las notas cuelgan de un
único estudiante local (`DEFAULT_STUDENT_ID`).

## Tipos de artifact

- `note`: contenido markdown.
- `quiz`: preguntas cerradas.
- `test`: preguntas cerradas o `short-answer`.

Tipos de pregunta:

- `multiple-choice`
- `true-false`
- `short-answer` solo para tests.

Formato correcto para multiple choice:

```json
{
  "type": "multiple-choice",
  "options": [
    { "id": "a", "text": "Respuesta A" },
    { "id": "b", "text": "Respuesta B" }
  ]
}
```

El CLI tolera options como strings y las normaliza, pero el contrato estable usa `{ id, text }`.

## Cliente web

- Cliente API: `packages/web/src/api-client/client.ts`
- Runtime Effect: `packages/web/src/lib/runtime.ts`
- Streaming tutor: `packages/web/src/domain/tutor/stream.ts`
