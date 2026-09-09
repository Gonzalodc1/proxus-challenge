import { createMathPlugin } from "@streamdown/math";
import { Streamdown } from "streamdown";
import "katex/dist/katex.min.css";

/**
 * The one place markdown is rendered, chat and study panel alike.
 *
 * A tutor that teaches linear algebra writes formulas, and until now they
 * arrived as raw LaTeX: the student read `$A^T A \hat{x} = A^T b$` instead of
 * the equation. For a maths tutor that is not a cosmetic gap, it is the content
 * failing to arrive.
 *
 * `singleDollarTextMath` is on because models reach for `$...$` inline far more
 * often than the `$$...$$` that remark-math accepts by default.
 *
 * Centralised rather than configured twice so the chat and an artifact can
 * never drift into rendering the same formula differently.
 */
const plugins = {
  math: createMathPlugin({ singleDollarTextMath: true })
};

/**
 * Rewrites the LaTeX delimiters the model reaches for but remark-math does not
 * read: `\(inline\)` and `\[display\]`.
 *
 * The system prompt already asks for `$`/`$$`, so this is the safety net for
 * when it does it anyway, in the same spirit as the JSON escape repair in the
 * harness: fix what is unambiguous rather than let the student eat it.
 *
 * Deliberately narrow. Only these two bracket forms are touched, so ordinary
 * prose containing a dollar sign, a bracket or a stray backslash is left
 * exactly as written.
 */
const normalizeMath = (markdown: string) =>
  markdown
    .replace(/\\\[([\s\S]*?)\\\]/g, (_, body: string) => `$$${body}$$`)
    .replace(/\\\(([\s\S]*?)\\\)/g, (_, body: string) => `$${body}$`);

export function Markdown({ children }: { readonly children: string }) {
  return <Streamdown plugins={plugins}>{normalizeMath(children)}</Streamdown>;
}

/**
 * Same renderer, for text that lives inside a line rather than owning a block:
 * a question prompt, an answer option, the explanation under a correction.
 *
 * Those are the places a maths formula is most likely to appear and the ones
 * that were rendering it as raw source, because they were plain interpolated
 * strings. `md-inline` (see `styles.input.css`) strips the block margins so the
 * markup does not break the surrounding line.
 */
export function MarkdownInline({ children }: { readonly children: string }) {
  return (
    <span className="md-inline">
      <Streamdown plugins={plugins}>{normalizeMath(children)}</Streamdown>
    </span>
  );
}
