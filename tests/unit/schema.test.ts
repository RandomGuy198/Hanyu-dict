/**
 * Boundary validation tests: the pack manifest, content items and backup envelopes must be refused
 * before anything reaches IndexedDB, with a message the learner can act on.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  backupFileSchema,
  contentBlockSchema,
  contentItemSchema,
  EXPORT_VERSION,
  formatIssues,
  packDescriptorSchema,
  packFileRefSchema,
  packManifestSchema,
} from '@/data/schema';

const SHA = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'; // sha256 of ""

function fileRef(overrides: Record<string, unknown> = {}) {
  return {
    path: 'packs/dictionary-core/000.txt',
    sha256: SHA,
    bytes: 1234,
    records: 8192,
    ...overrides,
  };
}

function packFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 'dictionary-core',
    kind: 'dictionary',
    label: 'CC-CEDICT words',
    version: '1.0.46',
    required: true,
    license: 'CC-BY-SA-4.0',
    sourceUrl: 'https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.zip',
    attribution: 'CC-CEDICT community maintenance project (CC-CEDICT.org) and contributors.',
    modifications: 'Re-keyed into a canonical schema; pinyin variants precomputed.',
    coverage: { records: 124484, languages: ['zh-Hans', 'zh-Hant', 'en'] },
    bytes: 12345678,
    files: [fileRef()],
    ...overrides,
  };
}

function manifestFixture(packs: unknown[] = [packFixture()]) {
  return {
    schemaVersion: 1,
    generatedAt: '2026-11-04T00:00:00.000Z',
    minAppVersion: '1.0.0',
    packs,
  };
}

/** All issues from a failed parse, joined for readable assertions. */
function issuesOf(error: z.ZodError): string {
  return formatIssues(error);
}

function expectRejected(result: z.SafeParseReturnType<unknown, unknown>, needle: string): void {
  expect(result.success).toBe(false);
  if (result.success) return;
  const text = issuesOf(result.error);
  expect(text).toContain(needle);
  expect(text.length).toBeGreaterThan(needle.length); // a message with context, not a bare code
}

describe('packManifestSchema accepts real data', () => {
  it('accepts the documented manifest', () => {
    const parsed = packManifestSchema.safeParse(manifestFixture());
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.packs[0].id).toBe('dictionary-core');
    expect(parsed.data.packs[0].files[0].path).toBe('packs/dictionary-core/000.txt');
  });

  it('accepts a multi-pack registry mixing third-party and original content', () => {
    const parsed = packManifestSchema.safeParse(
      manifestFixture([
        packFixture(),
        packFixture({
          id: 'characters',
          kind: 'characters',
          label: 'Unihan character data',
          version: '16.0.0',
          required: true,
          license: 'Unicode-3.0',
          sourceUrl: 'https://www.unicode.org/Public/UCD/latest/ucd/Unihan.zip',
          attribution: 'The Unicode Consortium.',
          bytes: 4321,
          files: [
            fileRef({ path: 'packs/characters/000.txt', records: 2048 }),
            fileRef({ path: 'packs/characters/001.txt', records: 2048 }),
          ],
        }),
        packFixture({
          id: 'content',
          kind: 'content',
          label: 'Original learning content',
          version: '2026-11-04',
          required: false,
          license: 'CC-BY-4.0',
          sourceUrl: undefined,
          attribution: 'Original content authored for this project.',
          bytes: 900,
          files: [fileRef({ path: 'packs/content/lesson-001.json', bytes: 900, records: 1 })],
        }),
      ]),
    );
    expect(parsed.success).toBe(true);
  });

  it('accepts an optional file record count and a pack without modifications', () => {
    const minimal = packDescriptorSchema.safeParse({
      ...packFixture(),
      modifications: undefined,
      coverage: undefined,
      files: [{ path: 'packs/strokes/000.jsonl', sha256: SHA, bytes: 0 }],
    });
    expect(minimal.success).toBe(true);
    expect(packFileRefSchema.safeParse({ path: 'a.txt', sha256: SHA, bytes: 0 }).success).toBe(true);
  });
});

