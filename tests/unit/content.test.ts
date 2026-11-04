/**
 * The content gate. Everything under `scripts/content/original/**` is hand-authored text this
 * project owns, so it is validated here rather than only at build time: a malformed story or an
 * unattributed tip must fail `npm test`, which is what the release build runs.
 *
 * Files are read with node:fs so the test sees the authored source of truth, not a build product.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contentItemSchema } from '@/data/schema';
import type { ContentItem } from '@/domain/types';

// Vitest runs from the repository root, and under jsdom `import.meta.url` is an http: URL, so
// the authored sources are addressed relative to the working directory.
const CONTENT_ROOT = `${resolve(process.cwd(), 'scripts/content/original')}/`;

/** folder -> the only `kind` its files may declare, and the id prefix the build expects. */
const FOLDERS: { dir: string; kind: ContentItem['kind']; prefix: string }[] = [
  { dir: 'articles', kind: 'article', prefix: 'article-' },
  { dir: 'lessons', kind: 'lesson', prefix: 'lesson-' },
  { dir: 'stories', kind: 'story', prefix: 'story-' },
  { dir: 'tips', kind: 'tip', prefix: 'hint-' },
];

interface Loaded {
  file: string;
  dir: string;
  raw: unknown;
  item: ContentItem;
}

function loadFolder(dir: string, kind: ContentItem['kind']): Loaded[] {
  const out: Loaded[] = [];
  for (const name of readdirSync(CONTENT_ROOT + dir).sort()) {
    if (!name.endsWith('.json')) continue;
    const text = readFileSync(`${CONTENT_ROOT + dir}/${name}`, 'utf8');
    const raw: unknown = JSON.parse(text);
    // A content file that does not validate is a build-breaking authoring error: fail loudly,
    // naming the file and the schema issue instead of swallowing it into a filter.
    const parsed = contentItemSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(`${dir}/${name} does not satisfy contentItemSchema: ${JSON.stringify(parsed.error.issues)}`);
    }
    if (parsed.data.kind !== kind) {
      throw new Error(`${dir}/${name} declares kind "${String(parsed.data.kind)}" but lives in /${dir}`);
    }
    out.push({ file: name, dir, raw, item: parsed.data as ContentItem });
  }
  return out;
}

const ALL: Loaded[] = FOLDERS.flatMap(({ dir, kind }) => loadFolder(dir, kind));

/** Concatenated text of every block, for the "is there any Chinese in here" checks. */
function blockText(item: ContentItem): string {
  return item.blocks
    .map((block) => {
      if (block.type === 'dialogue') {
        return block.body.map((line) => `${line.speaker} ${line.zh} ${line.py} ${line.en}`).join('\n');
      }
      if (block.type === 'list') return `${block.title ?? ''}\n${block.body.join('\n')}`;
      return block.body;
    })
    .join('\n');
}

