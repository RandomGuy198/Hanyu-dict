/**
 * Search engine tests: index construction from the documented U+001F record shape, the ranking
 * rubric, determinism of `compareResults`, edit-distance bounds, query normalisation, pinyin
 * matching in all its spellings, initials abbreviations and longest-first reader spans.
 */
import { describe, expect, it } from 'vitest';
import { DictionaryIndex } from '@/domain/searchIndex';
import {
  SCORE,
  buildEntry,
  compareResults,
  detectMode,
  editDistance,
  entryId,
  foldVietnamese,
  initialsKey,
  lengthPenalty,
  normaliseQuery,
  tokeniseDefinition,
  type Ranked,
} from '@/domain/searchRanking';
import { US } from '@/domain/types';
import type { SearchResult } from '@/domain/types';

/** Records in the documented field order (6-field legacy or 8-field v0.2):
 *  simplified | traditional | pinyinNumbered | pinyinMarked | pinyinPlain | definition | definitionVi | hanViet */
const FIXTURE_ROWS: string[][] = [
  ['中', '中', 'zhong1', 'zhōng', 'zhong', 'middle; centre; a halfway point', 'ở giữa; trung tâm', 'trung'],
  ['中国', '中國', 'zhong1 guo2', 'zhōngguó', 'zhongguo', 'China', 'Trung Quốc', 'trung quốc'],
  ['中国人', '中國人', 'zhong1 guo2 ren2', 'zhōngguórén', 'zhongguoren', 'a Chinese person', 'người Trung Quốc', 'trung quốc nhân'],
  ['中间', '中間', 'zhong1 jian1', 'zhōngjiān', 'zhongjian', 'middle; between; interior', 'ở giữa; trung gian', 'trung gian'],
  ['国', '國', 'guo2', 'guó', 'guo', 'country; nation; a state', 'nước; quốc gia', 'quốc'],
  ['水果', '水果', 'shui3 guo3', 'shuǐguǒ', 'shuiguo', 'fruit', 'hoa quả; trái cây', 'thủy quả'],
  ['图书馆', '圖書館', 'tu2 shu1 guan3', 'túshūguǎn', 'tushuguan', 'library; book depository', 'thư viện', 'đồ thư quán'],
  ['图', '圖', 'tu2', 'tú', 'tu', 'picture; map; a plan', 'bức tranh; bản đồ', 'đồ'],
  ['书', '書', 'shu1', 'shū', 'shu', 'book; a written work', 'sách', 'thư'],
  ['爱', '愛', 'ai4', 'ài', 'ai', 'to love; affection; a like of', 'yêu; thích', 'ái'],
  ['律师', '律師', 'lv4 shi1', 'lǜshī', 'lvshi', 'lawyer; attorney', 'luật sư', 'luật sư'],
  ['绿', '綠', 'lv4', 'lǜ', 'lv', 'green; a colour', 'màu xanh lá', 'lục'],
  ['行', '行', 'xing2', 'xíng', 'xing', 'to walk; a row; OK', 'đi; được', 'hành'],
  ['行', '行', 'hang2', 'háng', 'hang', 'row; line; a branch', 'hàng; ngành', 'hàng'],
  ['诗', '詩', 'shi1', 'shī', 'shi', 'poem; poetry', 'thơ; bài thơ', 'thi'],
  ['瓷器', '瓷器', 'ci4 qi2', 'cìqí', 'ciqi', 'china (porcelain)', 'đồ sứ', 'từ khí'],
  ['零', '零', 'ling2', 'líng', 'ling', 'zero; nought; a fractional amount', 'số không; lẻ', 'linh'],
  ['忙', '忙', 'mang2', 'máng', 'mang', 'busy; hurriedly', 'bận; bận rộn', 'mang'],
  ['汉语', '漢語', 'han4 yu3', 'Hànyǔ', 'hanyu', 'Chinese language', 'tiếng Hán; tiếng Trung', 'hán ngữ'],
];

function line(fields: string[]): string {
  return fields.join(US);
}

function fixtureIndex(): DictionaryIndex {
  const index = new DictionaryIndex();
  index.addShard(FIXTURE_ROWS.map(line));
  index.build();
  return index;
}

