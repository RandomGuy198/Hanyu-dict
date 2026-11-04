/**
 * build-content.mjs - original, project-authored learning content -> public/data/packs/<pack>/
 *
 * Nothing here is scraped, transcribed or derived from a third-party product. Every file under
 * `scripts/content/original/<kind>/*.json` was written for this project and is licensed CC BY 4.0
 * (see the `original` source in scripts/content/provenance.json).
 *
 * Each source file is ONE content item and is packaged as one pack file, so the runtime can read
 * a single lesson without parsing the whole corpus. The manifest records one file per item.
 *
 * Validation is a hard gate: an item that does not satisfy the schema the app enforces
 * (src/data/schema.ts, mirrored here) aborts the build rather than shipping a broken screen.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { DATA_DIR, PACKS_DIR, CONTENT_DIR, ensureDir, exists, formatBytes, sha256File, table, log } from './lib/fs.mjs';
import { PACK_DEFS } from './lib/packs.mjs';

const require = createRequire(import.meta.url);
const { z } = require('zod');

const ORIGINAL_DIR = path.join(CONTENT_DIR, 'original');

/** pack id -> authored source folder. */
const PACK_SOURCE_DIRS = {
  'content-tips': 'tips',
  'content-lessons': 'lessons',
  'content-stories': 'stories',
  'content-articles': 'articles',
};

const KIND_BY_DIR = { tips: 'tip', lessons: 'lesson', stories: 'story', articles: 'article' };

/** Mirrors contentItemSchema in src/data/schema.ts. Kept in sync by tests/unit/content.test.ts. */
const blockSchema = z.union([
  z.object({ type: z.literal('text'), body: z.string().min(1) }),
  z.object({ type: z.literal('list'), title: z.string().optional(), body: z.array(z.string().min(1)).min(1) }),
  z.object({
    type: z.literal('dialogue'),
    title: z.string().optional(),
    body: z
      .array(
        z.object({
          speaker: z.string().min(1),
          zh: z.string().min(1),
          py: z.string().min(1),
          en: z.string().min(1),
        })
      )
      .min(1),
  }),
  z.object({ type: z.literal('note'), body: z.string().min(1) }),
]);

const itemSchema = z.object({
  id: z.string().min(3),
  kind: z.enum(['tip', 'lesson', 'story', 'article']),
  title: z.string().min(3),
  summary: z.string().min(10),
  level: z.enum(['beginner', 'elementary', 'intermediate']),
  license: z.string().min(1),
  attribution: z.string().min(1),
  tags: z.array(z.string().min(1)).default([]),
  blocks: z.array(blockSchema).min(1),
});

const KEY_ORDER = ['id', 'kind', 'title', 'summary', 'level', 'license', 'attribution', 'tags', 'blocks'];
const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

/** Deterministic key order so a rebuild of unchanged content produces identical bytes. */
function canonical(item) {
  const out = {};
  for (const key of KEY_ORDER) if (item[key] !== undefined) out[key] = item[key];
  for (const key of Object.keys(item).sort()) if (!(key in out)) out[key] = item[key];
  return out;
}

function listFiles(dir) {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort();
}

export async function build({ quiet = false } = {}) {
  if (!exists(ORIGINAL_DIR)) throw new Error(`missing original content directory ${ORIGINAL_DIR}`);

  const globalIds = new Map();
  const packs = [];

  for (const [packId, dirName] of Object.entries(PACK_SOURCE_DIRS)) {
    const srcDir = path.join(ORIGINAL_DIR, dirName);
    const outDir = path.join(PACKS_DIR, packId);
    if (!exists(srcDir)) {
      log(`content ${packId}: no source directory ${path.relative(process.cwd(), srcDir)}, skipping pack`);
      continue;
    }

    const problems = [];
    const files = [];
    let records = 0;
    let cjkItems = 0;

    for (const name of listFiles(srcDir)) {
      const full = path.join(srcDir, name);
      let parsed;
      try {
        parsed = itemSchema.parse(JSON.parse(fs.readFileSync(full, 'utf8')));
      } catch (error) {
        problems.push(`${name}: ${error instanceof z.ZodError ? error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ') : error.message}`);
        continue;
      }

      if (parsed.kind !== KIND_BY_DIR[dirName]) {
        problems.push(`${name}: kind "${parsed.kind}" does not match its folder (${KIND_BY_DIR[dirName]})`);
        continue;
      }
      if (parsed.license !== 'CC-BY-4.0') problems.push(`${name}: original content must be CC-BY-4.0, got ${parsed.license}`);
      if (!parsed.attribution.startsWith('Original content')) {
        problems.push(`${name}: attribution must start with "Original content", got ${JSON.stringify(parsed.attribution)}`);
      }
      if (globalIds.has(parsed.id)) {
        problems.push(`${name}: duplicate id "${parsed.id}" (already used by ${globalIds.get(parsed.id)})`);
        continue;
      }
      globalIds.set(parsed.id, name);
      if (CJK.test(JSON.stringify(parsed.blocks))) cjkItems++;

      const out = path.join(outDir, name);
      await ensureDir(outDir);
      fs.writeFileSync(out, `${JSON.stringify(canonical(parsed), null, 2)}\n`, 'utf8');
      const summary = await sha256File(out);
      files.push({
        path: path.relative(DATA_DIR, out).replace(/\\/g, '/'),
        sha256: summary,
        bytes: fs.statSync(out).size,
        records: 1,
      });
      records++;
    }

    if (problems.length) {
      throw new Error(`content pack ${packId} has ${problems.length} invalid file(s):\n  ${problems.join('\n  ')}`);
    }
    if (!files.length) throw new Error(`content pack ${packId}: no valid items produced`);

    await clearStale(outDir, files);
    packs.push({
      packId,
      files,
      coverage: {
        records,
        languages: PACK_DEFS[packId].languages,
        withChinese: cjkItems,
        levels: null,
      },
      stats: { items: records, withChinese: cjkItems },
    });
  }

  if (!quiet) {
    for (const pack of packs) {
      const bytes = pack.files.reduce((s, f) => s + f.bytes, 0);
      log(`content ${pack.packId}: ${pack.stats.items} items, ${pack.stats.withChinese} with Chinese text (${formatBytes(bytes)})`);
      log(
        table(
          pack.files.slice(0, 3).map((f) => ({ file: f.path, sha: f.sha256.slice(0, 12) })),
          [
            ['file', 'file'],
            ['sha256', 'sha'],
          ]
        )
      );
    }
  }

  return { packs };
}

/** Remove generated files that no longer correspond to a source item. */
async function clearStale(outDir, kept) {
  if (!exists(outDir)) return;
  const keep = new Set(kept.map((f) => path.basename(path.join(DATA_DIR, f.path))));
  for (const name of fs.readdirSync(outDir)) {
    if (!keep.has(name)) fs.rmSync(path.join(outDir, name), { force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await build({});
  console.log(JSON.stringify({ packs: result.packs.map((p) => ({ id: p.packId, items: p.stats.items })), generated: true }, null, 2));
}
