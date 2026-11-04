/** Boundary validation for anything that crosses into the app from disk: the pack manifest,
 *  imported backup files and restored user data. Nothing unvalidated reaches storage. */

import { z } from 'zod';

export const packFileRefSchema = z.object({
  path: z.string().min(1),
  sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/, 'sha256 must be 64 lowercase hex characters'),
  bytes: z.number().int().nonnegative(),
  records: z.number().int().nonnegative().optional(),
});

export const packKindSchema = z.enum([
  'dictionary',
  'characters',
  'strokes',
  'examples',
  'content',
  'ocr',
]);

export const packDescriptorSchema = z
  .object({
    id: z.string().min(1),
    kind: packKindSchema,
    label: z.string().min(1),
    version: z.string().min(1),
    required: z.boolean(),
    license: z.string().min(1),
    sourceUrl: z.string().url().optional(),
    attribution: z.string().min(1),
    modifications: z.string().optional(),
    coverage: z.record(z.unknown()).optional(),
    bytes: z.number().int().nonnegative(),
    files: z.array(packFileRefSchema).min(1),
  })
  .superRefine((pack, ctx) => {
    // Third-party data must be attributable; original content is allowed to omit sourceUrl.
    const thirdParty = !/^CC-BY-4\.0$/.test(pack.license) && pack.attribution.indexOf('Original content') !== 0;
    if (thirdParty && !pack.sourceUrl) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sourceUrl'],
        message: `pack ${pack.id} is third-party and needs a sourceUrl`,
      });
    }
  });

export const packManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    generatedAt: z.string().min(1),
    minAppVersion: z.string().min(1),
    packs: z.array(packDescriptorSchema).min(1),
  })
  .superRefine((manifest, ctx) => {
    const seen = new Set<string>();
    for (const pack of manifest.packs) {
      if (seen.has(pack.id)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `duplicate pack id ${pack.id}` });
      }
      seen.add(pack.id);
      const paths = new Set<string>();
      for (const file of pack.files) {
        if (paths.has(file.path)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `duplicate file ${file.path} in pack ${pack.id}`,
          });
        }
        paths.add(file.path);
        if (file.path.startsWith('/') || file.path.includes('..')) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `unsafe path ${file.path} in pack ${pack.id}`,
          });
        }
      }
    }
  });

export type ValidatedManifest = z.infer<typeof packManifestSchema>;

export const contentBlockSchema = z.union([
  z.object({ type: z.literal('text'), body: z.string() }),
  z.object({
    type: z.literal('list'),
    title: z.string().optional(),
    body: z.array(z.string()),
  }),
  z.object({
    type: z.literal('dialogue'),
    title: z.string().optional(),
    body: z.array(
      z.object({ speaker: z.string(), zh: z.string(), py: z.string(), en: z.string() }),
    ),
  }),
  z.object({ type: z.literal('note'), body: z.string() }),
]);

export const contentItemSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['tip', 'lesson', 'story', 'article']),
  title: z.string().min(1),
  summary: z.string().min(1),
  level: z.enum(['beginner', 'elementary', 'intermediate']),
  license: z.string().min(1),
  attribution: z.string().min(1),
  tags: z.array(z.string()).default([]),
  blocks: z.array(contentBlockSchema).min(1),
});

/** Exported backups are versioned; importing an unknown version is refused, not guessed. */
export const EXPORT_VERSION = 1;

/** One store inside a backup: `store` is the IndexedDB table name, `rows` its records. */
export const exportedStoreSchema = z.object({
  store: z.string().min(1),
  rows: z.array(z.unknown()),
});

export const backupFileSchema = z.object({
  app: z.literal('hanyu-web'),
  exportVersion: z.number().int().positive(),
  exportedAt: z.string(),
  counts: z.record(z.number().int().nonnegative()).optional(),
  data: z.record(z.array(z.unknown())),
});

export type BackupFile = z.infer<typeof backupFileSchema>;

export function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
}
