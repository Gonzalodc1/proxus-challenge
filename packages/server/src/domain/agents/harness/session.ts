import { Effect, Queue, Stream } from "effect";
import { LanguageModel, Prompt, Response, Tool } from "effect/unstable/ai";
import type { AgentHarness, AgentToolkit } from "./harness.ts";
import { isMaterialPageImages } from "../../materials/material.ts";
import { AgentMessage, type AgentMessage as AgentMessageType } from "./message.ts";
import {
  attributionFor,
  deriveSignals,
  type AgentTrace,
  type TerminationReason,
  type TraceStep
} from "../../observability/trace.ts";

export interface AgentSessionRunOptions {
  readonly maxSteps?: number;
  /** Correlates the trace with a stored conversation. */
  readonly sessionId?: string;
  /**
   * Called once when the run ends, with the execution trace.
   *
   * Deliberately a callback instead of a `TraceRepository` dependency: the
   * harness stays free of infrastructure, so callers that do not care about
   * persistence (the CLI, the evals) are unaffected and their Effect
   * requirements do not change.
   */
  readonly onTrace?: (trace: AgentTrace) => Effect.Effect<void>;
}

export interface AgentSessionRunInput extends AgentSessionRunOptions {
  readonly input: string;
  readonly messages?: readonly AgentMessageType[];
}

export interface AgentSessionRunResult {
  readonly output: string;
  readonly newMessages: readonly AgentMessageType[];
  readonly messages: readonly AgentMessageType[];
  readonly trace: AgentTrace;
}

export interface AgentSession {
  readonly run: (
    input: AgentSessionRunInput
  ) => Effect.Effect<AgentSessionRunResult, unknown, LanguageModel.LanguageModel | Tool.HandlersFor<AgentToolkit["tools"]>>;
  readonly stream: (
    input: AgentSessionRunInput
  ) => Stream.Stream<AgentMessageType, unknown, LanguageModel.LanguageModel | Tool.HandlersFor<AgentToolkit["tools"]>>;
}

export const AgentSession = {
  make: (harness: AgentHarness): AgentSession => ({
    run: (input) => run(harness, input),
    stream: (input) => stream(harness, input)
  }),
  run,
  stream
};

function run(
  harness: AgentHarness,
  input: AgentSessionRunInput
): Effect.Effect<AgentSessionRunResult, unknown, LanguageModel.LanguageModel | Tool.HandlersFor<AgentToolkit["tools"]>> {
  return execute(harness, input, () => Effect.void);
}

function stream(
  harness: AgentHarness,
  input: AgentSessionRunInput
): Stream.Stream<AgentMessageType, unknown, LanguageModel.LanguageModel | Tool.HandlersFor<AgentToolkit["tools"]>> {
  return Stream.callback<AgentMessageType, unknown, LanguageModel.LanguageModel | Tool.HandlersFor<AgentToolkit["tools"]>>((queue) =>
    execute(harness, input, (message) => Queue.offer(queue, message).pipe(Effect.asVoid)).pipe(
      Effect.andThen(Queue.end(queue)),
      Effect.matchCauseEffect({
        onFailure: (cause) => Queue.failCause(queue, cause),
        onSuccess: () => Effect.void
      })
    )
  );
}

