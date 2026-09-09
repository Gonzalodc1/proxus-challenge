import { useAtomSet, useAtomValue } from "@effect/atom-react";
import type {
  Artifact,
  ArtifactAttempt,
  MultipleChoiceQuestion,
  QuestionCorrection,
  QuizQuestion,
  SubmitAttemptInput,
  TestQuestion
} from "@proxus/shared";
import { type KeyboardEvent, useEffect, useMemo, useState } from "react";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import { artifactQuery, submitArtifactAttemptAction } from "../domain/artifacts/atoms.ts";
import { Markdown, MarkdownInline } from "./Markdown.tsx";

type Answers = Record<string, string>;
type Question = QuizQuestion | TestQuestion;

interface ArtifactWorkspaceProps {
  readonly artifactId: string | null;
  readonly onClose: () => void;
}

export function ArtifactWorkspace({ artifactId, onClose }: ArtifactWorkspaceProps) {
  // Escape closes the panel, the same reflex any modal or side panel trains.
  // Bound on the document rather than the panel so it works without the panel
  // having focus, which it usually will not right after the tutor opens one.
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <main className="relative h-screen min-w-0 overflow-y-auto border-slate-800 border-r bg-slate-950/60 p-6 max-md:h-auto max-md:border-r-0 max-md:border-b">
      <CloseButton onClose={onClose} />
      {artifactId === null ? <EmptyWorkspace /> : <ArtifactDetail artifactId={artifactId} />}
    </main>
  );
}

/**
 * The panel took over a third of the screen with no way out: the student could
 * open a quiz but not put it away, so reading a long answer in the chat meant
 * living with it. Closing is a first-class action, so it gets a persistent
 * control rather than only a keyboard shortcut.
 */
function CloseButton({ onClose }: { readonly onClose: () => void }) {
  return (
    <button
      type="button"
      onClick={onClose}
      title="Cerrar el panel (Esc)"
      aria-label="Cerrar el panel de estudio"
      className="absolute top-4 right-4 z-10 grid h-8 w-8 place-items-center rounded-full border border-slate-800 bg-slate-950/80 text-slate-400 backdrop-blur transition-colors hover:border-slate-600 hover:text-slate-100"
    >
      <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
        <path d="M5.5 5.5l9 9m0-9l-9 9" strokeLinecap="round" />
      </svg>
    </button>
  );
}

function EmptyWorkspace() {
  return (
    <div className="grid h-full place-items-center rounded-3xl border border-slate-800 border-dashed bg-slate-900/40 p-8 text-center">
        <div>
          <h2 className="text-balance font-semibold text-2xl text-slate-100">
            Elige una nota, un quiz o un test en el panel lateral.
          </h2>
          <p className="mt-3 max-w-sm text-slate-400 text-sm">
            Los quizzes y tests se resuelven aquí mismo. El chat con MagIA sigue disponible para pistas y explicaciones.
          </p>
      </div>
    </div>
  );
}

function ArtifactDetail({ artifactId }: { readonly artifactId: string }) {
  const artifact = useAtomValue(artifactQuery(artifactId));

  return (
    <>
      {AsyncResult.matchWithError(artifact, {
        onInitial: () => <p className="text-slate-400">Cargando…</p>,
        onError: (error) => <p className="text-red-200">{String(error)}</p>,
        onDefect: (defect) => <p className="text-red-200">{String(defect)}</p>,
        // Remounting per artifact resets the stepper, so opening a second quiz
        // never starts halfway through the previous one.
        onSuccess: ({ value }) => <ArtifactContent key={value.id} artifact={value} />
      })}
    </>
  );
}

function ArtifactContent({ artifact }: { readonly artifact: Artifact }) {
  switch (artifact.kind) {
    case "note":
      return <NoteViewer artifact={artifact} />;
    case "quiz":
    case "test":
      return <ExerciseSolver artifact={artifact} />;
  }
}

function NoteViewer({ artifact }: { readonly artifact: Extract<Artifact, { readonly kind: "note" }> }) {
  return (
    <article className="mx-auto max-w-3xl rounded-3xl border border-slate-800 bg-slate-900 p-6">
      <h2 className="mb-6 font-semibold text-2xl text-slate-100">{artifact.title}</h2>
      <div className="prose prose-invert max-w-none">
        <Markdown>{artifact.markdown}</Markdown>
      </div>
    </article>
  );
}

/**
 * One question at a time.
 *
 * The previous version stacked every question on one scrolling page, which
 * makes a five-question quiz look like a wall and invites skimming ahead. A
 * student preparing an exam benefits from the opposite: one prompt in the
 * frame, visible progress, and no way to half-read the next one while
 * answering this one.
 *
 * The trade-off is that overview is lost, so the progress strip carries it:
 * every question is one dot, showing answered state before grading and
 * right/wrong after it, and any dot is clickable to jump straight there.
 */
