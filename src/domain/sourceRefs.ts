/**
 * Parsing for the `sourceRefs` field of an examples record (docs/DATA_FORMAT.md):
 * `tatoeba:<id>:<author>` items joined with `+`.
 *
 * CC BY 2.0 FR obliges attribution to the contributors, but the pinned Tatoeba export names nobody -
 * the author segment is the literal `unknown` in every record. The id survives, and a Tatoeba
 * sentence page publishes its author, so the credit resolves in one click instead of being invented
 * offline. Malformed refs yield nothing rather than a guessed link.
 */
export const TATOEBA_SENTENCE_URL = 'https://tatoeba.org/en/sentences/show/';

/** Sentence ids in the given refs, in first-seen order, duplicates removed. */
export function tatoebaSentenceIds(refs: readonly string[]): string[] {
  const ids: string[] = [];
  for (const ref of refs) {
    const id = /^tatoeba:(\d+):/.exec(ref)?.[1];
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}