function execute(
  harness: AgentHarness,
  input: AgentSessionRunInput,
  emit: (message: AgentMessageType) => Effect.Effect<void>
): Effect.Effect<AgentSessionRunResult, unknown, LanguageModel.LanguageModel | Tool.HandlersFor<AgentToolkit["tools"]>> {
  return Effect.gen(function* () {
    const toolkit = yield* harness.toolkit;
    const previousMessages = input.messages ?? [];
    const newMessages: AgentMessageType[] = [];
    const allMessages = () => [...previousMessages, ...newMessages] as const;
    const appendMessage = (message: AgentMessageType): Effect.Effect<void> => Effect.gen(function* () {
      newMessages.push(message);
      yield* emit(message);
    });

    // --- trace state -------------------------------------------------------
    const startedAt = Date.now();
    const traceSteps: TraceStep[] = [];
    const materialsRead = new Set<string>();
    let stepIndex = 0;
    let modelErrored = false;
    let producedModelText = false;
    let stepsUsed = 0;

    const recordStep = (step: Omit<TraceStep, "index">) => {
      traceSteps.push({ index: stepIndex++, ...step });
    };
    // -----------------------------------------------------------------------

    yield* appendMessage(AgentMessage.user(input.input));

    let lastToolResult = "";
    const maxSteps = input.maxSteps ?? 8;
    let terminationReason: TerminationReason = "max-steps";
    let finalOutput = "";

    for (let step = 0; step < maxSteps; step++) {
      stepsUsed = step + 1;
      const stepStartedAt = Date.now();
      const prompt = renderPrompt(harness.systemPrompt, allMessages());
      const response: LanguageModel.GenerateTextResponse<AgentToolkit["tools"]> = yield* LanguageModel.generateText({
        prompt,
        toolkit,
        toolChoice: "auto" as const
      }).pipe(
        Effect.matchEffect({
          onFailure: (error) => Effect.sync(() => {
            modelErrored = true;
            return modelErrorResponse(error);
          }),
          onSuccess: (response) => Effect.succeed(response)
        })
      );

      if (response.text.length > 0) {
        producedModelText = true;
      }

      recordStep({
        kind: "model-response",
        durationMs: Date.now() - stepStartedAt,
        isFailure: modelErrored,
        detail: `${response.toolCalls.length} tool call(s), ${response.text.length} chars of text`
      });

      for (const toolCall of response.toolCalls) {
        recordStep({
          kind: "tool-call",
          name: toolCall.name,
          detail: safeStringify(toolCall.params)
        });
        yield* appendMessage(AgentMessage.toolCall(toolCall.name, toolCall.params));
      }

      for (const toolResult of response.toolResults) {
        if (!toolResult.isFailure && isMaterialPageImages(toolResult.result)) {
          materialsRead.add(toolResult.result.material.id);
        }

        recordStep({
          kind: "tool-result",
          name: toolResult.name,
          isFailure: toolResult.isFailure,
          detail: truncate(formatToolResult(toolResult.result), 300)
        });
        yield* appendMessage(AgentMessage.toolResult(toolResult.name, toolResult.result, toolResult.isFailure));
      }

      if (response.toolResults.length === 0) {
        const output = response.text.length > 0 ? response.text : lastToolResult;
        yield* appendMessage(AgentMessage.assistant(output));
        terminationReason = modelErrored ? "model-error" : "completed";
        finalOutput = output;
        break;
      }

      // Only a textual tool result can stand in for an answer. Anything else
      // (rendered page images, structured payloads) used to be coerced with
      // `String(...)`, which handed the student a literal "[object Object]"
      // whenever a run ended on a non-text tool result. Saying what happened is
      // worse for the demo and better for the student.
      const lastResult = response.toolResults.at(-1)?.result;
      if (typeof lastResult === "string") {
        lastToolResult = lastResult;
      }

      if (step === maxSteps - 1) {
        const output = lastToolResult.length > 0
          ? lastToolResult
          : STEP_BUDGET_MESSAGE;
        yield* appendMessage(AgentMessage.assistant(output));
        terminationReason = "max-steps";
        finalOutput = output;
      }
    }

    // Degenerate case (maxSteps <= 0): still close the turn with an answer,
    // matching the previous behaviour of the post-loop fallback.
    if (stepsUsed === 0) {
      finalOutput = STEP_BUDGET_MESSAGE;
      yield* appendMessage(AgentMessage.assistant(finalOutput));
    }

    const signals = deriveSignals({ steps: traceSteps, terminationReason, producedModelText });
    const endedAt = Date.now();

    const trace: AgentTrace = {
      traceId: crypto.randomUUID(),
      sessionId: input.sessionId,
      agent: harness.name.split("\n")[0] ?? "agent",
      input: input.input,
      output: finalOutput,
      startedAt: new Date(startedAt).toISOString(),
      endedAt: new Date(endedAt).toISOString(),
      durationMs: endedAt - startedAt,
      steps: traceSteps,
      stepsUsed,
      maxSteps,
      terminationReason,
      signals,
      attribution: attributionFor(signals),
      materialsRead: [...materialsRead]
    };

    if (input.onTrace !== undefined) {
      yield* input.onTrace(trace);
    }

    return {
      output: finalOutput,
      newMessages,
      messages: allMessages(),
      trace
    };
  });
}

/**
 * Shown when the loop ends without the model producing an answer.
 *
 * Written for the student, in the product's language, and honest about what
 * happened rather than pretending the turn succeeded. The trace records the
 * same event as `step-budget-exhausted`, so the diagnosis is not lost.
 */
const STEP_BUDGET_MESSAGE =
  "Me he quedado sin pasos antes de poder responderte. Vuelve a preguntármelo, "
  + "y si puedes dime el material y las páginas concretas para que vaya directo.";

const truncate = (value: string, max: number) =>
  value.length <= max ? value : `${value.slice(0, max)}…`;

const safeStringify = (value: unknown) => {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
};

const modelErrorResponse = (error: unknown): LanguageModel.GenerateTextResponse<AgentToolkit["tools"]> =>
  new LanguageModel.GenerateTextResponse([
    Response.makePart("text", {
      text: `I hit an internal model/tool-routing error, so I stopped this turn safely instead of crashing the app.\n\n${formatAgentError(error)}`
    })
  ]);

const formatAgentError = (error: unknown) => {
  if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") {
    return error.message;
  }

  return String(error);
};

const renderPrompt = (
  systemPrompt: string,
  messages: readonly AgentMessageType[]
): readonly Prompt.MessageEncoded[] => [
  {
    role: "system",
    content: systemPrompt
  },
  ...messages.map(renderMessage)
];

const renderMessage = (message: AgentMessageType): Prompt.MessageEncoded => {
  switch (message.role) {
    case "user":
      return {
        role: "user",
        content: message.content
      };
    case "assistant":
      return {
        role: "assistant",
        content: message.content
      };
    case "tool-call":
      return {
        role: "assistant",
        content: `Tool call ${message.name}: ${JSON.stringify(message.input)}`
      };
    case "tool-result":
      if (!message.isFailure && isMaterialPageImages(message.result)) {
        const result = message.result;
        return {
          role: "user",
          content: [
            {
              type: "text",
              text: `Tool result ${message.name}: rendered pages ${result.pages.map((page) => page.page).join(", ")} from ${result.material.title}.`
            },
            ...result.pages.map((page) => ({
              type: "file" as const,
              mediaType: page.mediaType,
              data: page.data,
              fileName: `${result.material.id}-page-${page.page}.png`
            }))
          ]
        };
      }

      return {
        role: "user",
        content: `Tool result ${message.name}${message.isFailure ? " failure" : ""}: ${formatToolResult(message.result)}`
      };
  }
};

const formatToolResult = (result: unknown) => {
  if (typeof result === "string") {
    return result;
  }

  try {
    return JSON.stringify(result);
  } catch {
    return String(result);
  }
};