function byHanzi(results: SearchResult[], hanzi: string): SearchResult | undefined {
  return results.find((result) => result.entry.simplified === hanzi);
}

/** Independent reference implementation of Levenshtein, used to validate the bailing-out one. */
function referenceDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const grid: number[][] = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));
  for (let i = 0; i < rows; i++) grid[i][0] = i;
  for (let j = 0; j < cols; j++) grid[0][j] = j;
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      grid[i][j] = Math.min(grid[i - 1][j] + 1, grid[i][j - 1] + 1, grid[i - 1][j - 1] + cost);
    }
  }
  return grid[a.length][b.length];
}

function lcg(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

describe('index construction', () => {
  it('builds a ready index of every valid record', () => {
    const index = fixtureIndex();
    expect(index.isReady()).toBe(true);
    expect(index.size).toBe(FIXTURE_ROWS.length);
    expect(index.stats().entries).toBe(FIXTURE_ROWS.length);
    expect(index.stats().shards).toBe(1);
  });

  it('derives its own toneless pinyin key from the pack fields', () => {
    const index = fixtureIndex();
    const zhongguo = byHanzi(index.search({ text: 'zhongguo' }), '中国');
    expect(zhongguo?.entry.pinyinPlain).toBe('zhongguo');
    expect(zhongguo?.entry.id).toBe(`中国${US}zhong1 guo2`);
    expect(zhongguo?.entry.length).toBe(2);
  });

  it('ignores malformed, empty or field-short lines', () => {
    const index = new DictionaryIndex();
    index.addShard([
      '',
      line(['缺', '缺', 'que1', 'quē', 'que']), // only five fields
      line(['', '', 'yi1', 'yī', 'yi', 'one']), // empty headword
      line(['一', '一', 'yi1', 'yī', 'yi', '']), // empty definition
      line(['一', '一', 'yi1', 'yī', 'yi', 'one; a single']),
    ]);
    index.build();
    expect(index.size).toBe(1);
  });

  it('resets back to an unbuilt, empty index', () => {
    const index = fixtureIndex();
    index.reset();
    expect(index.size).toBe(0);
    expect(index.isReady()).toBe(false);
    expect(index.search({ text: '中国' })).toEqual([]);
  });

  it('keeps every reading of one headword addressable', () => {
    const index = fixtureIndex();
    const rows = index.exactByHeadword('行');
    expect(rows.map((row) => row.pinyinNumbered).sort()).toEqual(['hang2', 'xing2']);
    const first = rows[0];
    expect(index.byEntryId(first.id)?.pinyinNumbered).toBe(first.pinyinNumbered);
    expect(index.byEntryId('nope')).toBeUndefined();
    expect(index.entryAt(0).simplified).toBe('中');
    expect(index.entriesByIds([0, 5]).map((row) => row.simplified)).toEqual(['中', '水果']);
  });

  it('falls back to the traditional form when no simplified headword matches', () => {
    const index = fixtureIndex();
    expect(index.exactByHeadword('國').map((row) => row.simplified)).toEqual(['国']);
    expect(index.exactByHeadword('没有这个词')).toEqual([]);
  });

  it('returns only records whose headword is exactly the requested one', () => {
    // The docstring promises "every record sharing a headword". The implementation scans the
    // prefix range and never compares the key back to the request (src/domain/searchIndex.ts:167),
    // so a partial string that merely opens like a longer word comes back as if it matched.
    const index = fixtureIndex();
    expect(index.exactByHeadword('中國').map((row) => row.simplified)).toEqual(['中国']);
    expect(index.exactByHeadword('图书')).toEqual([]);
    expect(index.exactByHeadword('中').map((row) => row.simplified)).toEqual(['中']);
  });
});

describe('ranking rubric', () => {
  it('ranks an exact Hanzi hit above its own prefixes', () => {
    const index = fixtureIndex();
    const results = index.search({ text: '中国' });
    expect(results[0].entry.simplified).toBe('中国');
    expect(results[0].match).toBe('exact');
    expect(results[0].via).toBe('simplified');
    const prefix = byHanzi(results, '中国人');
    expect(prefix?.match).toBe('prefix');
    expect(results[0].score).toBeGreaterThan(prefix?.score ?? 0);
    expect(results.findIndex((row) => row.entry.simplified === '中国人')).toBeLessThan(
      results.length,
    );
  });

  it('ranks exact above prefix above definition inside one result set', () => {
    const index = fixtureIndex();
    const exact = index.search({ text: '中' })[0];
    expect(exact.match).toBe('exact');

    // `a` is both a pinyin prefix (爱 -> ai) and a definition token, so one query shows both tiers.
    const mixed = index.search({ text: 'a' });
    const pinyin = mixed.filter((row) => row.via === 'pinyin');
    const definitions = mixed.filter((row) => row.via === 'definition');
    expect(pinyin.length).toBeGreaterThan(0);
    expect(definitions.length).toBeGreaterThan(0);
    const bestPinyin = Math.max(...pinyin.map((row) => row.score));
    const bestDefinition = Math.max(...definitions.map((row) => row.score));
    expect(bestPinyin).toBeGreaterThan(bestDefinition);
    expect(mixed[0].via).toBe('pinyin');
  });

  it('keeps the documented score bands strictly ordered', () => {
    const bands = [
      SCORE.exactHans,
      SCORE.exactHant,
      SCORE.exactPinyin,
      SCORE.prefixHans,
      SCORE.prefixHant,
      SCORE.prefixPinyin,
      SCORE.prefixInitials,
      SCORE.containsHans,
      SCORE.containsHant,
      SCORE.definitionPhrase,
      SCORE.definitionAll,
      SCORE.definitionAny,
      SCORE.fuzzyPinyin,
    ];
    for (let i = 1; i < bands.length; i++) expect(bands[i]).toBeLessThan(bands[i - 1]);
  });

  it('prefers a shorter headword at equal score', () => {
    expect(lengthPenalty(1)).toBe(0);
    expect(lengthPenalty(2)).toBe(6);
    expect(lengthPenalty(11)).toBe(60); // capped
    expect(lengthPenalty(200)).toBe(60);
  });

  it('rewards a multi-token definition phrase over scattered tokens', () => {
    const index = fixtureIndex();
    const phrase = byHanzi(index.search({ text: 'book depository' }), '图书馆');
    expect(phrase?.score).toBe(SCORE.definitionPhrase - lengthPenalty(3));
    const scattered = index.search({ text: 'book country' });
    expect(scattered.some((row) => row.score === SCORE.definitionAny)).toBe(true);
  });

  it('honours mode overrides and the result limit', () => {
    const index = fixtureIndex();
    expect(index.search({ text: '中国', mode: 'english' })).toEqual([]);
    const hanziOnly = index.search({ text: '中国', mode: 'hans' });
    expect(hanziOnly.every((row) => row.via === 'simplified' || row.via === 'traditional')).toBe(true);
    const traditional = index.search({ text: '國', mode: 'hant' });
    expect(traditional[0].entry.simplified).toBe('国');
    expect(traditional[0].via).toBe('traditional');
    expect(index.search({ text: 'zhong', limit: 1 })).toHaveLength(1);
    expect(index.search({ text: 'zhong', limit: 0 })).toHaveLength(1); // clamped to >= 1
    expect(index.search({ text: 'zhong', limit: 5000 })).toHaveLength(
      Math.min(5000, index.search({ text: 'zhong' }).length),
    );
  });

  it('returns nothing for an empty or symbol-only query and before build()', () => {
    const index = fixtureIndex();
    expect(index.search({ text: '' })).toEqual([]);
    expect(index.search({ text: '   ' })).toEqual([]);
    expect(index.search({ text: US })).toEqual([]);
    const unbuilt = new DictionaryIndex();
    unbuilt.addShard(FIXTURE_ROWS.map(line));
    expect(unbuilt.search({ text: '中国' })).toEqual([]);
  });

  it('drops zero-width and control characters before matching', () => {
    const index = fixtureIndex();
    expect(index.search({ text: `${US}中\u200b国\ufeff` })[0].entry.simplified).toBe('中国');
  });
});

describe('compareResults is a deterministic total order', () => {
  const CANDIDATES: Ranked[] = [
    { score: 900, entry: { length: 2, id: `中国${US}zhong1 guo2` } },
    { score: 900, entry: { length: 1, id: `中${US}zhong1` } },
    { score: 900, entry: { length: 2, id: `中间${US}zhong1 jian1` } },
    { score: 430, entry: { length: 3, id: `图书馆${US}tu2 shu1 guan3` } },
    { score: 430, entry: { length: 2, id: `律师${US}lv4 shi1` } },
    { score: 300, entry: { length: 1, id: `零${US}ling2` } },
    { score: 300, entry: { length: 1, id: `书${US}shu1` } },
    { score: 300, entry: { length: 1, id: `图${US}tu2` } },
  ];

  function sorted(input: Ranked[]): Ranked[] {
    return [...input].sort(compareResults);
  }

  it('sorts the same multiset to the same sequence twice', () => {
    expect(sorted(CANDIDATES)).toEqual(sorted(CANDIDATES));
    expect(sorted(CANDIDATES).map((row) => row.entry.id)).toEqual([
      `中${US}zhong1`,
      `中国${US}zhong1 guo2`,
      `中间${US}zhong1 jian1`,
      `律师${US}lv4 shi1`,
      `图书馆${US}tu2 shu1 guan3`,
      `书${US}shu1`,
      `图${US}tu2`,
      `零${US}ling2`,
    ]);
  });

  it('is invariant under every tested permutation of its input', () => {
    const expected = sorted(CANDIDATES);
    const random = lcg(2026);
    for (let round = 0; round < 200; round++) {
      const shuffled = [...CANDIDATES];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      expect(sorted(shuffled)).toEqual(expected);
    }
  });

  it('is antisymmetric and total on every pair', () => {
    for (const a of CANDIDATES) {
      expect(compareResults(a, a)).toBe(0);
      for (const b of CANDIDATES) {
        expect(Math.sign(compareResults(a, b)) + Math.sign(compareResults(b, a))).toBe(0);
      }
    }
  });

  it('is transitive over the full cross product', () => {
    for (const a of CANDIDATES) {
      for (const b of CANDIDATES) {
        for (const c of CANDIDATES) {
          if (compareResults(a, b) < 0 && compareResults(b, c) < 0) {
            expect(compareResults(a, c)).toBeLessThan(0);
          }
          if (compareResults(a, b) === 0 && compareResults(b, c) === 0) {
            expect(compareResults(a, c)).toBe(0);
          }
        }
      }
    }
  });

  it('orders a real search result list by descending score and tie rules', () => {
    const index = fixtureIndex();
    for (const text of ['zhong', '中国', 'shi', 'a', 'tu']) {
      const results = index.search({ text });
      for (let i = 1; i < results.length; i++) {
        expect(compareResults(results[i - 1], results[i])).toBeLessThanOrEqual(0);
      }
    }
  });
});

describe('editDistance bounds', () => {
  it('gives the exact answer inside the bail-out limit', () => {
    expect(editDistance('zhongguo', 'zhongguo')).toBe(0);
    expect(editDistance('zhongguo', 'zhongguoz')).toBe(1);
    expect(editDistance('kitten', 'sitting', 3)).toBe(3);
    expect(editDistance('', 'abc', 3)).toBe(3);
    expect(editDistance('abc', '', 3)).toBe(3);
  });

  it('reports max + 1 when the distance is out of reach', () => {
    expect(editDistance('kitten', 'sitting', 2)).toBe(3);
    expect(editDistance('a', 'abcdefghij', 2)).toBe(3);
    expect(editDistance(' completely different strings', 'xyz', 1)).toBe(2);
  });

  it('never under-reports a distance that fits inside the limit', () => {
    // The bail-out is an optimisation, not a promise: the contract the fuzzy path relies on is
    // "a result <= max means the true distance is exactly that", and "a true distance <= max is
    // always found". src/domain/searchRanking.ts:42 can also return the real (larger) distance
    // instead of `max + 1`, which is asserted here rather than papered over.
    const random = lcg(31337);
    const alphabet = 'abcdefgh';
    let checked = 0;
    let bailouts = 0;
    for (let round = 0; round < 3000; round++) {
      const make = () => {
        const length = Math.floor(random() * 7);
        let text = '';
        for (let i = 0; i < length; i++) text += alphabet[Math.floor(random() * alphabet.length)];
        return text;
      };
      const a = make();
      const b = make();
      const truth = referenceDistance(a, b);
      for (const max of [0, 1, 2, 3, 8]) {
        const got = editDistance(a, b, max);
        expect(got <= max).toBe(truth <= max);
        if (truth <= max) expect(got).toBe(truth);
        else expect(got >= max + 1).toBe(true);
        if (got === max + 1 && truth > max + 1) bailouts++;
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(1000);
    expect(bailouts).toBeGreaterThan(0); // the early exit really is exercised by these inputs
  });

  it('is symmetric and bounded by the string lengths', () => {
    const random = lcg(7);
    const words = ['shuiguo', 'tushuguan', 'zhongguo', 'lvshi', 'ai', 'ling', 'shuji'];
    for (const a of words) {
      for (const b of words) {
        const distance = editDistance(a, b, 9);
        expect(distance).toBe(editDistance(b, a, 9));
        expect(Math.abs(a.length - b.length)).toBeLessThanOrEqual(distance);
        expect(distance).toBeLessThanOrEqual(Math.max(a.length, b.length));
        expect(a === b ? 0 : 1).toBeLessThanOrEqual(distance);
      }
    }
    for (let round = 0; round < 200; round++) {
      const a = words[Math.floor(random() * words.length)];
      const b = words[Math.floor(random() * words.length)];
      const c = words[Math.floor(random() * words.length)];
      expect(editDistance(a, c, 9)).toBeLessThanOrEqual(editDistance(a, b, 9) + editDistance(b, c, 9));
    }
  });
});

describe('normaliseQuery and detectMode', () => {
  it('applies NFKC so fullwidth Latin and digits become their ASCII forms', () => {
    expect(normaliseQuery('ｚｈｏｎｇ ｇｕó')).toBe('zhong guó');
    expect(normaliseQuery('１２３')).toBe('123');
    expect(normaliseQuery('ㄅ')).toBe('ㄅ');
  });

  it('collapses whitespace, trims and strips separators and zero-widths', () => {
    expect(normaliseQuery('  zhong\u0000\u001f  \u200bguo\uFEFF  ')).toBe('zhong guo');
    expect(normaliseQuery('zhong\t\nguo')).toBe('zhong guo');
    expect(normaliseQuery('\u2060\u007f\u000b\u000c')).toBe('');
    expect(normaliseQuery('   ')).toBe('');
  });

  it('keeps ideographic space as a word boundary after NFKC', () => {
    expect(normaliseQuery('zhong\u3000guo')).toBe('zhong guo');
  });

  it('detects a Han query and defaults everything else to auto', () => {
    expect(detectMode('中国')).toBe('hans');
    expect(detectMode('  中国 ')).toBe('hans');
    expect(detectMode('zhongguo')).toBe('auto');
    expect(detectMode('library')).toBe('auto');
    expect(detectMode('')).toBe('auto');
    expect(detectMode(US)).toBe('auto');
    expect(detectMode('１２３')).toBe('auto');
  });

  it('round-trips the documented record helpers', () => {
    expect(entryId('中国', 'zhong1 guo2')).toBe(`中国${US}zhong1 guo2`);
    const built = buildEntry(entryId('中国', 'zhong1 guo2'), FIXTURE_ROWS[1]);
    expect(built).toEqual({
      id: `中国${US}zhong1 guo2`,
      simplified: '中国',
      traditional: '中國',
      pinyinNumbered: 'zhong1 guo2',
      pinyinMarked: 'zhōngguó',
      pinyinPlain: 'zhongguo',
      definition: 'China',
      definitionVi: 'Trung Quốc',
      definitionsVi: ['Trung Quốc'],
      hanViet: 'trung quốc',
      length: 2,
    });
    expect(buildEntry('x', []).definition).toBe('');
  });

  it('tokenises definitions on latin alphanumerics and Vietnamese diacritics', () => {
    expect(tokeniseDefinition('to love; affection — a like of')).toEqual([
      'to',
      'love',
      'affection',
      'a',
      'like',
      'of',
    ]);
    expect(tokeniseDefinition('中文 only')).toEqual(['only']);
    expect(tokeniseDefinition('thư viện; đồ thư quán')).toEqual([
      'thư',
      'thu',
      'viện',
      'vien',
      'đồ',
      'do',
      'thư',
      'thu',
      'quán',
      'quan',
    ]);
    expect(foldVietnamese('Tiếng Đàn Hán Ngữ')).toBe('tieng dan han ngu');
    expect(tokeniseDefinition('')).toEqual([]);
  });

  it('builds the initials key used by abbreviation search', () => {
    expect(initialsKey('zhong1 guo2')).toBe('zg');
    expect(initialsKey('tu2 shu1 guan3')).toBe('tsg');
    expect(initialsKey('lv4 shi1')).toBe('ls');
    expect(initialsKey('')).toBe('');
  });
});

describe('pinyin queries', () => {
  const index = fixtureIndex();

  it('matches tone-number input', () => {
    expect(index.search({ text: 'zhong3 guo2' })[0].entry.simplified).toBe('中国');
    expect(index.search({ text: 'zhong1 guo2' })[0].entry.simplified).toBe('中国');
  });

  it('matches tone-marked input', () => {
    expect(index.search({ text: 'zhōng guó' })[0].entry.simplified).toBe('中国');
    expect(index.search({ text: 'lǜ shī' })[0].entry.simplified).toBe('律师');
  });

  it('matches toneless input', () => {
    expect(index.search({ text: 'zhongguo' })[0].entry.simplified).toBe('中国');
    expect(index.search({ text: 'lvshi' })[0].entry.simplified).toBe('律师');
    expect(index.search({ text: 'LVSHI' })[0].entry.simplified).toBe('律师');
  });

  it('matches the v spelling of the umlaut and its u alternative', () => {
    expect(index.search({ text: 'lv4 shi1' })[0].entry.simplified).toBe('律师');
    expect(index.search({ text: 'lu:4 shi1' })[0].entry.simplified).toBe('律师');
    expect(index.search({ text: 'lü shi' })[0].entry.simplified).toBe('律师');
    expect(index.search({ text: 'lv' })[0].entry.simplified).toBe('绿');
  });

  it('ignores wrong tone digits because keys are toneless', () => {
    expect(index.search({ text: 'zhong4 guo3' })[0].entry.simplified).toBe('中国');
  });

  it('prefix-matches a partial pinyin run', () => {
    const results = index.search({ text: 'zhong' });
    const pingyinHits = results.filter((row) => row.via === 'pinyin');
    expect(pingyinHits.map((row) => row.entry.simplified)).toContain('中国');
    expect(pingyinHits.map((row) => row.entry.simplified)).toContain('中间');
    expect(pingyinHits.every((row) => row.entry.pinyinPlain.startsWith('zhong'))).toBe(true);
  });

  it('tolerates one typo in a longer query', () => {
    const results = index.search({ text: 'zhonggao' });
    expect(byHanzi(results, '中国')?.match).toBe('fuzzy');
  });

  it('searches initials abbreviations', () => {
    const zg = index.search({ text: 'zg' });
    expect(zg.length).toBeGreaterThan(0);
    expect(zg.every((row) => row.via === 'pinyin')).toBe(true);
    expect(byHanzi(zg, '中国')).toBeDefined();
    expect(byHanzi(zg, '中国人')).toBeDefined();
    const exactInitials = byHanzi(zg, '中国');
    const longerInitials = byHanzi(zg, '中国人');
    expect(exactInitials?.score).toBeGreaterThan(longerInitials?.score ?? 0);
    expect(index.search({ text: 'tsg' })[0].entry.simplified).toBe('图书馆');
  });

  it('does not run the pinyin path for a Han-only query', () => {
    expect(index.search({ text: '中国' }).every((row) => row.via !== 'pinyin')).toBe(true);
  });
});

describe('lookupSpans', () => {
  it('prefers the longest dictionary span at each position', () => {
    const index = fixtureIndex();
    const spans = index.lookupSpans('我在图书馆看书');
    expect(spans.map((span) => span.text)).toEqual(['图书馆', '书']);
    expect(spans[0]).toMatchObject({ start: 2, end: 5, text: '图书馆' });
    expect(spans[0].entries[0].simplified).toBe('图书馆');
  });

  it('never overlaps and always advances', () => {
    const index = fixtureIndex();
    const spans = index.lookupSpans('中国图书馆');
    expect(spans.map((span) => span.text)).toEqual(['中国', '图书馆']);
    for (let i = 1; i < spans.length; i++) expect(spans[i].start).toBeGreaterThanOrEqual(spans[i - 1].end);
    for (const span of spans) expect(span.end).toBeGreaterThan(span.start);
  });

  it('respects maxLen by never emitting a span longer than the limit', () => {
    const index = fixtureIndex();
    const short = index.lookupSpans('我在图书馆看书', 2);
    expect(short.every((span) => span.end - span.start <= 2)).toBe(true);
    expect(short.some((span) => span.text === '图书馆')).toBe(false);
    // With maxLen 2 the reader emits a `图书` span pointing at 图书馆's records; that is the
    // exactByHeadword prefix defect above, not a span-length defect, so it is not asserted here.
    const single = index.lookupSpans('图书馆', 1);
    expect(single.map((span) => span.text)).toEqual(['图', '书']);
    expect(index.lookupSpans('我在图书馆看书', 0)).toEqual([]);
  });

  it('skips latin and punctuation and returns nothing for an unbuilt index', () => {
    const index = fixtureIndex();
    expect(index.lookupSpans('hello 中国 world').map((span) => span.text)).toEqual(['中国']);
    expect(index.lookupSpans('')).toEqual([]);
    const unbuilt = new DictionaryIndex();
    unbuilt.addShard(FIXTURE_ROWS.map(line));
    expect(unbuilt.lookupSpans('中国')).toEqual([]);
  });

  it('reports every reading of a matched span', () => {
    const index = fixtureIndex();
    const span = index.lookupSpans('行');
    expect(span).toHaveLength(1);
    expect(span[0].entries).toHaveLength(2);
  });
});

describe('sampleCharacters', () => {
  it('returns at most the requested count of distinct Han characters', () => {
    const index = fixtureIndex();
    const chars = index.sampleCharacters(4);
    expect(chars).toHaveLength(4);
    expect(new Set(chars).size).toBe(4);
    expect(index.sampleCharacters(0)).toEqual([]);
    expect(index.sampleCharacters(100).length).toBeLessThanOrEqual(100);
    const filtered = index.sampleCharacters(100, (char) => char === '中');
    expect(filtered).toEqual(['中']);
  });
});

describe('Vietnamese definitions and Hán-Việt search (D-07)', () => {
  const index = fixtureIndex();

  it('searching "thư viện" or "thu vien" returns 图书馆 (túshūguǎn)', () => {
    const accented = index.search({ text: 'thư viện' });
    expect(accented.length).toBeGreaterThan(0);
    expect(accented[0].entry.simplified).toBe('图书馆');
    expect(accented[0].entry.pinyinMarked).toBe('túshūguǎn');
    expect(accented[0].entry.definitionVi).toBe('thư viện');

    const folded = index.search({ text: 'thu vien' });
    expect(folded.length).toBeGreaterThan(0);
    expect(folded[0].entry.simplified).toBe('图书馆');
  });

  it('searching "bận" returns 忙 (máng)', () => {
    const results = index.search({ text: 'bận' });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].entry.simplified).toBe('忙');
    expect(results[0].entry.pinyinMarked).toBe('máng');
  });

  it('searching Hán-Việt "hán ngữ" returns 汉语 (Hànyǔ)', () => {
    const results = index.search({ text: 'hán ngữ' });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].entry.simplified).toBe('汉语');
    expect(results[0].entry.pinyinMarked).toBe('Hànyǔ');
    expect(results[0].entry.hanViet).toBe('hán ngữ');
  });

  it('still ranks exact Hanzi and Pinyin matches above definition matches', () => {
    const hanziHit = index.search({ text: '汉语' })[0];
    const pinyinHit = index.search({ text: 'hanyu' })[0];
    const viHit = index.search({ text: 'tiếng Hán' })[0];
    expect(hanziHit.score).toBeGreaterThan(pinyinHit.score);
    expect(pinyinHit.score).toBeGreaterThan(viHit.score);
  });
});
