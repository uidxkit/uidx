/**
 * Neutralises a forged `</context>` so untrusted text can never end the
 * `<context>` fence `buildAgent` wraps around a document's own content early.
 * A design file can legitimately contain the literal text `</context>` — in a
 * text layer's `characters`, a name, a comment — and left alone that string
 * closes the fence early and lands author-controlled text back in the
 * instructions channel the model was just told to treat as data, not
 * commands.
 *
 * This is the one function that ever defuses the delimiter, so every producer
 * of text that can end up ahead of or inside the fence — the context pack,
 * the skill listing, a skill's body — runs its output through this rather
 * than each writing its own pattern. One implementation means one place to
 * get the pattern right, and no caller can forget to escape by rolling its
 * own.
 *
 * The fence is not markup any code parses — it is a convention the model
 * reads from plain text — so the match has to be tolerant, not literal.
 * `</Context>`, `</CONTEXT>`, `</ context>` and `</context >` read exactly as
 * "the trusted zone ended" to a model as the exact-case, unpadded spelling
 * does, so a case- and whitespace-insensitive pattern is what closes the gap.
 * The escape breaks the delimiter without deleting the content it was found
 * in.
 */
export function escapeContextFence(text: string): string {
  return text.replace(/<\s*\/\s*context\s*>/gi, '<\\/context>')
}
