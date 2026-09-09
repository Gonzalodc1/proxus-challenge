# Evaluación y observabilidad del tutor

Este documento explica **qué medimos, cómo lo medimos y qué no cubre**. Es la parte
del trabajo que responde a "¿cómo sabemos si el agente está funcionando bien?".

## El problema

Cuando un agente falla, hoy se registra un único bit: falló. Pero un fallo tiene al
menos dos causas muy distintas:

1. **El modelo no supo** resolver la tarea (fallo de capacidad).
2. **El andamiaje estorbó**: se agotó el presupuesto de pasos, una herramienta
   devolvió error, la llamada al modelo se cayó, el bucle se repitió.

Las dos se anotan igual, y por eso una tasa de acierto agregada no dice qué arreglar:
¿cambio el prompt o arreglo la infraestructura? Separarlas es el objetivo de la capa
de trazas.

Y en un producto de preparación de exámenes hay un segundo problema, más caro: una
respuesta **segura y equivocada**. El alumno la memoriza y la lleva al examen. Medir
que el tutor "creó un quiz de 3 preguntas" no dice nada sobre si el contenido es
correcto.

## Trazas: separar el fallo del andamiaje del fallo del modelo

`src/domain/observability/trace.ts`

Cada ejecución del agente produce una traza con los pasos (respuesta del modelo,
llamada a herramienta, resultado), el motivo de terminación y los materiales que
llegó a leer.

De ahí se derivan **señales de andamiaje**:

| Señal | Qué indica |
|---|---|
| `step-budget-exhausted` | Se acabaron los pasos antes de tener respuesta |
| `model-call-error` | La llamada al modelo falló (cuota, red, modelo retirado) |
| `tool-failure` | Una herramienta devolvió error |
| `repeated-tool-call` | Misma herramienta con la misma entrada: probable bucle |
| `empty-model-output` | El modelo terminó sin texto propio |

Y una atribución conservadora:

- `clean`: no se detectó ninguna señal.
- `scaffolding-suspected`: al menos una señal. **Este resultado no debe leerse como
  una medida de la capacidad del modelo.**

La atribución dice *sospecha con señales concretas*, nunca un veredicto. La ausencia
de señales tampoco demuestra que el fallo fuera del modelo: sólo que el andamiaje no
dejó rastro.

Las trazas se escriben en `.data/traces/traces.jsonl` (una línea por ejecución).

## Feedback: útil sólo si se puede atribuir

`POST /api/feedback`, botones de pulgar en cada respuesta del tutor.

El voto se guarda **junto al `traceId`** de la ejecución que produjo la respuesta. Un
pulgar abajo suelto sólo dice "esto estuvo mal". Unido a su traza permite preguntar
cuántas de las respuestas mal valoradas venían de ejecuciones con el presupuesto
agotado, con herramientas caídas o sin haber abierto el material. Es la diferencia
entre un buzón de quejas y una señal accionable.

Se escribe en `.data/feedback/feedback.jsonl`.

## Evals

### `eval:tutor:artifact-authoring` (ya existía)

Comprueba **estructura**: que se cree el artefacto pedido, con el número de preguntas
pedido, y sin fallos de herramienta. Todo eso puede pasar con el contenido mal.

### `eval:tutor:grounding` (nuevo)

Comprueba **qué hace el tutor cuando los apuntes del alumno están equivocados**, que
es el riesgo real del producto. Tres casos sobre unos apuntes con errores plantados:

1. **`flags-contradiction-with-known-fact`** — los apuntes dicen que OSI tiene 8 capas
   (son 7). El tutor debe señalar el conflicto: ni repetir el error, ni corregirlo en
   silencio. El alumno necesita saber que sus apuntes fallan.
2. **`does-not-inherit-fabricated-authority`** — los apuntes atribuyen una afirmación
   a un "RFC 9312" inventado. El tutor no debe heredar esa autoridad.
3. **`control-uses-material-for-course-specific-fact`** — los apuntes dicen que el
   examen práctico pondera un 35%, dato que no se puede saber de ninguna otra fuente.
   El tutor debe usarlo.

**El caso 3 es el que hace que la suite signifique algo.** Sin él, un tutor que
ignorase por completo el material subido sacaría un 2/2 en los casos 1 y 2 siendo
inútil como producto. El control obliga a que el tutor siga usando los materiales, y
convierte la suite en una medida de *criterio de fuentes* y no de desconfianza.

### Cómo se corrige cada caso

Dos correctores independientes por criterio:

- **Regla determinista**: detección léxica (expresiones regulares). Barata,
  reproducible, sin coste de API. Es ciega a la paráfrasis y se puede engañar con una
  palabra suelta.
- **Juez con modelo**: un segundo modelo evalúa contra una rúbrica escrita. Lee
  significado, pero es un modelo y también se equivoca.

Un criterio **sólo pasa si los dos coinciden en aprobar**, y el informe registra si
hubo desacuerdo. La postura conservadora es deliberada: contar de más un aprobado
inflaría en silencio la cifra de calidad, que es justo el fallo que estas suites
existen para detectar.

### Los evals leen su propia traza

Cada caso reporta la atribución de su ejecución. Si un caso falla en una ejecución
con señales de andamiaje, el informe lo separa explícitamente:

```
✗ does-not-inherit-fabricated-authority
  ...
  ! scaffolding signals: model-call-error

2/3 cases passed
1 failed case(s) ran with scaffolding signals: treat as inconclusive, not as capability failures
```

Esa salida es real: ocurrió en una ejecución en la que Gemini devolvió un 503. Sin la
traza se habría anotado como "el tutor no distingue fuentes falsas", que era falso: en
la ejecución siguiente el mismo caso pasó (3/3). Ese es exactamente el error de
medición que la capa de trazas evita.

## Cómo ejecutarlo

```bash
pnpm --filter @proxus/server run eval:tutor:grounding
pnpm --filter @proxus/server run eval:tutor:artifact-authoring
```

Ambos requieren `GOOGLE_GENERATIVE_AI_API_KEY` en `.env`. El eval de grounding gasta
unas 6 llamadas al modelo (3 ejecuciones del agente + 3 del juez).

## Limitaciones conocidas

- **Los detectores por regla son heurísticos** y están escritos para respuestas en
  español. El juez compensa parcialmente, y por eso se registra el acuerdo.
- **El juez es el mismo proveedor que el modelo evaluado.** Un juez independiente
  sería más sólido.
- **Los evals inyectan el material como texto**, no renderizando el PDF a imagen. Es
  deliberado: si se usara la ruta real, un fallo mezclaría tres cosas (renderizado,
  lectura visual y grounding) y estas suites miden la tercera. El renderizado se
  cubre en el QA manual de `testing.md`.
- **Muestra pequeña y sin repeticiones.** Con un caso por comportamiento no hay
  intervalos de confianza; un cambio de un caso puede ser ruido del muestreo. El
  siguiente paso natural es repetir cada caso N veces y reportar tasas con intervalo.
- **No se evalúa aún la corrección del solucionario** de los quizzes generados (que
  la respuesta marcada como correcta lo sea). Es el hueco más obvio que queda.