function ExerciseSolver({ artifact }: { readonly artifact: Extract<Artifact, { readonly kind: "quiz" | "test" }> }) {
  const [answers, setAnswers] = useState<Answers>({});
  const [attempt, setAttempt] = useState<ArtifactAttempt | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState<1 | -1>(1);
  const submitAttempt = useAtomSet(submitArtifactAttemptAction, { mode: "promise" });

  const questions = artifact.questions;
  const total = questions.length;
  const question = questions[index];
  const graded = attempt?.status === "graded" ? attempt : null;

  const unansweredQuestions = useMemo(
    () => questions.filter((candidate) => (answers[candidate.id] ?? "").trim().length === 0),
    [answers, questions]
  );

  const correctionFor = (questionId: string) =>
    graded?.corrections.find((item) => item.questionId === questionId);

  const setAnswer = (questionId: string, value: string) => {
    setAnswers((current) => ({ ...current, [questionId]: value }));
  };

  const goTo = (next: number) => {
    if (next < 0 || next >= total || next === index) {
      return;
    }
    setDirection(next > index ? 1 : -1);
    setIndex(next);
  };

  const submit = async () => {
    if (unansweredQuestions.length > 0 || isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setError(undefined);

    try {
      const payload = buildSubmitInput(artifact, answers);
      const result = await submitAttempt(payload);
      setAttempt(result);
      setIndex(0);
      setDirection(1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setIsSubmitting(false);
    }
  };

  const retry = () => {
    setAnswers({});
    setAttempt(null);
    setError(undefined);
    setIndex(0);
    setDirection(1);
  };

  // Arrow keys move between questions. Ignored while typing so a short answer
  // can still be edited normally.
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.tagName === "TEXTAREA" || target.tagName === "INPUT") {
      return;
    }

    if (event.key === "ArrowRight") {
      event.preventDefault();
      goTo(index + 1);
    }

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      goTo(index - 1);
    }
  };

  if (question === undefined) {
    return <p className="text-slate-400">Este {artifact.kind} no tiene preguntas.</p>;
  }

  const isLast = index === total - 1;
  const answeredCurrent = (answers[question.id] ?? "").trim().length > 0;

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <article className="mx-auto flex min-h-full max-w-2xl flex-col" onKeyDown={handleKeyDown}>
      <header className="mb-5">
        <h2 className="font-semibold text-slate-100 text-xl">{artifact.title}</h2>
        <div className="mt-3 flex items-center gap-3">
          <span className="shrink-0 text-slate-500 text-xs tabular-nums">
            {index + 1} / {total}
          </span>
          <ProgressStrip
            questions={questions}
            answers={answers}
            current={index}
            correctionFor={correctionFor}
            onSelect={goTo}
          />
        </div>
      </header>

      {graded !== null && <ScoreBanner attempt={graded} />}

      <div
        key={index}
        className="question-enter flex-1"
        style={{ "--question-slide-from": direction === 1 ? "14px" : "-14px" } as React.CSSProperties}
      >
        <QuestionCard
          question={question}
          value={answers[question.id] ?? ""}
          correction={correctionFor(question.id)}
          disabled={attempt !== null}
          onChange={(value) => setAnswer(question.id, value)}
        />
      </div>

      {error !== undefined && (
        <p className="mt-4 rounded-2xl border border-red-900 bg-red-950/50 p-4 text-red-100 text-sm">{error}</p>
      )}

      <footer className="mt-6 flex items-center justify-between gap-3">
        <button
          type="button"
          className="rounded-full border border-slate-800 px-4 py-2 text-slate-400 text-sm transition-colors hover:border-slate-600 hover:text-slate-200 disabled:cursor-not-allowed disabled:opacity-30"
          onClick={() => goTo(index - 1)}
          disabled={index === 0}
        >
          Anterior
        </button>

        {attempt === null
          ? (
              isLast
                ? (
                    <div className="flex items-center gap-3">
                      {unansweredQuestions.length > 0 && (
                        <span className="text-slate-500 text-xs">
                          {unansweredQuestions.length} sin responder
                        </span>
                      )}
                      <button
                        type="button"
                        className="rounded-full bg-violet-600 px-5 py-2 font-medium text-sm text-white transition-colors hover:bg-violet-500 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500"
                        disabled={unansweredQuestions.length > 0 || isSubmitting}
                        onClick={() => void submit()}
                      >
                        {isSubmitting ? "Enviando…" : "Enviar respuestas"}
                      </button>
                    </div>
                  )
                : (
                    <button
                      type="button"
                      className={`rounded-full px-5 py-2 font-medium text-sm transition-colors ${
                        answeredCurrent
                          ? "bg-violet-600 text-white hover:bg-violet-500"
                          : "border border-slate-800 text-slate-400 hover:border-slate-600 hover:text-slate-200"
                      }`}
                      onClick={() => goTo(index + 1)}
                    >
                      Siguiente
                    </button>
                  )
            )
          : (
              isLast
                ? (
                    <button
                      type="button"
                      className="rounded-full border border-slate-700 px-5 py-2 text-slate-200 text-sm transition-colors hover:border-violet-500"
                      onClick={retry}
                    >
                      Intentar de nuevo
                    </button>
                  )
                : (
                    <button
                      type="button"
                      className="rounded-full bg-violet-600 px-5 py-2 font-medium text-sm text-white transition-colors hover:bg-violet-500"
                      onClick={() => goTo(index + 1)}
                    >
                      Siguiente
                    </button>
                  )
            )}
      </footer>
    </article>
  );
}

