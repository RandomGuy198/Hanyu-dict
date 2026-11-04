/**
 * The U+001F record encoding described in docs/DATA_FORMAT.md.
 *
 * Text packs are UTF-8, one record per line, fields separated by U+001F.
 * A field may never contain U+001F, U+0000, CR or LF; the writer throws
 * instead of emitting a record the runtime could mis-split.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ensureDir, sha256File, byteSize } from './fs.mjs';

export const US = String.fromCharCode(0x1f); // unit separator between fields
export const GS = String.fromCharCode(0x1d); // group separator (unused, reserved)
export const RS = String.fromCharCode(0x1e); // record separator, used in entry ids
export const FIELD_SEP = US;

/** Characters that can never appear inside a field: NUL, U+001F, CR, LF. */
const FORBIDDEN = new RegExp('[\\u0000\\u001F\\r\\n]');

export function assertFieldSafe(value, { label, index, fieldIndex }) {
  if (typeof value !== 'string') {
    throw new Error(`${label}: record ${index} field ${fieldIndex} is not a string (${typeof value})`);
  }
  if (FORBIDDEN.test(value)) {
    const why = [];
    if (value.includes(US)) why.push('U+001F');
    if (value.includes('\u0000')) why.push('NUL');
    if (/[\r\n]/.test(value)) why.push('newline');
    throw new Error(
      `${label}: record ${index} field ${fieldIndex} contains forbidden separator (${why.join(', ')}): ${JSON.stringify(
        value.slice(0, 80)
      )}`
    );
  }
  return value;
}

export function encodeRecord(fields, { label = 'record', index = -1 } = {}) {
  fields.forEach((f, i) => assertFieldSafe(f, { label, index, fieldIndex: i }));
  return fields.join(FIELD_SEP);
}

/** Streaming writer: one validated record per line. */
export class RecordWriter {
  constructor(file, fieldCount, label) {
    this.file = file;
    this.fieldCount = fieldCount;
    this.label = label || path.basename(file);
    this.records = 0;
    this.stream = null;
  }

  async open() {
    await ensureDir(path.dirname(this.file));
    this.stream = fs.createWriteStream(this.file, { encoding: 'utf8' });
    await new Promise((resolve, reject) => {
      this.stream.once('open', resolve);
      this.stream.once('error', reject);
    });
    return this;
  }

  write(fields) {
    if (!Array.isArray(fields)) throw new Error(`${this.label}: record ${this.records} is not an array`);
    if (fields.length !== this.fieldCount) {
      throw new Error(`${this.label}: record ${this.records} has ${fields.length} fields, expected ${this.fieldCount}`);
    }
    const line = encodeRecord(fields, { label: this.label, index: this.records });
    this.records++;
    return new Promise((resolve, reject) => {
      const ok = this.stream.write(`${line}\n`, (err) => (err ? reject(err) : resolve()));
      if (!ok) {
        this.stream.once('drain', () => resolve());
      }
    });
  }

  async close() {
    await new Promise((resolve, reject) => {
      this.stream.end((err) => (err ? reject(err) : resolve()));
    });
    this.stream = null;
    return this.summary();
  }

  async summary() {
    return {
      path: this.file,
      records: this.records,
      bytes: await byteSize(this.file),
      sha256: await sha256File(this.file),
    };
  }
}

/**
 * Validates a single already-decoded line of a text pack.
 * Returns the field array or throws with a precise message.
 */
export function decodeRecord(line, { fieldCount, label, lineNumber }) {
  if (line.includes('\u0000')) throw new Error(`${label}: line ${lineNumber} contains NUL`);
  const fields = line.split(FIELD_SEP);
  if (fields.length !== fieldCount) {
    throw new Error(`${label}: line ${lineNumber} has ${fields.length} fields, expected ${fieldCount}`);
  }
  fields.forEach((f, i) => {
    if (/[\r\n]/.test(f)) throw new Error(`${label}: line ${lineNumber} field ${i} contains a newline`);
  });
  return fields;
}
