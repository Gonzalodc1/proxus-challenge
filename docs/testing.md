# Testing y QA

## Checks automáticos

Desde la raíz:

```bash
pnpm run typecheck
pnpm --filter @proxus/server run test:unit
pnpm --filter @proxus/web run build
```

`test:unit` no necesita API key ni red. Cubre justo lo que **no** debe depender del
modelo: el tokenizador de la CLI del harness, la reparación de escapes en los payloads
JSON y las reglas de la memoria del estudiante. Son 23 aserciones con `node:assert`, sin
framework de test.

Para backend solamente:

```bash
pnpm --filter @proxus/server run typecheck
```

## Evals / smoke tests AI

Requieren `.env` con `GOOGLE_GENERATIVE_AI_API_KEY`.

```bash
pnpm --filter @proxus/server run eval:tutor:scenarios
pnpm --filter @proxus/server run eval:tutor:grounding
pnpm --filter @proxus/server run eval:tutor:artifact-authoring
pnpm --filter @proxus/server run agent:tutor "Crea un quiz corto de una pregunta sobre variables cualitativas"
```

- **`scenarios`**: la suite de aceptación, diez escenarios, uno por capacidad. Escribe su
  informe en `.data/evals/scenarios-report.json`. Es la que hay que mirar primero.
- **`grounding`**: tres casos sobre el uso del material, uno de ellos de control.
- **`artifact-authoring`**: la suite heredada. **Es inestable**, entre 1 y 3 casos de 3
  según la ejecución, y la señal que aparece es `tool-failure`. Es la que más exprime el
  paso de JSON por la línea de comandos, que es un punto de diseño frágil reconocido en el
  README. Se deja así en lugar de relajar el criterio hasta que se ponga verde.

La metodología (regla determinista más juez con modelo, AND-gating, casos de control y
atribución de traza) está en [`evaluation.md`](./evaluation.md).

## QA manual recomendado

1. Arranca app completa:

   ```bash
   pnpm run dev
   ```

2. Abre `http://localhost:5173`.
3. Comprueba que la barra lateral lista materiales, artifacts y memoria.
4. Pregunta algo que esté en tu PDF: debe citar material y página. Pregunta algo que no
   esté: debe decir que no lo cubre en vez de rellenar el hueco.
5. Si tu material contiene un error, debe señalarlo en voz alta en lugar de repetirlo.
6. Pide al tutor crear un quiz. Debe crearlo como artefacto, remitirte al panel en una
   frase y **no** mostrar el id ni repetir las preguntas en el chat.
7. Resuélvelo. Una pregunta cada vez, con barra de progreso, y el panel se cierra con el
   botón o con `Esc`.
8. Verifica:
   - score total y corrección por pregunta,
   - que las fórmulas se ven renderizadas y no como LaTeX en crudo,
   - que en la pestaña Memoria ha aparecido sola una nota con lo que has fallado, y que
     se puede borrar,
   - que el pulgar de una respuesta escribe en `.data/feedback/feedback.jsonl` con su
     `traceId`,
   - que `.data/traces/traces.jsonl` registra la ejecución con sus pasos y su atribución,
   - layout sin panel cuando no hay artifact seleccionado.

## Qué reportar en una entrega

- Checks ejecutados y resultado.
- Flujo manual probado.
- Limitaciones conocidas.
- Si no se pudo probar AI por falta de API key, indícalo explícitamente.
