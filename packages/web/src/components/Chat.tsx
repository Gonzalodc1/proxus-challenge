import { useAtomRefresh } from "@effect/atom-react";
import type { AgentMessage, FeedbackRating } from "@proxus/shared";
import { type KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";
import "streamdown/styles.css";
import { Markdown } from "./Markdown.tsx";
import { artifactsQuery } from "../domain/artifacts/atoms.ts";
import { materialsQuery } from "../domain/materials/atoms.ts";
import { submitFeedback } from "../domain/tutor/feedback.ts";
import { applyInvalidations, invalidationsForToolCall } from "../domain/tutor/invalidation.ts";
import { streamTutorMessage } from "../domain/tutor/stream.ts";

const starterPrompts = [
  "Lista mis materiales subidos",
  "Crea un quiz corto con mis materiales",
  "Ponme a prueba: debate conmigo sobre lo que estoy estudiando"
] as const;

// Tool traffic (load_skill / cli) is internal plumbing. We keep it out of the
// conversation so the user only sees the tutor's actual answers.
const isVisible = (message: AgentMessage) => message.role !== "tool-call" && message.role !== "tool-result";

/**
 * Whether follow-up chips are worth showing after this answer.
 *
 * They were appearing after every reply, including a two-line greeting, where
 * "Explícamelo más simple" refers to nothing. Two cases are skipped:
 *
 *  - The tutor already ends by asking something. Its own question is better
 *    than any generic chip, and stacking both makes the UI argue with itself.
 *  - Very short answers, which are greetings or acknowledgements rather than
 *    explanations with anything to follow up on.
 */
const wantsFollowUps = (answer: string) => {
  const trimmed = answer.trim();

  if (trimmed.length < 220) {
    return false;
  }

  const lastLine = trimmed.split("\n").map((line) => line.trim()).filter((line) => line.length > 0).at(-1);
  return lastLine === undefined ? false : !lastLine.endsWith("?");
};

/**
 * Follow-up chips, derived from the answer's own wording.
 *
 * Deliberately not asked of the model: an extra generation per turn would
 * roughly double the cost of a conversation, and on a free tier aimed at
 * hundreds of thousands of students that is not a reasonable price for three
 * chips.
 */
const followUps = (lastAnswer: string): readonly string[] => {
  const text = lastAnswer.toLowerCase();

  // A quiz or test was just created: it is solved in the panel, so the useful
  // next moves are about the material behind it, not about answering here.
  if (text.includes("quiz") || text.includes("test")) {
    return ["Repasa el tema antes de hacerlo", "Hazme otro más difícil", "¿Qué suele caer de esto?"];
  }

  if (text.includes("apunte") || text.includes("página") || text.includes("material")) {
    return ["Hazme un quiz de esto", "Resúmelo en 5 puntos", "¿Qué suele caer en el examen?"];
  }

  return ["Explícamelo más simple", "Ponme un ejemplo", "Hazme un quiz de esto"];
};

interface ChatProps {
  readonly sidebarOpen: boolean;
  readonly onToggleSidebar: () => void;
  readonly theme: "dark" | "light";
  readonly onToggleTheme: () => void;
}

export function Chat({ sidebarOpen, onToggleSidebar, theme, onToggleTheme }: ChatProps) {
  const [messages, setMessages] = useState<readonly AgentMessage[]>([]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | undefined>();
  // Message index -> trace of the run that produced it, so a rating can be
  // joined to what the agent actually did.
  const [traceByIndex, setTraceByIndex] = useState<Record<number, string>>({});
  const [ratingByIndex, setRatingByIndex] = useState<Record<number, FeedbackRating>>({});
  // True while the newest answer is still being revealed, so the follow-up
  // chips wait for it to finish instead of appearing over a half-written reply.
  const [isTyping, setIsTyping] = useState(false);
  const refreshArtifacts = useAtomRefresh(artifactsQuery);
  const refreshMaterials = useAtomRefresh(materialsQuery);
  const pendingInvalidations = useRef<Array<ReturnType<typeof invalidationsForToolCall>>>([]);
  const scrollRef = useRef<HTMLElement | null>(null);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el !== null) {
      el.scrollTop = el.scrollHeight;
    }
  }, []);

  const submit = async (nextInput: string) => {
    const trimmed = nextInput.trim();
    if (trimmed.length === 0 || isSending) {
      return;
    }

    setIsSending(true);
    setError(undefined);
    // Cleared up front: leaving the prompt sitting in the box while the tutor
    // works reads as if the message had not been sent. Restored below if the
    // request fails, so nothing the student typed is lost.
    setInput("");
    pendingInvalidations.current = [];

    // Index this run's messages will occupy, so the trace can be mapped back
    // onto the right bubble once the run reports it.
    const baseIndex = messages.length;
    const appended: AgentMessage[] = [];

    try {
      for await (const event of streamTutorMessage({
        input: trimmed,
        messages,
        maxSteps: 8
      })) {
        if (event.type === "done") {
          const traceId = event.traceId;
          if (traceId !== undefined) {
            const lastAssistant = appended.reduce(
              (found, message, index) => (message.role === "assistant" ? index : found),
              -1
            );
            if (lastAssistant >= 0) {
              setTraceByIndex((current) => ({ ...current, [baseIndex + lastAssistant]: traceId }));
            }
          }
          continue;
        }

        const message = event.message;
        appended.push(message);
        setMessages((current) => [...current, message]);

        if (message.role === "tool-call") {
          pendingInvalidations.current.push(invalidationsForToolCall(message));
        }

        if (message.role === "tool-result") {
          const keys = pendingInvalidations.current.shift() ?? [];
          if (!message.isFailure) {
            applyInvalidations(keys, {
              refreshArtifacts,
              refreshMaterials
            });
          }
        }
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setInput(trimmed);
    } finally {
      setIsSending(false);
    }
  };

  const rate = async (index: number, rating: FeedbackRating, excerpt: string) => {
    // Optimistic: the rating is a side channel, so the UI should not wait on it
    // and a storage hiccup should not interrupt the student.
    setRatingByIndex((current) => ({ ...current, [index]: rating }));
    try {
      await submitFeedback({ traceId: traceByIndex[index], rating, excerpt });
    } catch {
      setRatingByIndex((current) => {
        const next = { ...current };
        delete next[index];
        return next;
      });
    }
  };

  // Enter sends. Ctrl+Enter (or Shift+Enter) inserts a line break.
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter") {
      return;
    }

    if (event.ctrlKey || event.metaKey || event.shiftKey) {
      event.preventDefault();
      const el = event.currentTarget;
      const start = el.selectionStart;
      const end = el.selectionEnd;
      const next = `${input.slice(0, start)}\n${input.slice(end)}`;
      setInput(next);
      requestAnimationFrame(() => {
        el.selectionStart = el.selectionEnd = start + 1;
      });
      return;
    }

    event.preventDefault();
    void submit(input);
  };

  const visible = messages.filter(isVisible);
  const lastVisible = visible.at(-1);
  const showThinking = isSending && (lastVisible === undefined || lastVisible.role === "user");
  const lastIndex = messages.length - 1;
  const showFollowUps = !isSending
    && !isTyping
    && lastVisible !== undefined
    && lastVisible.role === "assistant"
    && wantsFollowUps(lastVisible.content);

  useEffect(scrollToBottom, [messages.length, isSending, scrollToBottom]);

  return (
    <main className="grid h-screen max-h-screen min-w-0 grid-rows-[auto_1fr_auto_auto] bg-slate-950 max-md:h-auto max-md:max-h-none">
      <header className="flex items-center justify-between gap-4 border-slate-800 border-b px-6 py-5">
        <div className="flex items-center gap-3">
          <button
            className="grid size-9 place-items-center rounded-lg border border-slate-700 text-slate-300 transition-colors hover:border-violet-500 hover:text-slate-100"
            type="button"
            onClick={onToggleSidebar}
            aria-label={sidebarOpen ? "Ocultar panel" : "Mostrar panel"}
            title={sidebarOpen ? "Ocultar panel" : "Mostrar panel"}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="4" y1="6" x2="20" y2="6" />
              <line x1="4" y1="12" x2="20" y2="12" />
              <line x1="4" y1="18" x2="20" y2="18" />
            </svg>
          </button>
          <h1 className="m-0 font-semibold text-2xl text-slate-100 tracking-tight">MagIA</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="grid size-9 place-items-center rounded-lg border border-slate-700 text-slate-300 transition-colors hover:border-violet-500 hover:text-slate-100"
            type="button"
            onClick={onToggleTheme}
            aria-label={theme === "dark" ? "Cambiar a tema claro" : "Cambiar a tema oscuro"}
            title={theme === "dark" ? "Tema claro" : "Tema oscuro"}
          >
            {theme === "dark"
              ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="4" />
                    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
                  </svg>
                )
              : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
                  </svg>
                )}
          </button>
          <button
            className="rounded-full border border-slate-700 px-4 py-2 text-slate-300 text-sm transition-colors hover:border-violet-500 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-40"
            type="button"
            onClick={() => {
              setMessages([]);
              setTraceByIndex({});
              setRatingByIndex({});
            }}
            disabled={messages.length === 0}
          >
            Vaciar chat
          </button>
        </div>
      </header>

      <section ref={scrollRef} className="flex flex-col gap-5 overflow-y-auto px-8 py-8" aria-live="polite">
        {visible.length === 0 && !isSending
          ? (
              <div className="m-auto w-full max-w-3xl text-center">
                <h2 className="m-0 text-balance font-semibold text-3xl text-slate-100 leading-tight md:text-4xl">
                  Pregúntame por tus materiales, apuntes, quizzes o tests.
                </h2>
                <p className="mt-3 text-slate-500 text-sm">La conversación vive solo en tu navegador. Si recargas, empieza de cero.</p>
                <div className="mt-8 grid grid-cols-3 gap-3 max-lg:grid-cols-1">
                  {starterPrompts.map((prompt) => (
                    <button
                      className="rounded-xl border border-slate-800 bg-slate-900 p-4 text-left text-slate-300 text-sm transition-colors hover:border-violet-500 hover:text-slate-100"
                      key={prompt}
                      type="button"
                      onClick={() => void submit(prompt)}
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            )
          : (
              <div className="mx-auto flex w-full max-w-4xl flex-col gap-7">
                {messages.map((message, index) => (
                  <MessageBubble
                    key={index}
                    message={message}
                    rating={ratingByIndex[index]}
                    onRate={(rating) => void rate(index, rating, message.role === "assistant" ? message.content : "")}
                    onGrow={scrollToBottom}
                    onTypingChange={index === lastIndex ? setIsTyping : undefined}
                  />
                ))}
                {showThinking ? <ThinkingIndicator /> : null}
                {showFollowUps
                  ? (
                      <div className="flex flex-wrap gap-2 pt-1">
                        {followUps(lastVisible.content).map((suggestion) => (
                          <button
                            key={suggestion}
                            type="button"
                            className="rounded-full border border-slate-800 bg-slate-900 px-3 py-1.5 text-slate-400 text-sm transition-colors hover:border-violet-500 hover:text-slate-100"
                            onClick={() => void submit(suggestion)}
                          >
                            {suggestion}
                          </button>
                        ))}
                      </div>
                    )
                  : null}
              </div>
            )}
      </section>

      {error === undefined ? null : (
        <p className="m-0 px-8 pb-3 text-red-300 text-sm">{error}</p>
      )}

      <form
        className="bg-slate-950 px-8 pt-2 pb-6"
        onSubmit={(event) => {
          event.preventDefault();
          void submit(input);
        }}
      >
        {/* One rounded field holding the input and its action, instead of a box
            plus a detached button: fewer edges, and the send control sits where
            the sentence ends. */}
        <div className="mx-auto flex w-full max-w-4xl items-end gap-2 rounded-2xl border border-violet-500/40 bg-slate-900 py-2 pr-2 pl-3 transition-colors focus-within:border-violet-500">
          <textarea
            className="max-h-40 min-h-11 flex-1 resize-none bg-transparent px-2 py-2 text-slate-100 leading-6 outline-none placeholder:text-slate-500"
            value={input}
            onChange={(event) => setInput(event.currentTarget.value)}
            onKeyDown={handleKeyDown}
            placeholder="Pregúntale lo que quieras a MagIA…"
            rows={1}
          />
          <button
            className="flex shrink-0 items-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 font-medium text-sm text-white transition-colors hover:bg-violet-500 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500"
            type="submit"
            disabled={isSending || input.trim().length === 0}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m22 2-7 20-4-9-9-4Z" />
              <path d="M22 2 11 13" />
            </svg>
            {isSending ? "Pensando…" : "Enviar"}
          </button>
        </div>
      </form>
    </main>
  );
}

function ThinkingIndicator() {
  return (
    <div className="flex max-w-3xl items-center gap-2 self-start rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3" aria-label="MagIA está pensando">
      <span className="size-2 animate-bounce rounded-full bg-violet-400 [animation-delay:-0.3s]" />
      <span className="size-2 animate-bounce rounded-full bg-violet-400 [animation-delay:-0.15s]" />
      <span className="size-2 animate-bounce rounded-full bg-violet-400" />
    </div>
  );
}

/**
 * Reveals an answer progressively instead of dropping it in fully formed.
 *
 * This is a presentation effect, not real token streaming: the Gemini adapter
 * implements `generateText` only (its `streamText` returns an empty stream), so
 * the server already holds the whole answer before the client sees anything.
 * Real streaming would need `streamText` implemented against Gemini's streaming
 * endpoint and partial assistant text emitted from the agent loop. Noted as the
 * next step in the changelog rather than pretended to here.
 */
function useTypewriter(text: string, enabled: boolean) {
  const [shown, setShown] = useState(enabled ? "" : text);

  useEffect(() => {
    if (!enabled) {
      setShown(text);
      return;
    }

    // Bounded to a fixed number of repaints rather than a fixed character rate.
    // Each repaint re-parses the whole answer as markdown, which is expensive:
    // revealing a few characters per animation frame made long answers crawl.
    // A constant step count keeps the reveal at roughly the same duration
    // whatever the length, and costs the same amount of work every time.
    const steps = 24;
    const perTick = Math.max(1, Math.ceil(text.length / steps));
    // Hard deadline. Each repaint re-parses the answer as markdown, so on long
    // answers the repaints themselves, not the timer, set the pace. Without a
    // ceiling the effect would keep a finished answer partly hidden for
    // seconds, which is worse than having no effect at all: the animation must
    // never be the reason a student is still waiting.
    const deadline = Date.now() + 1200;
    let cursor = 0;
    setShown("");

    const timer = setInterval(() => {
      cursor += perTick;
      if (cursor >= text.length || Date.now() > deadline) {
        setShown(text);
        clearInterval(timer);
        return;
      }
      setShown(text.slice(0, cursor));
    }, 28);

    return () => clearInterval(timer);
  }, [text, enabled]);

  return shown;
}

function MessageBubble({ message, rating, onRate, onGrow, onTypingChange }: {
  readonly message: AgentMessage;
  readonly rating: FeedbackRating | undefined;
  readonly onRate: (rating: FeedbackRating) => void;
  readonly onGrow: () => void;
  readonly onTypingChange?: ((typing: boolean) => void) | undefined;
}) {
  // Each message keeps its own slot in the list, so a bubble mounts once: only
  // the answer arriving now animates, earlier ones render complete.
  const isAssistant = message.role === "assistant";
  const content = isVisible(message) ? message.content : "";
  const shown = useTypewriter(content, isAssistant);

  useEffect(onGrow, [shown, onGrow]);
  useEffect(() => {
    onTypingChange?.(isAssistant && shown.length < content.length);
  }, [shown, content, isAssistant, onTypingChange]);

  if (!isVisible(message)) {
    return null;
  }

  if (message.role === "user") {
    // Outlined pill rather than a filled bubble: it marks who is speaking
    // without turning the student's own words into the loudest thing on screen.
    return (
      <article className="max-w-[75%] self-end rounded-2xl border border-slate-600 bg-slate-900 px-4 py-2.5">
        <div className="text-slate-100 leading-7">
          <Markdown>{message.content}</Markdown>
        </div>
      </article>
    );
  }

  // The tutor's answer is the page, not a message inside it. Dropping the card
  // lets a long explanation read like a document instead of a chat log, which
  // is what it is: the student is studying from it.
  return (
    <div className="flex w-full flex-col gap-2 self-start">
      <div className="max-w-none text-[15px] text-slate-200 leading-8">
        <Markdown>{shown}</Markdown>
      </div>
      <MessageActions content={content} rating={rating} onRate={onRate} />
    </div>
  );
}

function MessageActions({ content, rating, onRate }: {
  readonly content: string;
  readonly rating: FeedbackRating | undefined;
  readonly onRate: (rating: FeedbackRating) => void;
}) {
  const [copied, setCopied] = useState(false);
  const base = "grid size-7 place-items-center rounded-md transition-colors";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be denied; failing quietly beats an alert.
    }
  };

  return (
    <div className="flex items-center gap-1 pl-1">
      <button
        type="button"
        className={`${base} ${copied ? "text-violet-400" : "text-slate-600 hover:bg-slate-900 hover:text-slate-300"}`}
        onClick={() => void copy()}
        aria-label="Copiar respuesta"
        title={copied ? "Copiado" : "Copiar"}
      >
        {copied
          ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6 9 17l-5-5" />
              </svg>
            )
          : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="12" height="12" rx="2" />
                <path d="M5 15V5a2 2 0 0 1 2-2h10" />
              </svg>
            )}
      </button>
      <button
        type="button"
        className={`${base} ${rating === "up" ? "bg-violet-500/20 text-violet-400" : "text-slate-600 hover:bg-slate-900 hover:text-slate-300"}`}
        onClick={() => onRate("up")}
        aria-label="Esta respuesta me ha servido"
        aria-pressed={rating === "up"}
        title="Me ha servido"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M7 10v11H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z" />
          <path d="M7 10l4.5-7a2 2 0 0 1 3.4 2l-1.2 5H19a2 2 0 0 1 2 2.3l-1.1 6A2 2 0 0 1 18 21H7" />
        </svg>
      </button>
      <button
        type="button"
        className={`${base} ${rating === "down" ? "bg-red-500/20 text-red-400" : "text-slate-600 hover:bg-slate-900 hover:text-slate-300"}`}
        onClick={() => onRate("down")}
        aria-label="Esta respuesta no me ha servido"
        aria-pressed={rating === "down"}
        title="No me ha servido"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17 14V3h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1z" />
          <path d="M17 14l-4.5 7a2 2 0 0 1-3.4-2l1.2-5H5a2 2 0 0 1-2-2.3l1.1-6A2 2 0 0 1 6 3h11" />
        </svg>
      </button>
    </div>
  );
}
