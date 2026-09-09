/**
 * Repairs an escape models keep producing in JSON passed through the CLI.
 *
 * Payloads travel as JSON inside a quoted CLI argument, and asked for a Python
 * question the model reaches for text like `<class 'int'>` and escapes the
 * apostrophes out of caution. JSON has no `\'` escape, so parsing dies on
 * otherwise valid content and the agent burns steps retrying.
 *
 * Rewriting it is unambiguous rather than a guess: `\'` is never legal JSON, so
 * there is no correct document this could corrupt. Escaped backslashes are
 * matched first so a genuine `\\` before a quote is left alone.
 *
 * The skills also tell the model not to escape apostrophes. This is the
 * fallback for when it does it anyway. Pinned down by `test:unit`.
 */
export const repairInvalidQuoteEscapes = (json: string) =>
  json.replace(/\\\\.|\\'/g, (match) => (match === "\\'" ? "'" : match));
