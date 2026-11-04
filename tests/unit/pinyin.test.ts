/**
 * Pinyin spine tests: numbered <-> marked conversion, the `ü`/`u:`/`v` spellings, toneless keys,
 * query variants, syllable plausibility and the CJK recognition helpers.
 *
 * Written as property-style sweeps over the syllable inventory wherever the rule is generic, so a
 * regression in `markVowel` position logic cannot hide behind a handful of hand-picked cases.
 */
import { describe, expect, it } from 'vitest';
import {
  canonicaliseVowel,
  hasCjk,
  isHanCharacter,
  marksToNumbered,
  numberedToMarks,
  pinyinKey,
  pinyinPlausibility,
  queryPinyinKeys,
  stripToneMarks,
  syllables,
  toneFromMarks,
} from '@/domain/pinyin';

/** A broad slice of the ~410-syllable inventory, deliberately covering every final shape the
 *  tone-mark placement rules care about (a/e/ou/iu/ui/ê/ü and the nasal codas). */
const SYLLABLES = [
  'a', 'ai', 'an', 'ang', 'ao', 'ba', 'bai', 'ban', 'bang', 'bao', 'bei', 'ben', 'beng', 'bi',
  'bian', 'biao', 'bie', 'bo', 'bu', 'cai', 'can', 'cang', 'cao', 'ce', 'cen', 'ceng', 'cha',
  'chai', 'chan', 'chang', 'chao', 'che', 'chen', 'cheng', 'chi', 'chong', 'chou', 'chu', 'chua',
  'chuai', 'chuan', 'chuang', 'chui', 'chun', 'chuo', 'ci', 'cong', 'cu', 'cuan', 'cui', 'cun',
  'cuo', 'da', 'dai', 'dan', 'dang', 'dao', 'de', 'dei', 'deng', 'di', 'dia', 'dian', 'diao',
  'die', 'ding', 'diu', 'dong', 'dou', 'du', 'duan', 'dui', 'dun', 'duo', 'e', 'ei', 'en', 'er',
  'fa', 'fan', 'fang', 'fei', 'fen', 'feng', 'fo', 'fou', 'fu', 'ga', 'gai', 'gan', 'gang', 'gao',
  'ge', 'gei', 'gen', 'geng', 'gong', 'gou', 'gu', 'gua', 'guai', 'guan', 'guang', 'gui', 'gun',
  'guo', 'ha', 'hai', 'han', 'hang', 'hao', 'he', 'hei', 'hen', 'hong', 'hou', 'hu', 'hua',
  'huai', 'huan', 'huang', 'hui', 'hun', 'huo', 'ji', 'jia', 'jian', 'jiang', 'jiao', 'jie',
  'jin', 'jing', 'jiong', 'jiu', 'ju', 'juan', 'jue', 'jun', 'ka', 'kai', 'kan', 'kang', 'kao',
  'ke', 'ken', 'keng', 'kong', 'kou', 'ku', 'kua', 'kuai', 'kuan', 'kuang', 'kui', 'kun', 'kuo',
  'la', 'lai', 'lan', 'lang', 'lao', 'le', 'lei', 'leng', 'li', 'lia', 'lian', 'liang', 'liao',
  'lie', 'lin', 'ling', 'liu', 'long', 'lou', 'lu', 'luan', 'lun', 'luo', 'lv', 'lve', 'ma',
  'mai', 'man', 'mang', 'mao', 'me', 'mei', 'men', 'meng', 'mi', 'mian', 'miao', 'mie', 'min',
  'ming', 'miu', 'mo', 'mou', 'mu', 'na', 'nai', 'nan', 'nang', 'nao', 'ne', 'nen', 'neng', 'ni',
  'nian', 'niang', 'niao', 'nie', 'nin', 'ning', 'niu', 'nong', 'nu', 'nuan', 'nun', 'nuo', 'nv',
  'nve', 'o', 'ou', 'pa', 'pai', 'pan', 'pang', 'pao', 'pei', 'pen', 'peng', 'pi', 'pian', 'piao',
  'pie', 'pin', 'ping', 'po', 'pou', 'pu', 'qi', 'qia', 'qian', 'qiang', 'qiao', 'qie', 'qin',
  'qing', 'qiong', 'qiu', 'qu', 'quan', 'que', 'qun', 'ran', 'rang', 'rao', 're', 'ren', 'reng',
  'ri', 'rong', 'rou', 'ru', 'ruan', 'rui', 'run', 'ruo', 'sa', 'sai', 'san', 'sang', 'sao', 'se',
  'sen', 'seng', 'sha', 'shai', 'shan', 'shang', 'shao', 'she', 'shen', 'sheng', 'shi', 'shou',
  'shu', 'shua', 'shuai', 'shuan', 'shuang', 'shui', 'shun', 'shuo', 'si', 'song', 'sou', 'su',
  'suan', 'sui', 'sun', 'suo', 'ta', 'tai', 'tan', 'tang', 'tao', 'te', 'teng', 'ti', 'tian',
  'tiao', 'tie', 'ting', 'tong', 'tou', 'tu', 'tuan', 'tui', 'tun', 'tuo', 'wa', 'wai', 'wan',
  'wang', 'wei', 'wen', 'weng', 'wo', 'wu', 'xi', 'xia', 'xian', 'xiang', 'xiao', 'xie', 'xin',
  'xing', 'xiong', 'xiu', 'xu', 'xuan', 'xue', 'xun', 'ya', 'yan', 'yang', 'yao', 'ye', 'yi',
  'yin', 'ying', 'yo', 'yong', 'you', 'yu', 'yuan', 'yue', 'yun', 'za', 'zai', 'zan', 'zang',
  'ze', 'zei', 'zen', 'zeng', 'zha', 'zhai', 'zhan', 'zhang', 'zhao', 'zhe', 'zhen', 'zheng',
  'zhi', 'zhong', 'zhou', 'zhu', 'zhua', 'zhuai', 'zhuan', 'zhuang', 'zhui', 'zhun', 'zhuo', 'zi',
  'zong', 'zou', 'zu', 'zuan', 'zui', 'zun', 'zuo',
];

