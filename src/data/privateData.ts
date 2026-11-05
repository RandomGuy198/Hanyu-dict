/**
 * Private asset loader and IndexedDB cache (`db.remoteCache`) for `Hanyu-data`.
 *
 * Fetches books manifest, lesson JSONs, WebP page images, and audio blobs via `githubClient`
 * (or the local dev bridge `/__local_private_data__/*`) and caches them in IndexedDB.
 */

import { db } from './db';
import { fetchRepoRaw, hasGitHubPat } from './githubClient';
import {
  audioManifestSchema,
  booksManifestSchema,
  lessonDocumentSchema,
} from './schema';
import type {
  AudioManifest,
  BooksManifest,
  BookSummary,
  LessonDocument,
} from '../domain/types';

const activeObjectUrls = new Set<string>();

function normalizeLessonFile(bookId: string, lessonFileOrId: string): string {
  const cleaned = lessonFileOrId.trim().replace(/\.json$/i, '');
  const prefix = `${bookId.toLowerCase()}-`;
  const stem = cleaned.toLowerCase().startsWith(prefix)
    ? cleaned.slice(prefix.length)
    : cleaned;
  const formatted = /^l\d+$/i.test(stem)
    ? `l${stem.slice(1).padStart(2, '0')}`
    : /^\d+$/.test(stem)
      ? `l${stem.padStart(2, '0')}`
      : stem;
  return `books/${bookId}/lessons/${formatted}.json`;
}

function toBlob(data: unknown, mimeType: string): Blob | null {
  if (!data) return null;
  if (typeof Blob !== 'undefined' && data instanceof Blob) {
    return data;
  }
  if (data instanceof ArrayBuffer || Object.prototype.toString.call(data) === '[object ArrayBuffer]') {
    return new Blob([data as ArrayBuffer], { type: mimeType });
  }
  if (ArrayBuffer.isView(data)) {
    const copy = new Uint8Array(data.byteLength);
    copy.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    return new Blob([copy.buffer], { type: mimeType });
  }
  if (typeof data === 'object' && 'byteLength' in (data as Record<string, unknown>)) {
    return new Blob([data as ArrayBuffer], { type: mimeType });
  }
  return null;
}

export async function getBooksManifest(forceRefresh = false): Promise<BooksManifest | null> {
  const path = 'books/manifest.json';
  if (!forceRefresh) {
    const cached = await db.remoteCache.get(path);
    if (cached?.data) {
      const parsed = booksManifestSchema.safeParse(cached.data);
      if (parsed.success) return parsed.data;
    }
  }

  try {
    const response = await fetchRepoRaw(path);
    const raw = (await response.json()) as unknown;
    const parsed = booksManifestSchema.safeParse(raw);
    if (!parsed.success) return null;
    await db.remoteCache.put({
      path,
      category: 'manifest',
      version: parsed.data.generatedAt,
      data: parsed.data,
      updatedAt: new Date().toISOString(),
    });
    return parsed.data;
  } catch {
    const fallback = await db.remoteCache.get(path);
    if (fallback?.data) {
      const parsed = booksManifestSchema.safeParse(fallback.data);
      if (parsed.success) return parsed.data;
    }
    return null;
  }
}

export async function getBookDetail(bookId: string): Promise<BookSummary | null> {
  const manifest = await getBooksManifest();
  if (!manifest) return null;
  return manifest.books.find((book) => book.bookId === bookId) ?? null;
}

export async function getLessonDocument(
  bookId: string,
  lessonFileOrId: string,
): Promise<LessonDocument | null> {
  const path = normalizeLessonFile(bookId, lessonFileOrId);
  const manifest = await getBooksManifest();
  const expectedVersion = manifest?.generatedAt;

  const cached = await db.remoteCache.get(path);
  if (cached?.data && (!expectedVersion || cached.version === expectedVersion)) {
    const parsed = lessonDocumentSchema.safeParse(cached.data);
    if (parsed.success) return parsed.data;
  }

  try {
    const response = await fetchRepoRaw(path);
    const raw = (await response.json()) as unknown;
    const parsed = lessonDocumentSchema.safeParse(raw);
    if (!parsed.success) return null;
    await db.remoteCache.put({
      path,
      category: 'lesson',
      version: expectedVersion ?? new Date().toISOString(),
      data: parsed.data,
      updatedAt: new Date().toISOString(),
    });
    return parsed.data;
  } catch {
    if (cached?.data) {
      const parsed = lessonDocumentSchema.safeParse(cached.data);
      if (parsed.success) return parsed.data;
    }
    return null;
  }
}

export async function getPageImageBlobUrl(imagePath: string): Promise<string | null> {
  const path = imagePath.replace(/^\/+/, '');
  const cached = await db.remoteCache.get(path);
  if (cached?.data) {
    const blob = toBlob(cached.data, 'image/webp');
    if (blob) {
      const url = URL.createObjectURL(blob);
      activeObjectUrls.add(url);
      return url;
    }
  }

  try {
    const response = await fetchRepoRaw(path);
    const buffer = await response.arrayBuffer();
    const blob = new Blob([buffer], { type: 'image/webp' });
    await db.remoteCache.put({
      path,
      category: 'page',
      data: buffer,
      updatedAt: new Date().toISOString(),
    });
    const url = URL.createObjectURL(blob);
    activeObjectUrls.add(url);
    return url;
  } catch {
    return null;
  }
}

export async function getAudioBlob(audioPath: string): Promise<Blob | null> {
  const path = audioPath.replace(/^\/+/, '');
  const cached = await db.remoteCache.get(path);
  if (cached?.data) {
    const blob = toBlob(cached.data, 'audio/mpeg');
    if (blob) return blob;
  }

  try {
    const response = await fetchRepoRaw(path);
    const buffer = await response.arrayBuffer();
    const blob = new Blob([buffer], { type: 'audio/mpeg' });
    await db.remoteCache.put({
      path,
      category: 'audio',
      data: buffer,
      updatedAt: new Date().toISOString(),
    });
    return blob;
  } catch {
    return null;
  }
}

export async function getAudioManifest(forceRefresh = false): Promise<AudioManifest | null> {
  const path = 'audio/manifest.json';
  if (!forceRefresh) {
    const cached = await db.remoteCache.get(path);
    if (cached?.data) {
      const parsed = audioManifestSchema.safeParse(cached.data);
      if (parsed.success) return parsed.data;
    }
  }

  try {
    const response = await fetchRepoRaw(path);
    const raw = (await response.json()) as unknown;
    const parsed = audioManifestSchema.safeParse(raw);
    if (!parsed.success) return null;
    await db.remoteCache.put({
      path,
      category: 'manifest',
      version: parsed.data.generatedAt,
      data: parsed.data,
      updatedAt: new Date().toISOString(),
    });
    return parsed.data;
  } catch {
    const fallback = await db.remoteCache.get(path);
    if (fallback?.data) {
      const parsed = audioManifestSchema.safeParse(fallback.data);
      if (parsed.success) return parsed.data;
    }
    return null;
  }
}

export async function clearPrivateCache(): Promise<void> {
  for (const url of activeObjectUrls) {
    try {
      URL.revokeObjectURL(url);
    } catch {
      // Ignore revoke errors
    }
  }
  activeObjectUrls.clear();
  await db.remoteCache.clear();
}

export async function isPrivateDataAvailable(): Promise<boolean> {
  if (hasGitHubPat()) return true;
  try {
    const response = await fetch('/__local_private_data__/books/manifest.json', {
      method: 'GET',
    });
    return response.status === 200;
  } catch {
    return false;
  }
}
