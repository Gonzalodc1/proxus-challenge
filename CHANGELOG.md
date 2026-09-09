# Changelog

Todo lo que he cambiado sobre la base del challenge, con el porqué de cada cosa.

Está ordenado por áreas y no por orden cronológico, para poder repasarlo de arriba abajo
sin saltos. Cada línea es un cambio: **qué** en negrita y **por qué** justo detrás. Los
fallos que fui encontrando por el camino tienen su propia sección al final, porque son la
parte que más me interesa contar.

---

## Índice

| Sección | De qué va |
| --- | --- |
| [1. Fiabilidad del tutor](#1-fiabilidad-del-tutor) | Trazas, atribución de fallo, grounding y feedback |
| [2. Evaluación](#2-evaluación) | Las tres suites, cómo se corrigen y por qué así |
| [3. Memoria del alumno](#3-memoria-del-alumno) | Qué recuerda, cómo se llena y cómo se borra |
| [4. El agente](#4-el-agente) | System prompt, skills, harness y CLI |
| [5. Interfaz](#5-interfaz) | Chat, panel de estudio, quiz y tema |
| [6. Arranque y portabilidad](#6-arranque-y-portabilidad) | Que funcione en cualquier máquina |
| [7. Documentación](#7-documentación) | README, docs heredadas e informe de evals |
| [8. Los fallos que encontré](#8-los-fallos-que-encontré) | Seis, y cómo llegué a cada uno |
| [9. Verificación](#9-verificación) | Qué he ejecutado y con qué resultado |
| [10. Pendiente](#10-pendiente) | Qué haría con más tiempo |

---

## 1. Fiabilidad del tutor

**El problema de partida:** el sistema no sabía si lo estaba haciendo bien, y cuando algo
salía mal solo guardaba un bit. Un fallo puede venir de tres sitios y cada uno se arregla
en un sitio distinto: que el modelo no supiera (capacidad), que el modelo lo hiciera bien y
se cruzara mi código (andamiaje), o que nadie le haya dicho que tenía que hacer eso
(especificación).

### Trazas de ejecución
`domain/observability/trace.ts`, `infra/observability/file-trace-repository.ts`

- **Cada ejecución deja una traza en JSONL.** Pasos, tools llamadas, duración, por qué
  terminó, señales y atribución. Sin esto no se puede diagnosticar nada después de los
  hechos sin volver a ejecutar la tarea.
- **Cinco señales de andamiaje con nombre:** `tool-failure`, `step-budget-exhausted`,
  `model-call-error`, `repeated-tool-call`, `empty-model-output`. Nombrarlas es lo que
  permite decir *por qué* se sospecha del andamiaje y no solo *que* se sospecha.
- **Dos valores de atribución:** `clean` si no hay señales, `scaffolding-suspected` si hay
  alguna. Binario a propósito, porque un tercer valor intermedio invitaría a interpretarlo
  como veredicto.
- **La atribución es conservadora.** Reporta sospecha respaldada por evidencia, nunca un
  veredicto. Que salga `clean` no prueba que el fallo fuera del modelo, solo que no
  encontré pruebas de lo contrario.
- **Tres razones de terminación:** `completed`, `max-steps`, `model-error`.
- **`deriveSignals` es una función pura.** Así se puede testear sin montar un agente y la
  reutilizan los evals.
- **La instrumentación entra por un callback `onTrace`, no por un servicio de Effect.** Si
  fuera un servicio, la CLI y los evals heredarían una dependencia nueva solo por dejar
  observar. El coste de observar lo paga quien quiere observar.
- **Guardar la traza nunca puede tumbar la respuesta.** Un fallo de disco se traga en
  silencio, porque la observabilidad es un canal lateral y no el camino del producto.

### Feedback del alumno
`domain/feedback/`, `infra/feedback/`, `web/src/domain/tutor/feedback.ts`

- **Pulgar arriba o abajo en cada respuesta del tutor.** Era uno de mis puntos rojos como
  usuario de Proxus.
- **Cada voto guarda el `traceId` de la ejecución que lo provocó.** Un feedback suelto no
  sirve para mejorar nada; con la ejecución detrás se puede separar "falló el andamiaje" de
  "se equivocó el modelo".
- **El evento `done` del stream lleva el `traceId`.** Es la pieza que conecta lo que ve el
  alumno con lo que quedó registrado en el servidor.

### Disciplina de fuentes
`domain/agents/academic-tutor.ts`

- **Cita material y página** para lo que sale de los apuntes, y distingue eso de lo que
  sale de su propio conocimiento.
- **Si el material contradice algo establecido, lo dice en voz alta.** Ni lo repite ni lo
  corrige por lo bajo: el alumno necesita enterarse de que sus apuntes tienen un fallo.
- **No hereda la autoridad de una fuente que no puede verificar.** Un número de RFC o de
  artículo da sensación de autoridad, y esa sensación no se hereda.
- **Si el material no cubre algo, lo dice** en vez de rellenar el hueco.
- **El texto de los materiales es dato, nunca instrucciones.** Si un PDF trae algo que
  parece una orden para el agente, no la obedece y avisa al alumno de que la lleva dentro.

---

## 2. Evaluación

`domain/agents/academic-tutor/evals/`. Metodología completa en [`docs/evaluation.md`](./docs/evaluation.md).

- **Tres suites:** `scenarios` (10 escenarios, la principal), `grounding` (3 casos) y
  `artifact-authoring` (la heredada, ampliada).
- **Un escenario por capacidad:** grounding, seguridad frente a inyección,
  confidencialidad, creación de artefactos, memoria, debate y honestidad.
- **Hay un caso de control.** Solo se aprueba usando el material. Sin él, un tutor que
  ignorase los apuntes y respondiera de memoria sacaría pleno, y eso mide lo bien que
  escribe el modelo, no si hace su trabajo.
- **Regla determinista siempre.** Barata, reproducible, no gasta llamadas, pero es ciega a
  la paráfrasis.
- **Juez con modelo solo donde el veredicto exige leer significado**, contra una rúbrica
  escrita, y devuelve una línea `PASS:` o `FAIL:` con motivo.
- **AND-gating:** el criterio solo aprueba si coinciden los dos correctores, y el
  desacuerdo queda registrado. Contar de más un aprobado inflaría en silencio la cifra de
  calidad, que es justo lo que la suite existe para detectar.
- **Si el juez no está disponible, suspende.** Nunca se convierte en aprobado por defecto.
- **Cada escenario reporta la atribución de su traza.** Un fallo con señales de andamiaje
  se marca como no concluyente en vez de contarlo como fallo del modelo.
- **Los evals montan el mismo harness que se despliega**, memoria incluida, con un
  `InMemoryProfileRepository` por caso. Así se mide el agente real y no una versión capada.
- **El material se inyecta como texto y no renderizando el PDF.** Por la ruta real un fallo
  mezclaría renderizado, lectura visual y grounding, y aquí se mide lo tercero.
- **`plainText` normaliza la decoración LaTeX antes de cualquier regla léxica.** Añadido
  después de que una regla suspendiera una respuesta correcta por venir escrita como
  `$35\%$` (ver [fallo 5](#8-los-fallos-que-encontré)).
- **La suite escribe su informe en JSON**, y de ahí sale el PDF de
  [`docs/informe-evals-magia.pdf`](./docs/informe-evals-magia.pdf) con las respuestas
  literales del agente.

---

## 3. Memoria del alumno

`domain/student/`, `infra/student/`, `web/src/domain/profile/`

- **El chat es stateless:** el navegador reenvía el historial en cada turno y nada
  sobrevive a un refresco. Por eso hacía falta una memoria aparte, o MagIA empieza de cero
  siempre y para preparar un examen eso es la diferencia entre un buscador y un tutor.
- **Guarda notas, no transcripciones.** Cuatro tipos: `gap` (lo que falla), `strength` (lo
  que domina), `preference` (cómo le gusta que le enseñen) y `context` (fechas, asignatura).
- **Los quizzes la alimentan solos.** `notesFromAttempt` deriva las notas de la corrección,
  de forma pura y determinista, sin pasar por el modelo. Si al corregir ya sabes qué ha
  fallado, gastar una generación en redescubrirlo es más lento, más caro y menos fiable.
- **También guarda los aciertos.** Sin eso el perfil solo acumularía debilidades, y un
  tutor que solo recuerda tus fracasos es peor profesor.
- **Repetir una observación refresca la nota, no la duplica.** Quien falla el mismo tema
  tres veces debe salir con un hueco actual, no con tres líneas iguales compitiendo por
  espacio de prompt.
- **Tope de 60 notas.** El perfil se inyecta en el prompt, así que es un coste recurrente
  por conversación y no un coste de disco de una vez.
- **Se puede ver y borrar desde la barra lateral, nota a nota.** Si un producto guarda
  cosas tuyas, tienes que poder mirarlas y quitarlas.
- **Escribir en la memoria nunca puede tumbar una entrega.** En el handler de `submit` va
  envuelto para que un fallo se trague: las notas del alumno son el producto, el perfil es
  un efecto lateral.

---

## 4. El agente

### System prompt
`domain/agents/academic-tutor.ts`

- **Todo el producto en español**, respuestas incluidas, aunque las instrucciones internas
  y los nombres de comandos estén en inglés.
- **La identidad y la pedagogía van en `name`; las reglas de funcionamiento en
  `instructions`**, que se concatena *después* del andamiaje generado.
- **Por qué las reglas van al final:** el andamiaje del medio enumera las skills
  disponibles, así que una regla de confidencialidad tiene que venir después para poder
  aplicarse a esa lista. Y lo que va al final es lo menos diluido por todo lo de en medio.
- **Confidencialidad:** no enumera herramientas, comandos, skills ni configuración, pero
  tampoco miente diciendo que no las tiene. Ser reservado no es mentir.
- **Anti-invención:** "no lo sé" es una respuesta aceptable, inventarse citas, páginas,
  cifras o normativa no lo es.
- **Regla de enrutado de material:** un quiz o un test se crea SIEMPRE como artefacto,
  nunca como texto en el chat. Añadida tras el [fallo 4](#8-los-fallos-que-encontré).
- **Reglas de fórmulas:** LaTeX con `$ ... $` y `$$ ... $$`, mismo delimitador al abrir y
  cerrar, nada de `\( \)` ni `\[ \]`, y un número o un porcentaje suelto en la prosa no es
  una fórmula.
- **Tono:** cercano pero nunca complaciente, sin halagos de apertura y sin dar la razón por
  agradar.

### Skills
`domain/agents/academic-tutor/skills/`

- **`remember-the-student`** (nueva): cuándo consultar y cuándo escribir en la memoria.
- **`debate-with-the-student`** (nueva): abogado del diablo, sin nota y sin corrección,
  concediendo cuando el alumno tiene razón y deshaciendo la postura antes de cerrar.
- **`use-uploaded-materials`:** cambiada la instrucción de tratar las páginas como fuente
  de verdad por la disciplina de fuentes.
- **`create-study-artifacts`:** los artefactos viven en el panel, no se repiten en el chat,
  y ahora también lleva las reglas de fórmulas con la advertencia de preferir notación sin
  barra invertida para no pelearse con el escapado dentro del JSON.

### Harness y CLI
`domain/agents/harness/`

- **Tokenizador greedy hasta la última comilla.** Los payloads que viajan por la CLI son
  JSON y contienen el otro tipo de comilla (ver [fallo 1](#8-los-fallos-que-encontré)).
- **`repairInvalidQuoteEscapes`** convierte `\'` en `'`. JSON no tiene ese escape, así que
  la reparación es inequívoca y no hay documento correcto que pueda corromper.
- **El id de un material es un slug** y el título conserva el nombre del fichero. Los ids
  son direcciones y los títulos son para personas (ver
  [fallo 6](#8-los-fallos-que-encontré)).
- **Solo un resultado de tool que sea texto puede hacer de respuesta.** Antes se coercía
  con `String(...)` y el alumno podía recibir un `[object Object]`.
- **Mensaje honesto al agotar los pasos**, en español, en vez de fingir que el turno salió
  bien. La traza sigue registrando `step-budget-exhausted`.
- **Corregido: el modelo informado no era el que se usaba.** `AiModel.make` recibía una
  constante mientras la llamada HTTP usaba `GEMINI_MODEL`. Un eval podía atribuir un
  resultado a un modelo que nunca lo ejecutó.

---

## 5. Interfaz

### Chat
`web/src/components/Chat.tsx`

- **Ocultadas las llamadas a herramientas.** Son fontanería del agente, no contenido para
  el alumno. Con un indicador de "pensando" para que no parezca congelado.
- **Enter envía, Ctrl+Enter y Shift+Enter hacen salto de línea**, insertado en la posición
  real del cursor.
- **Botón de copiar** en cada respuesta del tutor.
- **Tecleo progresivo** con número fijo de pasos y techo de 1200 ms, porque el renderizador
  de markdown reparsea en cada repintado y sin el techo se arrastraba.
- **Sugerencias de seguimiento como botones**, que rellenan el chat en vez de obligar a
  escribirlas. Era otro de mis puntos como usuario.
- **Las sugerencias solo aparecen cuando aportan**, no después de cada respuesta.
- **Mensajes sin etiquetas "YOU"/"TUTOR"**: se distinguen por alineación y color.

### Panel de estudio
`web/src/components/ArtifactWorkspace.tsx`

- **Una pregunta cada vez**, con barra de progreso donde cada pregunta es un punto
  clicable, y animación de deslizamiento que respeta `prefers-reduced-motion`.
- **Modo revisión al terminar**, con la corrección y la explicación por pregunta.
- **Botón de cerrar y atajo `Esc`.** El panel ocupaba un tercio de la pantalla y no había
  forma de quitarlo.
- **`Esc` se escucha en el documento y no en el panel**, porque justo después de que el
  tutor abra un artefacto el foco casi nunca está dentro.
- **Las matemáticas se renderizan** en enunciados, opciones y explicaciones. Eran cadenas
  interpoladas en JSX, o sea el sitio donde más probable es que haya una fórmula era el
  único que no podía pintarla.

### Barra lateral y tema
`web/src/components/Sidebar.tsx`, `web/src/styles.input.css`

- **Marca PROXUS y navegación vertical:** Materiales, Estudio y Memoria, con contador.
- **Panel de memoria con borrado por nota.**
- **Los materiales abren el PDF en una pestaña nueva**, con flecha diagonal, servidos por
  `GET /api/materials/:id/pdf`.
- **La flecha diagonal solo donde de verdad se abre una pestaña.** Era un punto amarillo
  mío como usuario de Proxus.
- **Ocultado el id del artifact**, que no le dice nada a nadie.
- **Tema claro y oscuro con botón**, guardado en `localStorage` y aplicado antes del primer
  pintado para que no dé el flash. Implementado redefiniendo la escala de color en un solo
  sitio, sin tocar las ~92 clases de los componentes.
- **Acento violeta de la marca** en lugar del azul original, y el chat renombrado a MagIA.

---

## 6. Arranque y portabilidad

- **`pnpm run dev` funciona en Windows.** El script original usaba `sh -c '... & vite; kill
  $!'`, que necesita una shell POSIX. Sustituido por `packages/web/scripts/dev.mjs`, sin
  dependencias nuevas.
- **Los binarios se lanzan por `process.execPath`** y el `bin` de su propio `package.json`,
  para esquivar los shims `.cmd` que no se pueden spawnear sin shell.
- **Tailwind con `--watch=always`**, porque el CLI deja de vigilar cuando se le cierra
  stdin, que es justo lo que le pasa a un proceso hijo.
- **El puerto de la web ya no depende de `PORT`.** `PORT` es el de la API; con un `PORT` en
  el entorno los dos servidores intentaban el mismo puerto.
- **El proceso de la web también carga `.env`**, que antes solo cargaba el del servidor, así
  que `WEB_PORT` no llegaba nunca.
- **`GEMINI_MODEL` por defecto es un modelo vigente.** El anterior ya no se sirve a claves
  nuevas: quien clonara y arrancara se comía un 404 en la primera llamada.
- **El error de Gemini dice el estado HTTP y el modelo pedido**, no solo el payload crudo.
  Una clave mala y un modelo retirado llegaban al mismo sitio y se arreglan al revés.

---

## 7. Documentación

- **README reescrito** con la estructura que pide `CHALLENGE.md`: qué problema elegí, cómo
  lo resolví, cómo probarlo, qué checks ejecuté y qué haría después, más los límites
  conocidos.
- **`docs/evaluation.md`** (nuevo) con la metodología de evaluación y observabilidad.
- **`docs/api.md`** al día: los cinco endpoints nuevos, el `traceId` del evento `done`, los
  ids en slug y una ruta a un fichero que ya no existía.
- **`docs/data.md`** con los tres almacenes nuevos y el aviso de dato personal en las
  trazas.
- **`docs/architecture.md`** con los dominios y adaptadores nuevos en el diagrama y en las
  listas.
- **`docs/testing.md`** con las tres suites, `test:unit`, y la fiabilidad real de cada una.
- **El informe de evals sale de `.data`** a `docs/`, porque `.data` está en `.gitignore` y
  la prueba de que la suite pasa no habría viajado con la entrega.

---

## 8. Los fallos que encontré

Seis, y los seis diagnosticados desde la traza y no desde un debugger. Todos resultaron ser
culpa del andamiaje o de la especificación, ninguno del modelo.

### 1. `Unexpected argument: int`

- **Síntoma:** pedir un quiz de Python fallaba.
- **La traza:** `tool-failure`, y el comando que el modelo había escrito era correcto según
  su skill.
- **La causa:** una opción como `1 y <class 'int'>` dentro de un argumento entrecomillado
  con comillas simples cerraba el token antes de tiempo y dejaba `int` suelto.
- **El arreglo:** tokenizador greedy hasta la última comilla. El coste es que un comando con
  dos argumentos entrecomillados por separado se leería como uno, y ningún comando hacía eso.

### 2. Escapes que no existen en JSON

- **Síntoma:** el mismo quiz seguía fallando después de arreglar lo anterior.
- **La causa:** el modelo escapaba los apóstrofos por precaución (`\'`), y JSON no tiene ese
  escape, así que el parseo moría con contenido por lo demás válido.
- **El arreglo:** `repairInvalidQuoteEscapes`, más una regla en la skill para que no lo haga.
  La reparación es inequívoca, no una adivinanza.

### 3. El modelo informado no era el usado

- **La causa:** `AiModel.make` recibía una constante mientras la llamada HTTP leía
  `GEMINI_MODEL`.
- **Por qué importa:** un eval o una traza podían atribuir un resultado a un modelo que
  nunca lo ejecutó, y el experimento deja de ser reproducible.

### 4. El quiz escrito en el chat (9 de 10)

- **Síntoma:** el escenario `artefacto-sin-id-ni-duplicado` falló en la primera ejecución
  completa de la suite.
- **La traza:** un solo paso, ninguna tool, atribución `clean`.
- **Qué me dio eso:** descartó de entrada las dos explicaciones que habría mirado primero,
  caída de infraestructura y error de parseo. No era ninguna.
- **La causa:** nada obligaba a que un quiz fuera siempre un artefacto, y la skill que lo
  dice solo se carga si el modelo decide cargarla. Fallo de especificación.
- **El arreglo:** regla explícita en el system prompt. Segunda ejecución, 10 de 10.

### 5. Mi propia regla rompió mi propio corrector

- **Síntoma:** tras añadir las reglas de fórmulas, la suite bajó a 9 y luego a 7 de 10.
- **Las trazas:** todas `clean`. Ninguna bajada era una regresión de capacidad.
- **Las causas, tres a la vez:**
  - El tutor respondió `un $35\%$ de la nota`, que es correcto, y la regla buscaba `35%`
    literal.
  - Dos reglas enumeraban redacciones en vez de describir comportamientos: *"Dime una
    situación en la que elegirías UDP"* devuelve la pelota aunque no lleve interrogación, y
    *"No tengo registrada esa nota"* admite no saberlo aunque no diga "no lo sé". El juez
    aprobaba las dos y la regla las suspendía.
  - La suite heredada aprobaba si la respuesta contenía el **id** del artefacto, que es
    justo lo que el escenario nuevo suspende. Dos suites afirmando lo contrario.
- **El arreglo:** un normalizador `plainText` centralizado, las dos reglas ampliadas al
  comportamiento que nombra la rúbrica, y el criterio heredado alineado con el producto.
- **Lo incómodo:** el 10 de 10 anterior aprobaba en parte porque el modelo redactaba como
  esperaban mis expresiones regulares. Es la fragilidad que ya estaba escrita como
  limitación, demostrada.

### 6. `[object Object]` como respuesta

- **Síntoma:** ensayando la demo, la primera pregunta devolvía literalmente eso.
- **La traza:** 8 pasos, `max-steps`, `scaffolding-suspected` con cuatro señales. El agente
  intentó el material sin comillas, con guiones, con cada argumento entrecomillado por
  separado, con `--help`, y solo entonces dio con la forma buena. Se quedó sin presupuesto
  por el camino.
- **La causa:** el id de un material era el nombre del fichero con espacios, así que
  `materials view <id> <pages>` pedía el id entrecomillado y el rango sin comillas. El
  modelo no hizo nada mal, la gramática era hostil.
- **El arreglo:** ids en slug, títulos legibles aparte, y `getFile` acepta también el
  título. Y al agotar los pasos ya no se coacciona un objeto a string.
- **Después:** misma pregunta, 4 pasos, `completed`, `clean`.

---

## 9. Verificación

- **`pnpm run typecheck`:** limpio en los 4 paquetes.
- **`pnpm --filter @proxus/server run test:unit`:** 23 aserciones, con `node:assert` y sin
  framework nuevo. Cubren el tokenizador de la CLI, la reparación de escapes JSON y las
  reglas de la memoria.
- **`pnpm --filter @proxus/web run build`:** correcto.
- **`eval:tutor:scenarios`:** 10 de 10 con `gemini-3.5-flash-lite`.
- **`eval:tutor:grounding`:** 3 de 3.
- **`eval:tutor:artifact-authoring`:** inestable, entre 1 y 3 casos de 3 según la ejecución,
  con señal `tool-failure`. Es la que más exprime el paso de JSON por línea de comandos. Se
  deja así en vez de relajar el criterio hasta que se ponga verde.
- **Clon limpio:** `pnpm install --frozen-lockfile`, typecheck, tests y build, para no
  fiarme de mi carpeta de trabajo.
- **Recorrido completo de la demo** contra el servidor real, acto por acto.
- **Variación observada:** corriendo la suite tres veces sin tocar ese camino,
  `memoria-guarda-lo-relevante` falló una vez y pasó las otras dos. Es ruido de muestreo, no
  una regresión, y es el mejor argumento para repetir cada caso N veces.
- **Dos dependencias nuevas en total:** `@streamdown/math` y `katex`.

---

## 10. Pendiente

Por orden de lo que haría primero.

1. **Citas como elemento de interfaz y no como prosa**, con referencia clicable que abra el
   PDF por esa página. Hoy el alumno se tiene que fiar de que el modelo escriba bien la cita.
2. **Sacar el JSON de los artefactos de la línea de comandos.** Es frágil de nacimiento y
   dos de los fallos de arriba salen de ahí. Una tool con el objeto ya estructurado se carga
   la clase entera de errores en vez de tolerarlos.
3. **Evaluar que el solucionario de los quizzes sea correcto**, o sea que la opción marcada
   como buena lo sea.
4. **Repetir cada caso N veces** y dar tasas con intervalo de confianza.
5. **Un panel de trazas y feedback** que cruce respuestas mal valoradas con las señales de
   andamiaje de su ejecución. Hoy está todo en JSONL y hay que leerlo a mano.
6. **Cuentas, memoria aislada por usuario y minimizar el dato personal en las trazas.** Los
   tres son el mismo trabajo.
7. **Juez independiente**, de otro proveedor distinto al del modelo evaluado.
8. **Streaming real de tokens.** `streamText` no está implementado en el adaptador de
   Gemini, así que el tecleo progresivo es un efecto de cliente.
9. **Evaluar el modo debate**, que hoy está cubierto por el prompt y probado a mano.
10. **Evaluar el renderizado de fórmulas**, que depende de que el modelo respete los
    delimitadores y no hay ningún caso que lo mida.
11. **`POST /artifacts/:id/submit` exige `artifactId` en el cuerpo** además de en la ruta.
    Redundancia heredada del contrato.