describe('packManifestSchema refuses malformed registries', () => {
  it('refuses any schemaVersion other than 1', () => {
    for (const schemaVersion of [0, 2, 1.5, '1', null, undefined]) {
      const parsed = packManifestSchema.safeParse({ ...manifestFixture(), schemaVersion });
      expect(parsed.success).toBe(false);
    }
  });

  it('refuses a registry with no packs', () => {
    expectRejected(packManifestSchema.safeParse({ ...manifestFixture(), packs: [] }), 'at least 1');
  });

  it('refuses an unknown pack kind', () => {
    expectRejected(
      packManifestSchema.safeParse(manifestFixture([packFixture({ kind: 'audio' })])),
      'Invalid enum value',
    );
  });

  it('refuses duplicate pack ids', () => {
    expectRejected(
      packManifestSchema.safeParse(manifestFixture([packFixture(), packFixture()])),
      'duplicate pack id dictionary-core',
    );
  });

  it('refuses duplicate file paths inside one pack', () => {
    expectRejected(
      packManifestSchema.safeParse(
        manifestFixture([packFixture({ files: [fileRef(), fileRef()] })]),
      ),
      'duplicate file packs/dictionary-core/000.txt in pack dictionary-core',
    );
  });

  it('refuses unsafe file paths, and says which one', () => {
    for (const path of ['/etc/passwd', '../secrets.txt', 'packs/../../private/0.txt']) {
      expectRejected(
        packManifestSchema.safeParse(manifestFixture([packFixture({ files: [fileRef({ path })] })])),
        `unsafe path ${path} in pack dictionary-core`,
      );
    }
  });

  it('refuses a non-hex or wrong-length sha256', () => {
    const badDigests = [
      'zzz0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      SHA.slice(0, 63), // 63 characters
      `${SHA}0`, // 65 characters
      SHA.toUpperCase(), // uppercase hex is not what the installer compares
      '',
    ];
    for (const sha256 of badDigests) {
      expectRejected(
        packManifestSchema.safeParse(manifestFixture([packFixture({ files: [fileRef({ sha256 })] })])),
        'sha256 must be 64 lowercase hex characters',
      );
    }
  });

  it('refuses a missing sha256, license or attribution', () => {
    for (const key of ['sha256', 'bytes', 'path']) {
      const broken: Record<string, unknown> = { ...fileRef() };
      delete broken[key];
      expect(packManifestSchema.safeParse(manifestFixture([packFixture({ files: [broken] })])).success).toBe(
        false,
      );
    }
    for (const key of ['license', 'attribution', 'label', 'version', 'id']) {
      const broken: Record<string, unknown> = { ...packFixture() };
      delete broken[key];
      expect(packDescriptorSchema.safeParse(broken).success).toBe(false);
    }
  });

  it('refuses negative byte counts on a pack and on its files', () => {
    expectRejected(
      packManifestSchema.safeParse(manifestFixture([packFixture({ bytes: -1 })])),
      'greater than or equal to 0',
    );
    expectRejected(
      packManifestSchema.safeParse(
        manifestFixture([packFixture({ files: [fileRef({ bytes: -1024 })] })]),
      ),
      'greater than or equal to 0',
    );
  });

  it('refuses a fractional byte count, which cannot be a real file size', () => {
    expect(
      packManifestSchema.safeParse(manifestFixture([packFixture({ bytes: 12.5 })])).success,
    ).toBe(false);
  });

  it('refuses a pack that declares no files', () => {
    expectRejected(
      packManifestSchema.safeParse(manifestFixture([packFixture({ files: [] })])),
      'at least 1',
    );
  });

  it('refuses a third-party pack with no sourceUrl, and names the pack', () => {
    expectRejected(
      packManifestSchema.safeParse(
        manifestFixture([packFixture({ sourceUrl: undefined, license: 'CC-BY-SA-4.0' })]),
      ),
      'pack dictionary-core is third-party and needs a sourceUrl',
    );
  });

  it('refuses a badly formed sourceUrl but lets original content omit it', () => {
    expectRejected(
      packManifestSchema.safeParse(manifestFixture([packFixture({ sourceUrl: 'mdbg.net' })])),
      'Invalid url',
    );
    expect(
      packDescriptorSchema.safeParse(
        packFixture({
          id: 'content',
          kind: 'content',
          license: 'CC-BY-4.0',
          sourceUrl: undefined,
          attribution: 'Original content authored for this project.',
        }),
      ).success,
    ).toBe(true);
    // Attribution is the other accepted proof that a pack is ours, even under another licence id.
    expect(
      packDescriptorSchema.safeParse(
        packFixture({ license: 'CC0-1.0', sourceUrl: undefined, attribution: 'Original content here.' }),
      ).success,
    ).toBe(true);
  });

  it('refuses a manifest that is not an object at all', () => {
    for (const junk of [null, undefined, 42, 'manifest', []]) {
      expect(packManifestSchema.safeParse(junk).success).toBe(false);
    }
  });
});