function ProgressStrip({ questions, answers, current, correctionFor, onSelect }: {
  readonly questions: readonly Question[];
  readonly answers: Answers;
  readonly current: number;
  readonly correctionFor: (questionId: string) => QuestionCorrection | undefined;
  readonly onSelect: (index: number) => void;
}) {
  return (
    <div className="flex flex-1 gap-1.5">
      {questions.map((question, index) => {
        const correction = correctionFor(question.id);
        const answered = (answers[question.id] ?? "").trim().length > 0;

        const tone = correction === undefined
          ? (answered ? "bg-violet-500/60" : "bg-slate-800")
          : isCorrect(correction)
            ? "bg-emerald-500/70"
            : "bg-red-500/70";

        return (
          <button
            key={question.id}
            type="button"
            onClick={() => onSelect(index)}
            aria-label={`Ir a la pregunta ${index + 1}`}
            aria-current={index === current}
            className={`h-1.5 flex-1 rounded-full transition-all ${tone} ${
              index === current ? "ring-2 ring-violet-400 ring-offset-2 ring-offset-slate-950" : "hover:opacity-80"
            }`}
          />
        );
      })}
    </div>
  );
}

const isCorrect = (correction: QuestionCorrection) =>
  correction.questionType === "short-answer"
    ? correction.score >= correction.maxScore
    : correction.correct;

function ScoreBanner({ attempt }: { readonly attempt: Extract<ArtifactAttempt, { readonly status: "graded" }> }) {
  return (
    <section className="mb-4 rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3">
      <p className="font-semibold text-slate-100">
        {attempt.score} / {attempt.maxScore}
      </p>
      {attempt.summary.length > 0 && (
        <p className="mt-1 text-slate-400 text-sm">{attempt.summary}</p>
      )}
    </section>
  );
}

function QuestionCard({ question, value, correction, disabled, onChange }: {
  readonly question: Question;
  readonly value: string;
  readonly correction: QuestionCorrection | undefined;
  readonly disabled: boolean;
  readonly onChange: (value: string) => void;
}) {
  return (
    <section className="rounded-3xl border border-slate-800 bg-slate-900 p-6">
      <div className="mb-5 flex items-start justify-between gap-4">
        <h3 className="font-medium text-lg text-slate-100 leading-relaxed">
          <MarkdownInline>{question.prompt}</MarkdownInline>
        </h3>
        {correction !== undefined && <CorrectionBadge correction={correction} />}
      </div>

      {question.type === "multiple-choice" && (
        <MultipleChoiceInput question={question} value={value} disabled={disabled} onChange={onChange} />
      )}
      {question.type === "true-false" && (
        <TrueFalseInput value={value} disabled={disabled} onChange={onChange} />
      )}
      {question.type === "short-answer" && (
        <textarea
          className="min-h-32 w-full rounded-2xl border border-slate-700 bg-slate-950 p-3 text-slate-100 outline-none transition-colors focus:border-violet-500 disabled:opacity-70"
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.currentTarget.value)}
          placeholder="Escribe tu respuesta…"
        />
      )}

      {correction !== undefined && <CorrectionDetails correction={correction} question={question} />}
    </section>
  );
}