describe('authored content set', () => {
  it('is present in every documented folder', () => {
    expect(ALL.length, 'a vanished content tree must not read as "all green"').toBeGreaterThan(40);
    for (const { dir } of FOLDERS) {
      expect(ALL.filter((entry) => entry.dir === dir).length, dir).toBeGreaterThan(0);
    }
    // only the four kinds are authored here; anything else is a stray directory
    expect([...new Set(ALL.map((entry) => entry.dir))].sort()).toEqual(
      FOLDERS.map((entry) => entry.dir).sort(),
    );
  });

  it('validates every file against contentItemSchema', () => {
    for (const { file, dir, item } of ALL) {
      expect(item.id, `${dir}/${file}`).toBeTruthy();
      expect(item.title.length, `${dir}/${file} title`).toBeGreaterThan(3);
      expect(item.summary.length, `${dir}/${file} summary`).toBeGreaterThan(20);
      expect(['beginner', 'elementary', 'intermediate']).toContain(item.level);
      expect(item.blocks.length, `${dir}/${file} must have at least one block`).toBeGreaterThan(0);
      expect(Array.isArray(item.tags), `${dir}/${file} tags`).toBe(true);
    }
  });

  it('refuses a document that does not match the schema shape', () => {
    // the gate itself must reject the mistakes a human can make while editing JSON
    const sample = ALL[0]?.item;
    if (!sample) throw new Error('no authored content found');
    const broken: { why: string; doc: unknown }[] = [
      { why: 'an item with no body', doc: { ...sample, blocks: [] } },
      { why: 'an unlicensed item', doc: { ...sample, license: '' } },
      { why: 'a kind the app does not render', doc: { ...sample, kind: 'novel' } },
      { why: 'a level the app does not filter on', doc: { ...sample, level: 'advanced' } },
      { why: 'an item no route can address', doc: { ...sample, id: '' } },
      { why: 'a tag list written as a string', doc: { ...sample, tags: 'tones' } },
      { why: 'a block type with no renderer', doc: { ...sample, blocks: [{ type: 'mystery', body: 'x' }] } },
      {
        why: 'a dialogue line without English',
        doc: { ...sample, blocks: [{ type: 'dialogue', body: [{ speaker: 'A', zh: '你好', py: 'nǐ hǎo' }] }] },
      },
    ];
    for (const { why, doc } of broken) {
      expect(contentItemSchema.safeParse(doc).success, why).toBe(false);
    }
    expect(contentItemSchema.safeParse(sample).success).toBe(true);
    // an empty `list` body is well-formed JSON the schema tolerates; the authoring test above is
    // what forbids it, because zod checks shapes, not editorial quality.
    expect(contentItemSchema.safeParse({ ...sample, blocks: [{ type: 'list', body: [] }] }).success).toBe(true);
    // the schema deliberately does not police the attribution WORDING (only that one exists);
    // "must claim Original content" is this project's own authoring rule, asserted above.
    expect(
      contentItemSchema.safeParse({ ...sample, attribution: 'Some third party book' }).success,
    ).toBe(true);
  });

  it('gives every item a unique id that matches its file name', () => {
    const seen = new Map<string, string>();
    for (const { file, dir, item } of ALL) {
      const name = file.replace(/\.json$/, '');
      expect(item.id, `${dir}/${file}`).toBe(name);
      const previous = seen.get(item.id);
      expect(previous, `duplicate id "${item.id}" in ${previous} and ${dir}/${file}`).toBeUndefined();
      seen.set(item.id, `${dir}/${file}`);
      expect(item.id.startsWith(FOLDERS.find((entry) => entry.dir === dir)?.prefix ?? ''), item.id).toBe(true);
    }
  });

  it('declares the kind its folder promises', () => {
    for (const { dir, kind } of FOLDERS) {
      for (const { file, item } of ALL.filter((entry) => entry.dir === dir)) {
        expect(item.kind, `${dir}/${file}`).toBe(kind);
      }
    }
  });

  it('is licensed CC-BY-4.0 and attributed to this project', () => {
    for (const { file, dir, item } of ALL) {
      expect(item.license, `${dir}/${file}`).toBe('CC-BY-4.0');
      expect(
        item.attribution.startsWith('Original content'),
        `${dir}/${file} attribution must start with "Original content": ${item.attribution}`,
      ).toBe(true);
      // an owned item has no third-party source to cite, which is what the manifest rule keys on
      expect(item.attribution).not.toMatch(/CC BY-SA|CC0|public domain|CC-CEDICT/i);
    }
  });

  it('keeps every dialogue line complete in Chinese, pinyin and English', () => {
    let dialogueLines = 0;
    for (const { file, dir, item } of ALL) {
      for (const block of item.blocks) {
        if (block.type !== 'dialogue') continue;
        expect(block.body.length, `${dir}/${file} dialogue needs lines`).toBeGreaterThan(0);
        for (const [index, line] of block.body.entries()) {
          const where = `${dir}/${file} line ${index + 1}`;
          dialogueLines += 1;
          expect(line.speaker.trim().length, `${where} speaker`).toBeGreaterThan(0);
          expect(line.zh.trim().length, `${where} zh`).toBeGreaterThan(0);
          expect(line.py.trim().length, `${where} py`).toBeGreaterThan(0);
          expect(line.en.trim().length, `${where} en`).toBeGreaterThan(0);
          expect(line.zh, `${where} must be Chinese`).toMatch(/[\u3400-\u9fff]/);
          expect(line.py, `${where} pinyin is romanisation`).toMatch(/[A-Za-z\u00c0-\u02ff]/);
          expect(line.py, `${where} pinyin has no Han`).not.toMatch(/[\u3400-\u9fff]/);
          expect(line.en, `${where} English has no Han`).not.toMatch(/[\u3400-\u9fff]/);
        }
      }
    }
    expect(dialogueLines, 'the stories are meant to carry dialogue').toBeGreaterThan(20);
  });

  it('keeps list and text blocks non-empty and typed', () => {
    for (const { file, dir, item } of ALL) {
      for (const [index, block] of item.blocks.entries()) {
        const where = `${dir}/${file} block ${index + 1}`;
        if (block.type === 'list') {
          expect(block.body.length, `${where} empty list`).toBeGreaterThan(0);
          for (const entry of block.body) expect(entry.trim().length, where).toBeGreaterThan(0);
        } else if (block.type === 'dialogue') {
          for (const [index, line] of block.body.entries()) {
            expect(line.zh.trim().length, `${where} line ${index + 1}`).toBeGreaterThan(0);
            expect(line.en.trim().length, `${where} line ${index + 1}`).toBeGreaterThan(0);
          }
        } else {
          expect(block.body.trim().length, `${where} empty body`).toBeGreaterThan(0);
        }
      }
    }
  });

  it('carries Chinese in every language-teaching item', () => {
    // a lesson, story or article without one Han character is an English essay in the wrong
    // library; a tip may legitimately be pure study advice, so it is exempt.
    for (const { file, dir, item } of ALL) {
      if (item.kind === 'tip') continue;
      expect(blockText(item), `${dir}/${file} has no Chinese at all`).toMatch(/[\u3400-\u9fff]/);
    }
  });

  it('never mislabels English-only text as Chinese content', () => {
    // the reverse check: a dialogue "zh" line written in Latin letters would render as garbage
    for (const { file, dir, item } of ALL) {
      for (const block of item.blocks) {
        if (block.type !== 'dialogue') continue;
        for (const [index, line] of block.body.entries()) {
          expect(line.zh, `${dir}/${file} line ${index + 1} zh is not Latin text`).not.toMatch(/^[A-Za-z .,!'?-]+$/);
        }
      }
    }
  });

  it('keeps the raw JSON free of the fields the schema would silently drop', () => {
    // zod strips unknown keys, so a typo'd field (e.g. "titel") would vanish instead of failing;
    // the authored shape must stay exactly the documented one - no extra key, no missing key.
    const allowed = [
      'attribution',
      'blocks',
      'id',
      'kind',
      'level',
      'license',
      'summary',
      'tags',
      'title',
    ];
    for (const { file, dir, raw } of ALL) {
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        throw new Error(`${dir}/${file} is not an object`);
      }
      expect(Object.keys(raw).sort(), `${dir}/${file} top-level keys`).toEqual(allowed);
    }
  });
});
