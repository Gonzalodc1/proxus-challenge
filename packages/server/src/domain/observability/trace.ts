import { Context, Data, Effect } from "effect";

/**
 * Execution traces for agent runs.
 *
 * Motivation: when an agent run produces a bad answer, the system currently
 * records a single bit — it worked or it did not. But a failure has at least
 * two very different causes:
 *
 *   1. the model was not capable of solving the task, or
 *   2. the scaffolding around the model got in the way (step budget exhausted,
 *      malformed tool call, tool error, the loop spinning on itself).
 *
 * Those are recorded identically today, which makes any quality number hard to
 * act on: you cannot tell whether to change the prompt/model or fix the
 * harness. A trace records the per-step evidence needed to tell them apart
 * after the fact, without re-running the task.
 *
 * The attribution below is deliberately conservative: it reports *suspicion*
 * backed by named signals, never a verdict. Absence of signals is not proof the
 * model was at fault.
 */

export type TerminationReason =
  /** The model produced a final answer with no pending tool calls. */
  | "completed"
  /** The step budget ran out before the model produced a final answer. */
  | "max-steps"
  /** The language model call itself errored and the run was cut short. */
  | "model-error";

export type ScaffoldingSignal =
  /** A tool returned a failure result. */
  | "tool-failure"
  /** The step budget was exhausted; the answer is whatever was left over. */
  | "step-budget-exhausted"
  /** The language model call errored (transport, routing, quota, bad model id). */
  | "model-call-error"
  /** The same tool was called with the same input more than once: likely a loop. */
  | "repeated-tool-call"
  /** The model finished without ever producing assistant text of its own. */
  | "empty-model-output";

export type FailureAttribution =
  /** Run completed with no scaffolding signals detected. */
  | "clean"
  /** At least one scaffolding signal fired: do not read this run as a capability result. */
  | "scaffolding-suspected";

export interface TraceStep {
  readonly index: number;
  readonly kind: "model-response" | "tool-call" | "tool-result";
  readonly name?: string | undefined;
  readonly isFailure?: boolean | undefined;
  readonly detail?: string | undefined;
  readonly durationMs?: number | undefined;
}

export interface AgentTrace {
  readonly traceId: string;
  readonly sessionId?: string | undefined;
  readonly agent: string;
  readonly input: string;
  readonly output: string;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly durationMs: number;
  readonly steps: readonly TraceStep[];
  readonly stepsUsed: number;
  readonly maxSteps: number;
  readonly terminationReason: TerminationReason;
  readonly signals: readonly ScaffoldingSignal[];
  readonly attribution: FailureAttribution;
  /** Ids of materials the agent actually read during the run, for provenance. */
  readonly materialsRead: readonly string[];
}

/**
 * Derives the scaffolding signals from what the run actually did.
 * Pure function so it can be unit-tested and reused by the evals.
 */
export const deriveSignals = (input: {
  readonly steps: readonly TraceStep[];
  readonly terminationReason: TerminationReason;
  readonly producedModelText: boolean;
}): readonly ScaffoldingSignal[] => {
  const signals = new Set<ScaffoldingSignal>();

  if (input.terminationReason === "max-steps") {
    signals.add("step-budget-exhausted");
  }

  if (input.terminationReason === "model-error") {
    signals.add("model-call-error");
  }

  if (input.steps.some((step) => step.kind === "tool-result" && step.isFailure === true)) {
    signals.add("tool-failure");
  }

  if (!input.producedModelText) {
    signals.add("empty-model-output");
  }

  const seen = new Set<string>();
  for (const step of input.steps) {
    if (step.kind !== "tool-call") {
      continue;
    }
    const fingerprint = `${step.name ?? ""}:${step.detail ?? ""}`;
    if (seen.has(fingerprint)) {
      signals.add("repeated-tool-call");
      break;
    }
    seen.add(fingerprint);
  }

  return [...signals];
};

export const attributionFor = (signals: readonly ScaffoldingSignal[]): FailureAttribution =>
  signals.length === 0 ? "clean" : "scaffolding-suspected";

export class TraceRepositoryStorageError extends Data.TaggedError("TraceRepositoryStorageError")<{
  readonly reason: unknown;
}> { }

export interface TraceRepository {
  readonly append: (trace: AgentTrace) => Effect.Effect<void, TraceRepositoryStorageError>;
  readonly list: (limit?: number) => Effect.Effect<readonly AgentTrace[], TraceRepositoryStorageError>;
}

export const TraceRepository = Context.Service<TraceRepository>(
  "@proxus/server/observability/TraceRepository"
);