describe('contentItemSchema', () => {
  const base = {
    id: 'lesson-001',
    kind: 'lesson',
    title: 'Four tones and one light one',
    summary: 'Hear, shape, and mark the four Mandarin tones.',
    level: 'beginner',
    license: 'CC-BY-4.0',
    attribution: 'Original content authored for this project.',
    tags: ['tones'],
    blocks: [{ type: 'text', body: 'Tone one is high and flat.' }],
  };

  it('accepts every documented block shape', () => {
    const blocks = [
      { type: 'text', body: 'plain prose' },
      { type: 'note', body: 'a caveat' },
      { type: 'list', title: 'Try these', body: ['天空 tiānkōng', '学习 xuéxí'] },
      { type: 'list', body: [] },
      {
        type: 'dialogue',
        title: 'Listen',
        body: [{ speaker: 'A', zh: '他喝茶。', py: 'tā hē chá.', en: 'He drinks tea.' }],
      },
      { type: 'dialogue', body: [] },
    ];
    for (const block of blocks) {
      expect(contentBlockSchema.safeParse(block).success).toBe(true);
      expect(contentItemSchema.safeParse({ ...base, blocks: [block] }).success).toBe(true);
    }
  });

  it('refuses an unknown block type and a block with no body', () => {
    expect(contentBlockSchema.safeParse({ type: 'video', body: 'x' }).success).toBe(false);
    expect(contentBlockSchema.safeParse({ type: 'text' }).success).toBe(false);
    expect(contentBlockSchema.safeParse({ type: 'list', body: 'not an array' }).success).toBe(false);
  });

  it('refuses a dialogue line missing any of zh, py or en', () => {
    const line = { speaker: 'A', zh: '他喝茶。', py: 'tā hē chá.', en: 'He drinks tea.' };
    for (const key of ['zh', 'py', 'en', 'speaker']) {
      const broken: Record<string, unknown> = { ...line };
      delete broken[key];
      expect(
        contentBlockSchema.safeParse({ type: 'dialogue', body: [broken] }).success,
      ).toBe(false);
    }
  });

  it('refuses an empty item: no blocks, no id, no title, no summary', () => {
    for (const overrides of [
      { blocks: [] },
      { id: '' },
      { title: '' },
      { summary: '' },
      { attribution: '' },
      { license: '' },
    ]) {
      expect(contentItemSchema.safeParse({ ...base, ...overrides }).success).toBe(false);
    }
  });

  it('refuses an unknown kind or level', () => {
    expect(contentItemSchema.safeParse({ ...base, kind: 'worksheet' }).success).toBe(false);
    expect(contentItemSchema.safeParse({ ...base, level: 'advanced' }).success).toBe(false);
  });

  it('defaults tags to an empty array instead of failing a file over them', () => {
    const withoutTags: Record<string, unknown> = { ...base };
    delete withoutTags.tags;
    const parsed = contentItemSchema.safeParse(withoutTags);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.tags).toEqual([]);
  });
});

describe('backupFileSchema and EXPORT_VERSION', () => {
  it('accepts the envelope the exporter writes', () => {
    const parsed = backupFileSchema.safeParse({
      app: 'hanyu-web',
      exportVersion: EXPORT_VERSION,
      exportedAt: '2026-11-04T10:00:00.000Z',
      counts: { savedWords: 2 },
      data: { savedWords: [{ id: 'x' }] },
    });
    expect(parsed.success).toBe(true);
  });

  it('refuses a foreign or truncated file', () => {
    expect(backupFileSchema.safeParse({ app: 'other', exportVersion: 1, exportedAt: '', data: {} }).success).toBe(
      false,
    );
    expect(backupFileSchema.safeParse({ app: 'hanyu-web' }).success).toBe(false);
    expect(backupFileSchema.safeParse('{"app":"hanyu-web"}').success).toBe(false);
  });

  it('refuses a non-positive or fractional exportVersion rather than guessing', () => {
    for (const exportVersion of [0, -1, 1.5, '1']) {
      expect(
        backupFileSchema.safeParse({
          app: 'hanyu-web',
          exportVersion,
          exportedAt: '2026-11-04T10:00:00.000Z',
          data: {},
        }).success,
      ).toBe(false);
    }
  });

  it('refuses data rows that are not keyed per store', () => {
    expect(
      backupFileSchema.safeParse({
        app: 'hanyu-web',
        exportVersion: EXPORT_VERSION,
        exportedAt: 'x',
        data: { savedWords: { id: 'not an array' } },
      }).success,
    ).toBe(false);
  });

  it('EXPORT_VERSION is the single version the app both writes and reads', () => {
    expect(EXPORT_VERSION).toBe(1);
  });
});

describe('formatIssues', () => {
  it('renders one actionable line per problem, with the field path', () => {
    const failed = packManifestSchema.safeParse(
      manifestFixture([
        packFixture({ files: [fileRef({ path: '/tmp/x' }), fileRef({ path: '../y' })] }),
      ]),
    );
    expect(failed.success).toBe(false);
    if (failed.success) return;
    const rendered = formatIssues(failed.error);
    expect(rendered.split('\n')).toHaveLength(failed.error.issues.length);
    expect(rendered).toContain('unsafe path /tmp/x in pack dictionary-core');
    expect(rendered).toContain('unsafe path ../y in pack dictionary-core');
    for (const line of rendered.split('\n')) expect(line).toMatch(/^(.+?)?: .+$/);
  });

  it('names the field the author has to fix', () => {
    const failed = packManifestSchema.safeParse(
      manifestFixture([packFixture({ sourceUrl: undefined })]),
    );
    expect(failed.success).toBe(false);
    if (failed.success) return;
    const rendered = formatIssues(failed.error);
    expect(rendered).toContain('pack dictionary-core is third-party and needs a sourceUrl');
    expect(rendered).toContain('sourceUrl:');
  });

  it('labels root-level problems so a message is never blank', () => {
    const failed = packManifestSchema.safeParse('not-a-manifest');
    expect(failed.success).toBe(false);
    if (failed.success) return;
    const rendered = formatIssues(failed.error);
    expect(rendered).toContain('(root)');
    expect(rendered).not.toBe('');
  });
});