const TONES = [1, 2, 3, 4, 5] as const;

/** Deterministic pseudo-random source so the sweep order never changes between runs. */
function lcg(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

describe('canonicaliseVowel', () => {
  it('treats u:, v and ü as the same vowel', () => {
    expect(canonicaliseVowel('lv4')).toBe('lü4');
    expect(canonicaliseVowel('lu:4')).toBe('lü4');
    expect(canonicaliseVowel('lü4')).toBe('lü4');
    // NOTE: an uppercase V folds to lowercase ü; the function is only ever fed lowercased text by
    // pinyinKey/numberedToMarks, so this case loss has no effect on the index.
    expect(canonicaliseVowel('lv shi1')).toBe('lü shi1');
  });

  it('leaves plain vowels untouched', () => {
    expect(canonicaliseVowel('zhong1 guo2')).toBe('zhong1 guo2');
  });
});

describe('numberedToMarks / marksToNumbered round trips', () => {
  it('round-trips every syllable x tone combination back to its canonical numbered form', () => {
    const failures: string[] = [];
    for (const syllable of SYLLABLES) {
      for (const tone of TONES) {
        const numbered = `${syllable}${tone}`;
        const canonical = canonicaliseVowel(numbered);
        const marked = numberedToMarks(numbered);
        const back = marksToNumbered(marked);
        if (back !== canonical) failures.push(`${numbered} -> ${marked} -> ${back}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('reads the tone back out of the marks it wrote', () => {
    const wrong: string[] = [];
    for (const syllable of SYLLABLES) {
      for (const tone of TONES) {
        const marked = numberedToMarks(`${syllable}${tone}`);
        const detected = toneFromMarks(marked);
        const expected = tone === 5 ? 0 : tone;
        if (detected !== expected) wrong.push(`${syllable}${tone} -> ${marked} -> tone ${detected}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('writes no diacritic for the neutral tone and at least one for tones 1-4', () => {
    for (const syllable of SYLLABLES) {
      const plain = canonicaliseVowel(syllable);
      expect(numberedToMarks(`${syllable}5`)).toBe(plain);
      for (const tone of [1, 2, 3, 4] as const) {
        expect(numberedToMarks(`${syllable}${tone}`)).not.toBe(plain);
      }
    }
  });

  it('places the mark on the documented vowel for the tricky finals', () => {
    expect(numberedToMarks('liu2')).toBe('liú'); // iu -> mark the u
    expect(numberedToMarks('gui4')).toBe('guì'); // ui -> mark the i
    expect(numberedToMarks('lun2')).toBe('lún');
    expect(numberedToMarks('dou1')).toBe('dōu'); // ou -> mark the o
    expect(numberedToMarks('jiu3')).toBe('jiǔ');
    expect(numberedToMarks('xue2')).toBe('xué');
    expect(numberedToMarks('nv3')).toBe('nǚ');
    expect(numberedToMarks('lve4')).toBe('lüè');
    expect(numberedToMarks('zhong4 guo2 ren2')).toBe('zhòng guó rén');
  });

  it('reads the umlaut spellings u: and v as the marked vowel', () => {
    expect(numberedToMarks('lv4')).toBe('lǜ');
    expect(numberedToMarks('lu:4')).toBe('lǜ');
    expect(numberedToMarks('lv4 shi1')).toBe('lǜ shī');
  });

  it('accepts the umlaut spelling of a syllable', () => {
    expect(numberedToMarks('lü4')).toBe('lǜ');
    expect(marksToNumbered('lǜ shī')).toBe('lü4 shi1');
  });

  it('is tolerant of spacing and blank input', () => {
    expect(numberedToMarks('  zhong1   guo2 ')).toBe('zhōng guó');
    expect(numberedToMarks('')).toBe('');
    expect(marksToNumbered('')).toBe('');
  });

  it('round-trips a deterministic sample of multi-syllable words', () => {
    const random = lcg(20261104);
    const failures: string[] = [];
    for (let round = 0; round < 400; round++) {
      const length = 1 + Math.floor(random() * 4);
      const syllableTone: string[] = [];
      for (let i = 0; i < length; i++) {
        const syllable = SYLLABLES[Math.floor(random() * SYLLABLES.length)];
        const tone = TONES[Math.floor(random() * TONES.length)];
        syllableTone.push(`${syllable}${tone}`);
      }
      const numbered = syllableTone.join(' ');
      const back = marksToNumbered(numberedToMarks(numbered));
      if (back !== canonicaliseVowel(numbered)) failures.push(`${numbered} -> ${back}`);
    }
    expect(failures).toEqual([]);
  });

  it('lowercases and re-joins accented input in marksToNumbered', () => {
    expect(marksToNumbered('Zhōng guó')).toBe('zhong1 guo2');
    expect(marksToNumbered('mā ma')).toBe('ma1 ma5');
  });

  it('folds capitalised numbered input to the lowercase marked form', () => {
    // src/domain/pinyin.ts:74 says "capitalisation preserved", but the syllable base is lowercased
    // before marking, so the promise does not hold; every downstream consumer lowercases anyway.
    expect(numberedToMarks('Zhong1 guo2')).toBe('zhōng guó');
    expect(marksToNumbered(numberedToMarks('Zhong1 guo2'))).toBe('zhong1 guo2');
  });
});

describe('stripToneMarks', () => {
  it('removes diacritics but keeps the umlaut', () => {
    expect(stripToneMarks('zhōng guó')).toBe('zhong guo');
    expect(stripToneMarks('lǜ shī')).toBe('lü shi');
    expect(stripToneMarks('nǚ hái zi')).toBe('nü hai zi');
  });

  it('is a no-op on already plain text', () => {
    for (const syllable of SYLLABLES) {
      const plain = canonicaliseVowel(syllable);
      expect(stripToneMarks(plain)).toBe(plain);
    }
  });
});

describe('pinyinKey', () => {
  it('produces a lowercase, toneless, v-for-umlaut key', () => {
    expect(pinyinKey('zhong3 guo2')).toBe('zhongguo');
    expect(pinyinKey('zhǒng guó')).toBe('zhongguo');
    expect(pinyinKey('ZHONG GUO')).toBe('zhongguo');
    expect(pinyinKey('lü4 shi1')).toBe('lvshi');
    expect(pinyinKey('lv4 shi1')).toBe('lvshi');
    expect(pinyinKey('lu:4 shi1')).toBe('lvshi');
  });

  it('never keeps a tone digit for a syllabic token but keeps digits in numeric headwords', () => {
    expect(pinyinKey('110')).toBe('110');
    expect(pinyinKey('11 qu1')).toBe('11qu');
    expect(pinyinKey('2003 ni2')).toBe('2003ni');
    const bad = SYLLABLES.flatMap((syllable) =>
      TONES.map((tone) => pinyinKey(`${syllable}${tone}`)).filter((key) => /[0-9]/.test(key)),
    );
    expect(bad).toEqual([]);
  });

  it('agrees across numbered, marked and v-spelled input for the whole inventory', () => {
    const mismatches: string[] = [];
    for (const syllable of SYLLABLES) {
      for (const tone of [1, 2, 3, 4] as const) {
        const numbered = pinyinKey(`${syllable}${tone}`);
        const marked = pinyinKey(numberedToMarks(`${syllable}${tone}`));
        if (numbered !== marked) mismatches.push(`${syllable}${tone}: ${numbered} vs ${marked}`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('keeps the key free of the umlaut code point', () => {
    const offenders: string[] = [];
    for (const syllable of SYLLABLES) {
      for (const tone of TONES) {
        const key = pinyinKey(`${syllable}${tone}`);
        if (key.includes('ü') || key.includes('u:')) offenders.push(`${syllable}${tone} -> ${key}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('drops punctuation and stray separators from the key', () => {
    expect(pinyinKey('xì-tǒng!')).toBe('xitong');
    expect(pinyinKey('  ')).toBe('');
  });
});

describe('queryPinyinKeys', () => {
  it('returns one canonical key for an unambiguous query', () => {
    expect(queryPinyinKeys('zhongguo')).toEqual(['zhongguo']);
    expect(queryPinyinKeys('  zhong3 guo2 ')).toEqual(['zhongguo']);
    expect(queryPinyinKeys('zhǒng guó')).toEqual(['zhongguo']);
  });

  it('canonicalises the v, u: and umlaut spellings onto the indexed key', () => {
    // The index writes every key with `v` for the umlaut (pinyinKey), so all three spellings must
    // reach the same key. docs/DATA_FORMAT.md additionally promises a plain-`u` alternative for a
    // typed `v`; it is only produced when the query already carries a literal `ü`.
    expect(queryPinyinKeys('lv4 shi1')).toEqual(['lvshi']);
    expect(queryPinyinKeys('lü shi')).toEqual(expect.arrayContaining(['lvshi', 'lushi']));
    expect(queryPinyinKeys('lu:4 shi1')).toEqual(['lvshi']);
  });

  it('keeps tone digits that are glued to the following syllable inside the key', () => {
    // Observed limitation: only a digit that ends a token (or precedes a space) is split off, so
    // `zhong1guo2` cannot match the indexed `zhongguo`. Learners are directed to spaced digits.
    expect(queryPinyinKeys('zhong3 guo2')).toEqual(['zhongguo']);
    expect(queryPinyinKeys('zhong1guo2')).toEqual(['zhong1guo']);
  });

  it('returns nothing for empty or symbol-only input', () => {
    expect(queryPinyinKeys('')).toEqual([]);
    expect(queryPinyinKeys('   ')).toEqual([]);
  });
});

describe('syllables', () => {
  it('splits tokens and reports tone digits and the neutral default', () => {
    expect(syllables('zhong3 guo2')).toEqual([
      { base: 'zhong', tone: 3 },
      { base: 'guo', tone: 2 },
    ]);
    expect(syllables('ma')).toEqual([{ base: 'ma', tone: 5 }]);
    expect(syllables('Zhong1 yang2 Xian4')).toEqual([
      { base: 'zhong', tone: 1 },
      { base: 'yang', tone: 2 },
      { base: 'xian', tone: 4 },
    ]);
    expect(syllables('')).toEqual([]);
  });

  it('derives the tone from marks but leaves the marked base as typed', () => {
    // Documented behaviour of `syllables` is the tone digit; the base keeps whatever spelling the
    // caller used, so a marked query must be stripped by the caller (stripToneMarks).
    expect(syllables('zhǒng guó')).toEqual([
      { base: 'zhǒng', tone: 3 },
      { base: 'guó', tone: 2 },
    ]);
  });

  it('keeps digits of a numeric headword as the base', () => {
    expect(syllables('110')).toEqual([{ base: '110', tone: 5 }]);
  });

  it('recovers the syllable and tone it was round-tripped through', () => {
    const random = lcg(77);
    for (let round = 0; round < 200; round++) {
      const syllable = SYLLABLES[Math.floor(random() * SYLLABLES.length)];
      const tone = TONES[Math.floor(random() * TONES.length)];
      const marked = numberedToMarks(`${syllable}${tone}`);
      const parsed = syllables(marked);
      expect(parsed).toHaveLength(1);
      expect(stripToneMarks(parsed[0].base)).toBe(canonicaliseVowel(syllable));
      expect(parsed[0].tone).toBe(tone);
    }
  });
});

describe('pinyinPlausibility', () => {
  it('scores every syllable in the inventory as fully plausible', () => {
    // KNOWN SPINE BUG: the token is canonicalised with `v` -> `ü` first, but the syllable table
    // stores the `v` spellings, so `lv`, `lve`, `nv`, `nve` can never match
    // (src/domain/pinyin.ts:28-30 vs the table at src/domain/pinyin.ts:160-181).
    const offenders = SYLLABLES.filter((syllable) => pinyinPlausibility(syllable) !== 1);
    expect(offenders).toEqual([]);
  });

  it('scores tone digits and multi-syllable words as fully plausible', () => {
    expect(pinyinPlausibility('zhong1 guo2 ren2')).toBe(1);
    expect(pinyinPlausibility('zhongguoren')).toBe(1);
    expect(pinyinPlausibility('bei4 jing1 shi4')).toBe(1);
    expect(pinyinPlausibility('ni3 hao3')).toBe(1);
  });

  it('returns 0 for empty input and penalises non-syllable tokens', () => {
    expect(pinyinPlausibility('')).toBe(0);
    expect(pinyinPlausibility('   ')).toBe(0);
    expect(pinyinPlausibility('hello world')).toBe(0);
    expect(pinyinPlausibility('zhongguo xyzzy')).toBe(0.5);
  });

  it('never returns a value outside 0..1', () => {
    const random = lcg(404);
    const alphabet = 'abcdefghijklmnopqrstuvwxyz12345 ü';
    for (let round = 0; round < 300; round++) {
      const length = 1 + Math.floor(random() * 12);
      let text = '';
      for (let i = 0; i < length; i++) text += alphabet[Math.floor(random() * alphabet.length)];
      const score = pinyinPlausibility(text);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    }
  });
});

describe('hasCjk and isHanCharacter', () => {
  it('recognises the CJK Unified Ideographs block', () => {
    expect(hasCjk('中')).toBe(true);
    expect(isHanCharacter('中')).toBe(true);
    expect(isHanCharacter('\u9fff')).toBe(true);
    expect(isHanCharacter('\u4e00')).toBe(true);
  });

  it('recognises Extension A (U+3400-U+4DBF) inside the BMP', () => {
    expect(hasCjk('\u3400')).toBe(true);
    expect(isHanCharacter('\u3400')).toBe(true);
    expect(isHanCharacter('\u4dbf')).toBe(true);
    expect(hasCjk('\u33ff')).toBe(false); // just below Extension A
    expect(isHanCharacter('\u4dc0')).toBe(false); // just above Extension A
  });

  it('recognises the compatibility ideographs block', () => {
    expect(isHanCharacter('\uf900')).toBe(true);
    expect(isHanCharacter('\ufaff')).toBe(true);
  });

  it('iterates a surrogate-pair ideograph as one character', () => {
    const extB = String.fromCodePoint(0x20000); // 𠀀, Extension B
    expect([...extB]).toHaveLength(1);
    expect([...extB][0]).toBe(extB);
    expect(extB).toHaveLength(2); // two UTF-16 code units
  });

  it('does not treat a non-Han astral character as Han', () => {
    // KNOWN SPINE BUG: the character class ends its third range at U+FAFF and starts it at U+8C48
    // (豈), so the range silently covers the UTF-16 surrogate block U+D800-U+DFFF and the
    // expressions carry no `u` flag. Any astral-plane character - emoji included - therefore
    // tests as a Han character, and detectMode() sends such a query down the hanzi path only.
    // src/domain/pinyin.ts:213 and src/domain/pinyin.ts:217 (duplicated at searchIndex.ts:198).
    const emoji = String.fromCodePoint(0x1f600); // 😀
    expect(isHanCharacter(emoji)).toBe(false);
    expect(hasCjk(emoji)).toBe(false);
  });

  it('counts kana as CJK-ish for hasCjk but never as a Han character', () => {
    expect(hasCjk('ひ')).toBe(true);
    expect(hasCjk('バ')).toBe(true);
    expect(isHanCharacter('ひ')).toBe(false);
  });

  it('rejects latin, digits and pinyin with marks', () => {
    for (const text of ['zhong1 guo2', 'lǜ shī', '110', '', '   ', 'abc']) {
      expect(hasCjk(text)).toBe(false);
      expect(isHanCharacter(text)).toBe(false);
    }
  });

  it('is true for a string when any of its characters is Han', () => {
    expect(hasCjk('学abc')).toBe(true);
    expect(isHanCharacter('学abc')).toBe(true);
  });
});