function MultipleChoiceInput({ question, value, disabled, onChange }: {
  readonly question: MultipleChoiceQuestion;
  readonly value: string;
  readonly disabled: boolean;
  readonly onChange: (value: string) => void;
}) {
  return (
    <div className="grid gap-2">
      {question.options.map((option) => (
        <label
          className={`flex cursor-pointer items-center gap-3 rounded-2xl border p-3 transition-colors ${
            value === option.id
              ? "border-violet-500 bg-violet-500/10"
              : "border-slate-800 bg-slate-950/70 hover:border-slate-600"
          } ${disabled ? "cursor-default" : ""}`}
          key={option.id}
        >
          <input
            type="radio"
            name={`question-${question.id}`}
            value={option.id}
            checked={value === option.id}
            disabled={disabled}
            onChange={() => onChange(option.id)}
          />
          <span className="text-slate-100 text-sm">
            <MarkdownInline>{option.text}</MarkdownInline>
          </span>
        </label>
      ))}
    </div>
  );
}

function TrueFalseInput({ value, disabled, onChange }: {
  readonly value: string;
  readonly disabled: boolean;
  readonly onChange: (value: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2 max-sm:grid-cols-1">
      {([
        ["true", "Verdadero"],
        ["false", "Falso"]
      ] as const).map(([nextValue, label]) => (
        <label
          className={`flex cursor-pointer items-center gap-3 rounded-2xl border p-3 transition-colors ${
            value === nextValue
              ? "border-violet-500 bg-violet-500/10"
              : "border-slate-800 bg-slate-950/70 hover:border-slate-600"
          } ${disabled ? "cursor-default" : ""}`}
          key={nextValue}
        >
          <input
            type="radio"
            name={`true-false-${label}`}
            value={nextValue}
            checked={value === nextValue}
            disabled={disabled}
            onChange={() => onChange(nextValue)}
          />
          <span className="text-slate-100 text-sm">{label}</span>
        </label>
      ))}
    </div>
  );
}

function CorrectionBadge({ correction }: { readonly correction: QuestionCorrection }) {
  if (correction.questionType === "short-answer") {
    return (
      <span className="shrink-0 rounded-full bg-violet-500/15 px-3 py-1 font-medium text-sm text-violet-300">
        {correction.score}/{correction.maxScore}
      </span>
    );
  }

  return correction.correct
    ? <span className="shrink-0 rounded-full bg-emerald-500/15 px-3 py-1 font-medium text-emerald-300 text-sm">Correcta</span>
    : <span className="shrink-0 rounded-full bg-red-500/15 px-3 py-1 font-medium text-red-300 text-sm">Repasar</span>;
}

function CorrectionDetails({ correction, question }: {
  readonly correction: QuestionCorrection;
  readonly question: Question;
}) {
  return (
    <div className="mt-5 rounded-2xl border border-slate-800 bg-slate-950 p-4 text-sm">
      {correction.questionType === "multiple-choice" && question.type === "multiple-choice" && (
        <>
          <p className="text-slate-300">
            Respuesta correcta:{" "}
            <strong><MarkdownInline>{optionText(question, correction.correctOptionId)}</MarkdownInline></strong>
          </p>
          <div className="mt-2 text-slate-400">
            <MarkdownInline>{correction.explanation}</MarkdownInline>
          </div>
        </>
      )}
      {correction.questionType === "true-false" && (
        <>
          <p className="text-slate-300">
            Respuesta correcta: <strong>{correction.correctAnswer ? "Verdadero" : "Falso"}</strong>
          </p>
          <div className="mt-2 text-slate-400">
            <MarkdownInline>{correction.explanation}</MarkdownInline>
          </div>
        </>
      )}
      {correction.questionType === "short-answer" && (
        <div className="text-slate-300">
          <MarkdownInline>{correction.feedback}</MarkdownInline>
        </div>
      )}
    </div>
  );
}

const optionText = (question: MultipleChoiceQuestion, optionId: string) =>
  question.options.find((option) => option.id === optionId)?.text ?? optionId;

function buildSubmitInput(
  artifact: Extract<Artifact, { readonly kind: "quiz" | "test" }>,
  answers: Answers
): SubmitAttemptInput {
  const builtAnswers = artifact.questions.map((question) => {
    const value = answers[question.id] ?? "";
    switch (question.type) {
      case "multiple-choice":
        return {
          questionType: "multiple-choice" as const,
          questionId: question.id,
          selectedOptionId: value
        };
      case "true-false":
        return {
          questionType: "true-false" as const,
          questionId: question.id,
          answer: value === "true"
        };
      case "short-answer":
        return {
          questionType: "short-answer" as const,
          questionId: question.id,
          answer: value
        };
    }
  });

  if (artifact.kind === "quiz") {
    return {
      artifactKind: "quiz",
      artifactId: artifact.id,
      answers: builtAnswers.filter((answer) => answer.questionType !== "short-answer")
    };
  }

  return {
    artifactKind: "test",
    artifactId: artifact.id,
    answers: builtAnswers
  };
}
