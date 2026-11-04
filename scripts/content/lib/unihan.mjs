/**
 * Unicode Unihan loader.
 *
 * Only the fields named by docs/DATA_FORMAT.md are read:
 *   kMandarin, kCantonese, kDefinition (Unihan_Readings.txt)
 *   kSimplifiedVariant, kTraditionalVariant (Unihan_Variants.txt)
 *   kRSUnicode, kTotalStrokes (Unihan_IRGSources.txt)
 */
import { unzipMemberText } from './archive.mjs';

export const UNIHAN_FILES = {
  'Unihan_Readings.txt': ['kMandarin', 'kCantonese', 'kDefinition'],
  'Unihan_Variants.txt': ['kSimplifiedVariant', 'kTraditionalVariant'],
  'Unihan_IRGSources.txt': ['kRSUnicode', 'kTotalStrokes'],
};

/** Variant lists are capped so a single record cannot bloat a shard. */
export const VARIANT_CAP = 6;

/**
 * @param {string} zipPath path to the cached Unihan.zip
 * @returns {{byCodePoint: Map<string, object>, versions: string[]}}
 */
export function loadUnihan(zipPath) {
  const byCodePoint = new Map();
  const header = { unicodeVersion: null, date: null };

  const touch = (cp) => {
    let rec = byCodePoint.get(cp);
    if (!rec) {
      rec = { codepoint: cp, char: String.fromCodePoint(parseInt(cp, 16)) };
      byCodePoint.set(cp, rec);
    }
    return rec;
  };

  for (const [file, wanted] of Object.entries(UNIHAN_FILES)) {
    const text = unzipMemberText(zipPath, file);
    const wantedSet = new Set(wanted);
    for (const line of text.split('\n')) {
      if (line.startsWith('# @') || line.startsWith('#@')) {
        const m = line.match(/Unicode Version (\d+\.\d+\.\d+)/);
        if (m) header.unicodeVersion = m[1];
        const d = line.match(/# @date:\s*(\S+)/);
        if (d) header.date = d[1];
        continue;
      }
      if (!line.startsWith('U+')) continue;
      const tab = line.indexOf('\t');
      if (tab <= 0) continue;
      const cp = line.slice(2, tab);
      const rest = line.slice(tab + 1);
      const eq = rest.indexOf('\t');
      if (eq === -1) continue;
      const field = rest.slice(0, eq);
      if (!wantedSet.has(field)) continue;
      const value = rest.slice(eq + 1).trim();
      const rec = touch(cp);
      if (field === 'kRSUnicode') rec.kRSUnicode = value;
      else if (field === 'kTotalStrokes') rec.kTotalStrokes = value;
      else if (field === 'kMandarin') rec.kMandarin = value;
      else if (field === 'kCantonese') rec.kCantonese = value;
      else if (field === 'kDefinition') rec.kDefinition = value;
      else if (field === 'kSimplifiedVariant') rec.kSimplifiedVariant = value;
      else if (field === 'kTraditionalVariant') rec.kTraditionalVariant = value;
    }
  }

  if (header.unicodeVersion == null) {
    // fall back to the plain `# Unicode Version x.y.z` comment line
    const text = unzipMemberText(zipPath, 'Unihan_Readings.txt');
    const m = text.match(/# Unicode Version (\d+\.\d+\.\d+)/);
    if (m) header.unicodeVersion = m[1];
  }
  return { byCodePoint, header };
}

/** `1.0` / `70'4` -> `70'4`; only the first value of the field is kept. */
export function normalizeRadical(value) {
  if (!value) return '';
  const first = value.trim().split(/\s+/)[0];
  const m = first.match(/^(\d+)(?:[.''](\d+))?/);
  if (!m) return '';
  const radical = String(Number(m[1]));
  const rest = m[2] === undefined ? '' : String(Number(m[2]));
  return `${radical}'${rest}`;
}

/**
 * Unihan writes variant fields as `U+3476 U+4E00 ...` in Unicode 16. Normalise to plain
 * lowercase hex tokens so every downstream helper has one format to deal with.
 */
export function hexTokens(value) {
  if (!value) return '';
  return value
    .trim()
    .split(/\s+/)
    .map((token) => token.replace(/^U\+/i, ''))
    .filter((token) => /^[0-9A-Fa-f]{4,6}$/.test(token))
    .join(' ');
}

/** First value of a possibly multi-valued field, with the `U+` prefix removed. */
export function firstValue(value) {
  if (!value) return '';
  return hexTokens(value).split(/\s+/)[0] || '';
}

/** Space separated hex codepoints, capped, lowercased. */
export function codePointList(value, cap = VARIANT_CAP) {
  const tokens = hexTokens(value).split(/\s+/).filter(Boolean);
  return tokens.slice(0, cap).join(' ');
}

/**
 * Char -> single codepoint maps used for simplified/traditional conversion of
 * running text. Unihan is one-to-many; the first listed variant is used and the
 * mapping stays empty for characters without any (a documented gap).
 */
export function variantMaps(byCodePoint) {
  const toSimplified = new Map();
  const toTraditional = new Map();
  for (const [cp, rec] of byCodePoint) {
    const char = String.fromCodePoint(parseInt(cp, 16));
    const simp = firstValue(rec.kSimplifiedVariant);
    if (simp) toSimplified.set(char, String.fromCodePoint(parseInt(simp, 16)));
    const trad = firstValue(rec.kTraditionalVariant);
    if (trad) toTraditional.set(char, String.fromCodePoint(parseInt(trad, 16)));
  }
  return { toSimplified, toTraditional };
}

export function convertCase(text, map) {
  let out = '';
  for (const ch of text) {
    out += map.get(ch) ?? ch;
  }
  return out;
}
