/**
 * Pinyin tone-number <-> tone-mark conversion.
 *
 * Conventions implemented (docs/DATA_FORMAT.md):
 *   numbered  `zhong3 guo2`   tone 1..4, neutral tone = 5 (CC-CEDICT also uses 5)
 *   marked    `zhǒng guó`     precomposed tone marks, `ü` kept as `ü`
 *   plain     `zhongguo`      lowercase, toneless
 *
 * Source spellings accepted for `ü`: `u:` (CC-CEDICT, e.g. `nv3`/`nu:3`/`lu:4`)
 * and the keyboard alias `v` (`nv3`). Both convert to `nǚ` / `lǜ`.
 * After j/q/x/y the ü is written `u` (`ju1` -> `jū`), as in standard pinyin.
 *
 * Run `node scripts/content/lib/pinyin.mjs --selftest` to exercise it.
 */
import { pathToFileURL } from 'node:url';

/** Precomposed tone-marked vowels, indexed [vowel][tone] with tone 5 = unmarked. */
export const TONE_VOWEL_TABLE = {
  a: ['\u0101', '\u00E1', '\u01CE', '\u00E0', 'a'], // ā á ǎ à a
  e: ['\u0113', '\u00E9', '\u011B', '\u00E8', 'e'], // ē é ě è e
  i: ['\u012B', '\u00ED', '\u01D0', '\u00EC', 'i'], // ī í ǐ ì i
  o: ['\u014D', '\u00F3', '\u01D2', '\u00F2', 'o'], // ō ó ǒ ò o
  u: ['\u016B', '\u00FA', '\u01D4', '\u00F9', 'u'], // ū ú ǔ ù u
  '\u00FC': ['\u01D6', '\u01D8', '\u01DA', '\u01DC', '\u00FC'], // ǖ ǘ ǚ ǜ ü
  // ê has no precomposed tone-1 form; U+0304 combining macron is used there.
  '\u00EA': ['\u00EA\u0304', '\u1EBF', '\u1EBB', '\u1EB9', '\u00EA'],
};

/** Combining marks used for syllabic consonants (m, n, ng, hm) and ê tone 1. */
const COMBINING = ['\u0304', '\u0301', '\u030C', '\u0300']; // 1 2 3 4
const COMBINING_TONE = new Map(COMBINING.map((c, i) => [c, i + 1]));

/** Reverse index: tone-marked vowel -> { base, tone }. The bare (neutral)
 *  vowels are deliberately excluded so an unmarked letter never resets the
 *  tone of the syllable it follows. */
const MARKED_TO_BASE = new Map();
for (const [base, marks] of Object.entries(TONE_VOWEL_TABLE)) {
  marks.forEach((m, i) => {
    if (i < 4 && m.length === 1) MARKED_TO_BASE.set(m, { base, tone: i + 1 });
  });
}

const VOWELS = new Set(Object.keys(TONE_VOWEL_TABLE));

/**
 * Every syllable appearing in the pinned CC-CEDICT release (tone digit stripped,
 * lowercased, punctuation tokens dropped). Used by --selftest to prove the
 * converter never crashes and always round-trips on real input.
 */
export const ATTESTED_SYLLABLES = [
  'a', 'aa', 'ai', 'an', 'ang', 'ao', 'b', 'ba', 'bai', 'ban',
  'bang', 'bao', 'bei', 'ben', 'beng', 'bi', 'bia', 'bian', 'biang', 'biao',
  'bie', 'bin', 'bing', 'biu', 'bo', 'bp', 'bu', 'c', 'ca', 'cai',
  'call', 'can', 'cang', 'cao', 'ce', 'cen', 'ceng', 'cha', 'chai', 'chan',
  'chang', 'chao', 'che', 'chen', 'cheng', 'chi', 'chong', 'chou', 'chu', 'chua',
  'chuai', 'chuan', 'chuang', 'chui', 'chun', 'chuo', 'ci', 'cong', 'coser', 'cou',
  'cp', 'cu', 'cuan', 'cue', 'cui', 'cun', 'cuo', 'd', 'da', 'dai',
  'dan', 'dang', 'dao', 'de', 'dei', 'den', 'deng', 'di', 'dia', 'dian',
  'diao', 'die', 'ding', 'diu', 'dong', 'dou', 'du', 'duan', 'dui', 'dun',
  'duo', 'e', 'ei', 'en', 'eng', 'er', 'f', 'fa', 'fan', 'fang',
  'fei', 'fen', 'feng', 'fiao', 'fo', 'fou', 'fu', 'g', 'ga', 'gai',
  'gan', 'gang', 'gao', 'ge', 'gei', 'gen', 'geng', 'ging', 'gong', 'gou',
  'gu', 'gua', 'guai', 'guan', 'guang', 'gui', 'gun', 'guo', 'h', 'ha',
  'hai', 'han', 'hang', 'hao', 'he', 'hei', 'hen', 'heng', 'hm', 'hng',
  'hong', 'hou', 'hu', 'hua', 'huai', 'huan', 'huang', 'hui', 'hun', 'huo',
  'i', 'j', 'ji', 'jia', 'jian', 'jiang', 'jiao', 'jie', 'jin', 'jing',
  'jiong', 'jiu', 'ju', 'juan', 'jue', 'jun', 'k', 'ka', 'kai', 'kan',
  'kang', 'kao', 'ke', 'kei', 'ken', 'keng', 'kong', 'kou', 'ku', 'kua',
  'kuai', 'kuan', 'kuang', 'kui', 'kun', 'kuo', 'ky', 'l', 'la', 'lai',
  'lan', 'lang', 'lao', 'le', 'lei', 'leng', 'li', 'lia', 'lian', 'liang',
  'liao', 'lie', 'lin', 'ling', 'liu', 'lo', 'long', 'lou', 'lu', 'lu:',
  'lu:e', 'luan', 'lun', 'luo', 'm', 'ma', 'mai', 'man', 'mang', 'mao',
  'me', 'mei', 'men', 'meng', 'mi', 'mian', 'miao', 'mie', 'min', 'ming',
  'miu', 'mo', 'mou', 'mu', 'n', 'na', 'nai', 'nan', 'nang', 'nao',
  'ne', 'nei', 'nen', 'neng', 'ng', 'ni', 'nian', 'niang', 'niao', 'nie',
  'nin', 'ning', 'niu', 'nong', 'nou', 'nu', 'nu:', 'nu:e', 'nuan', 'nun',
  'nuo', 'o', 'ok', 'ou', 'p', 'pa', 'pai', 'pan', 'pang', 'pao',
  'pei', 'pen', 'peng', 'pi', 'pian', 'piao', 'pie', 'pin', 'ping', 'po',
  'pou', 'pu', 'pua', 'q', 'qi', 'qia', 'qian', 'qiang', 'qiao', 'qie',
  'qin', 'qing', 'qiong', 'qiu', 'qu', 'quan', 'que', 'qun', 'r', 'ran',
  'rang', 'rao', 're', 'ren', 'reng', 'ri', 'rong', 'rou', 'ru', 'rua',
  'ruan', 'rui', 'run', 'ruo', 's', 'sa', 'sai', 'san', 'sang', 'sao',
  'se', 'sei', 'sen', 'seng', 'sha', 'shai', 'shan', 'shang', 'shao', 'she',
  'shei', 'shen', 'sheng', 'shi', 'shou', 'shu', 'shua', 'shuai', 'shuan', 'shuang',
  'shui', 'shun', 'shuo', 'si', 'song', 'sou', 'su', 'suan', 'sui', 'sun',
  'suo', 't', 'ta', 'tai', 'tan', 'tang', 'tao', 'te', 'tei', 'teng',
  'ti', 'tian', 'tiao', 'tie', 'ting', 'tong', 'tou', 'tu', 'tuan', 'tui',
  'tun', 'tuo', 'u', 'v', 'w', 'wa', 'wai', 'wan', 'wang', 'wei',
  'wen', 'weng', 'wo', 'wu', 'x', 'xi', 'xia', 'xian', 'xiang', 'xiao',
  'xie', 'xin', 'xing', 'xiong', 'xiu', 'xu', 'xuan', 'xue', 'xun', 'xx',
  'y', 'ya', 'yan', 'yang', 'yao', 'ye', 'yi', 'yin', 'ying', 'yo',
  'yong', 'you', 'yu', 'yuan', 'yue', 'yun', 'z', 'za', 'zai', 'zan',
  'zang', 'zao', 'ze', 'zei', 'zen', 'zeng', 'zha', 'zhai', 'zhan', 'zhang',
  'zhao', 'zhe', 'zhei', 'zhen', 'zheng', 'zhi', 'zhong', 'zhou', 'zhu', 'zhua',
  'zhuai', 'zhuan', 'zhuang', 'zhui', 'zhun', 'zhuo', 'zi', 'zong', 'zou', 'zu',
  'zuan', 'zui', 'zun', 'zuo',
];

/** Hand-checked spot table: [numbered, marked, plain]. */
export const SPOT_TABLE = [
  ['zhong3 guo2', 'zh\u01D2ng gu\u00F3', 'zhongguo'], // zhǒng guó
  ['zhong1 guo2', 'zh\u014Dng gu\u00F3', 'zhongguo'], // zhōng guó
  ['nv3', 'n\u01DA', 'n\u00FC'], // nǚ / nü
  ['nu:3', 'n\u01DA', 'n\u00FC'],
  ['nv4', 'n\u01DC', 'n\u00FC'], // nǜ
  ['lv4', 'l\u01DC', 'l\u00FC'], // lǜ
  ['lu:4', 'l\u01DC', 'l\u00FC'],
  ['lv:3', 'l\u01DA', 'l\u00FC'], // tolerant of "lv:"
  ['lu:e4', 'l\u00FC\u00E8', 'l\u00FCe'], // lüè
  ['nu:e4', 'n\u00FC\u00E8', 'n\u00FCe'], // nüè
  ['nv4e4', 'n\u01DC \u00E8', 'n\u00FCe'], // merged input, two syllables split apart
  ['ju1', 'j\u016B', 'ju'], // jū (ü written as u after j)
  ['qu2', 'q\u00FA', 'qu'],
  ['xu3', 'x\u01D4', 'xu'],
  ['yu4', 'y\u00F9', 'yu'],
  ['juan1', 'ju\u0101n', 'juan'], // juān -> mark on a
  ['jue2', 'ju\u00E9', 'jue'], // jué -> mark on e
  ['yue4', 'yu\u00E8', 'yue'], // yuè
  ['xiao3', 'xi\u01CEo', 'xiao'], // xiǎo
  ['shui3', 'shu\u01D0', 'shui'], // shuǐ -> ui marks i
  ['gui4', 'gu\u00EC', 'gui'], // guì
  ['liu3', 'li\u01D4', 'liu'], // liǔ -> iu marks u
  ['jiu1', 'ji\u016B', 'jiu'], // jiū
  ['duo1', 'du\u014D', 'duo'], // duō -> uo marks o
  ['hao2', 'h\u00E1o', 'hao'], // háo
  ['ma5', 'ma', 'ma'], // neutral tone: no mark
  ['ma0', 'ma', 'ma'], // 0 also treated as neutral
  ['de5 le5', 'de le', 'dele'],
  ['zhi1 dao5', 'zh\u012B dao', 'zhidao'], // zhī dao
  ['chi2', 'ch\u00ED', 'chi'],
  ['shi4', 'sh\u00EC', 'shi'],
  ['ri3', 'r\u01D0', 'ri'],
  ['ri5', 'ri', 'ri'],
  ['ou3', '\u01D2u', 'ou'], // ǒu -> "ou" marks o
  ['dou1', 'd\u014Du', 'dou'], // dōu
  ['ao1', '\u0101o', 'ao'], // āo
  ['ei1', '\u0113i', 'ei'], // ēi
  ['ng2', 'n\u0301g', 'ng'], // syllabic consonant uses a combining mark
  ['hm1', 'h\u0304m', 'hm'], // no precomposed m-macron: combining mark is correct
  ['er2', '\u00E9r', 'er'], // ér
  ['er5', 'er', 'er'],
  ['en1', '\u0113n', 'en'],
  ['ang1', '\u0101ng', 'ang'],
  ['ying4', 'y\u00ECng', 'ying'],
  ['zhao3', 'zh\u01CEo', 'zhao'], // zhǎo
  ['san1 C', 's\u0101n c', 'sanc'], // non-pinyin token kept toneless
  ['11 Qu1', '11 q\u016B', '11qu'], // numeric + capitalised tokens survive
  ['bai3ke4', 'b\u01CEi k\u00E8', 'baike'], // merged syllables split apart
  ['yi1 bu4 zuo4 , er4 bu4 xiu1', 'y\u012B b\u00F9 zu\u00F2 , \u00E8r b\u00F9 xi\u016B', 'yibuzuoerbuxiu'],
];

/** Normalise the several spellings of ü to a single canonical numbered form. */
export function normalizeUmlaut(syllable) {
  return syllable.replace(/u:/g, '\u00FC').replace(/v/g, '\u00FC');
}

/** Lowercase + canonical ü, used before comparison/round-trip checks. */
export function canonicalNumberedToken(token) {
  return normalizeUmlaut(token.toLowerCase());
}

/**
 * Splits a pinyin string into syllable tokens, expanding merged spellings such
 * as `bai3ke4` (CC-CEDICT has a handful of these) and keeping punctuation.
 */
export function tokenizeNumbered(str) {
  const out = [];
  for (const chunk of str.trim().split(/\s+/)) {
    if (!chunk) continue;
    const parts = chunk.match(/[^\d]+|\d+/g);
    if (!parts) {
      out.push(chunk);
      continue;
    }
    // Re-join digits that belong to a syllable ("bai3ke4" -> bai3, ke4; "11" -> 11)
    let buf = '';
    for (const p of parts) {
      if (/^\d+$/.test(p)) {
        buf += p;
        if (/^[a-z\u00FC]+/i.test(buf.replace(/\d+$/, ''))) {
          out.push(buf);
          buf = '';
        }
        continue;
      }
      if (buf) {
        out.push(buf);
        buf = '';
      }
      // a letter run may carry several syllables: "bai3ke4" already split by digits
      out.push(p);
    }
    if (buf) out.push(buf);
  }
  // Re-assemble: letters followed by their tone digit belong together.
  const merged = [];
  for (const t of out) {
    const prev = merged[merged.length - 1];
    if (prev !== undefined && /^\d$/.test(t) && /^[a-z\u00FC:]+$/i.test(prev)) {
      merged[merged.length - 1] = prev + t;
    } else {
      merged.push(t);
    }
  }
  return merged;
}

/**
 * Canonical numbered spelling: lowercase, merged syllables separated,
 * single spaces. `bai3ke4` -> `bai3 ke4`, `Zhong1` -> `zhong1`.
 */
export function normalizeNumbered(str) {
  if (!str) return '';
  return tokenizeNumbered(String(str))
    .map((t) => t.toLowerCase())
    .join(' ');
}

/** Index of the vowel that carries the tone mark for one syllable. */
export function toneMarkIndex(base) {
  const chars = [...base];
  const find = (ch) => chars.indexOf(ch);
  const a = find('a');
  if (a !== -1) return a;
  const e = find('e');
  if (e !== -1) return e;
  const ou = base.indexOf('ou');
  if (ou !== -1) return ou;
  for (let i = chars.length - 1; i >= 0; i--) {
    if (VOWELS.has(chars[i])) return i;
  }
  return -1; // syllabic consonant (m, n, ng, hm, ...)
}

/** One syllable token with an optional trailing tone digit -> { base, tone|null }. */
function splitTone(token) {
  const m = token.match(/^([^0-9]+?)([0-5])?$/);
  if (!m) return null; // numeric or punctuation token
  let base = m[1].toLowerCase().replace(/u:/g, '\u00FC').replace(/v:/g, '\u00FC').replace(/v/g, '\u00FC');
  if (/^[jqxy]\u00FC/.test(base)) base = base.replace('\u00FC', 'u');
  const rawTone = m[2] === undefined ? null : Number(m[2]);
  return { base, tone: rawTone === 0 ? 5 : rawTone, hasDigit: m[2] !== undefined };
}

/** One syllable with an optional trailing tone digit -> marked syllable. */
export function syllableToMarked(token) {
  if (!token) return token;
  const parsed = splitTone(token);
  if (!parsed) return token.toLowerCase(); // "11", ",", ...
  const { base, tone } = parsed;
  if (tone === null || tone === 5) return base;
  const chars = [...base];
  const toneIdx = tone - 1;
  const idx = toneMarkIndex(base);
  if (idx === -1) {
    // Syllabic consonant (m, n, ng, hm): most tone-marked consonants have no
    // precomposed code point, so a combining mark is used deliberately here.
    return chars[0] + COMBINING[toneIdx] + chars.slice(1).join('');
  }
  const row = TONE_VOWEL_TABLE[chars[idx]];
  if (!row) return base;
  chars[idx] = row[toneIdx];
  return chars.join('').normalize('NFC');
}

/** `zhong3 guo2` (or `nv3`, `lu:3`) -> `zhǒng guó`. */
export function numberedToMarked(str) {
  if (!str) return '';
  return tokenizeNumbered(String(str)).map((t) => syllableToMarked(t)).join(' ');
}

/**
 * Numbered or marked -> lowercase toneless, `ü` preserved (`nu:3` -> `nü`).
 * Only digits that behave as tone numbers are removed, so `11 Qu1` -> `11qu`.
 */
export function toPlain(str) {
  let s = String(str).toLowerCase();
  // fold precomposed tone-marked vowels back onto their base vowel (keeps ü as ü)
  let folded = '';
  for (const ch of s) folded += MARKED_TO_BASE.get(ch)?.base ?? ch;
  // combining marks (syllabic consonants, ê tone 1) carry no letter of their own
  folded = [...folded].filter((c) => !/[\u0300-\u036f]/.test(c)).join('');
  const out = [];
  for (const token of tokenizeNumbered(folded)) {
    const parsed = splitTone(token);
    if (!parsed) {
      out.push(token); // numeric / punctuation tokens are kept verbatim
      continue;
    }
    out.push(parsed.base.replace(/[^a-z\u00FC\u00EA]/g, ''));
  }
  return out.join('');
}

/** Split a marked syllable into { base, tone } where an unmarked syllable is tone 5. */
export function analyzeSyllable(syl) {
  let tone = 5;
  let base = '';
  // NB: no NFC normalisation here - the decomposed form (letter + combining
  // tone mark) is exactly what syllabic consonants such as `ng` are encoded as.
  for (const ch of syl) {
    const rev = MARKED_TO_BASE.get(ch);
    if (rev) {
      base += rev.base;
      tone = rev.tone;
      continue;
    }
    if (COMBINING_TONE.has(ch)) {
      tone = COMBINING_TONE.get(ch); // applies to the letter before it
      continue;
    }
    if (ch === '\u030F') {
      tone = 3; // caron is also used for the third tone
      continue;
    }
    if (ch === '\u0308') {
      // stray diaeresis: fold it into the preceding u to make ü
      base = base.endsWith('u') ? `${base.slice(0, -1)}\u00FC` : base + ch;
      continue;
    }
    base += ch;
  }
  const num = base.match(/^([^0-9]+?)([0-5])?$/);
  if (num && num[2] !== undefined) {
    base = num[1];
    if (tone === 5) tone = Number(num[2]) === 0 ? 5 : Number(num[2]);
  }
  return { base: base.toLowerCase(), tone: tone === 0 ? 5 : tone };
}

/** Marked -> numbered in CC-CEDICT spelling (`nǚ` -> `nu:3`, `jū` -> `ju1`). */
export function markedToNumbered(str) {
  if (!str) return '';
  return String(str)
    .trim()
    .split(/\s+/)
    .map((syl) => {
      if (/[0-5]$/.test(syl)) return syl.toLowerCase(); // already numbered
      const { base, tone } = analyzeSyllable(syl);
      if (!base) return syl.toLowerCase();
      if (!/[a-z\u00FC\u00EA]/i.test(base)) return base; // numeric / punctuation
      let out = base;
      if (out.includes('\u00FC')) {
        out = /^[jqxy]/.test(out) ? out.replace(/\u00FC/g, 'u') : out.replace(/\u00FC/g, 'u:');
      }
      return tone >= 1 && tone <= 5 ? `${out}${tone}` : out;
    })
    .join(' ');
}

/** Canonical numbered form used for sorting/ids: lowercase, single-spaced, `u:` kept. */
export function canonicalNumbered(str) {
  if (!str) return '';
  return String(str).trim().split(/\s+/).map((t) => t.toLowerCase()).join(' ');
}

/* ------------------------------------------------------------------ *
 * selftest
 * ------------------------------------------------------------------ */
function assert(cond, msg, failures) {
  if (!cond) failures.push(msg);
}

/** CC-CEDICT-style spelling of a numbered syllable: `v` is written `u:`. */
function cedictSpelling(token) {
  return token.toLowerCase().replace(/v/g, 'u:');
}

export function selftest() {
  const failures = [];
  let checks = 0;
  const note = (cond, msg) => {
    checks++;
    assert(cond, msg, failures);
  };

  // 1. final-vowel x tone table completeness: 7 vowels x 5 tones
  for (const [vowel, row] of Object.entries(TONE_VOWEL_TABLE)) {
    note(row.length === 5, `table row ${JSON.stringify(vowel)} must have 5 entries (got ${row.length})`);
    note(row[4] === vowel, `table row ${JSON.stringify(vowel)} neutral tone must be the bare vowel`);
    for (let i = 0; i < 4; i++) {
      note(row[i] !== row[4], `table row ${JSON.stringify(vowel)} tone ${i + 1} is unmarked`);
      note(row[i] === row[i].normalize('NFC'), `table row ${JSON.stringify(vowel)} tone ${i + 1} is not NFC`);
    }
  }

  // 2. hand-checked spot table (numbered -> marked and numbered -> plain)
  for (const [num, marked, plain] of SPOT_TABLE) {
    const gotMarked = numberedToMarked(num);
    note(gotMarked === marked, `spot marked ${JSON.stringify(num)} -> ${JSON.stringify(gotMarked)} expected ${JSON.stringify(marked)}`);
    const gotPlain = toPlain(num);
    note(gotPlain === plain, `spot plain ${JSON.stringify(num)} -> ${JSON.stringify(gotPlain)} expected ${JSON.stringify(plain)}`);
  }

  // 3. every attested syllable x tone: no crash, correct mark count, NFC, round-trips
  const MARKED_ONLY = new Set();
  for (const row of Object.values(TONE_VOWEL_TABLE)) {
    for (const m of row.slice(0, 4)) if (m.length === 1) MARKED_ONLY.add(m);
  }
  const countMarks = (s) =>
    [...s].filter((c) => MARKED_ONLY.has(c)).length + (s.match(/[\u0300-\u036F]/g) || []).length;
  for (const syl of ATTESTED_SYLLABLES) {
    if (!/^[a-z:]+$/.test(syl)) continue;
    for (const tone of [1, 2, 3, 4, 5]) {
      const numbered = cedictSpelling(`${syl}${tone}`);
      let marked;
      try {
        marked = numberedToMarked(numbered);
      } catch (e) {
        note(false, `crash converting ${numbered}: ${e.message}`);
        continue;
      }
      const marks = countMarks(marked);
      if (tone === 5) {
        note(marks === 0, `neutral ${numbered} -> ${JSON.stringify(marked)} carries a tone mark`);
      } else {
        note(marks === 1, `${numbered} -> ${JSON.stringify(marked)} has ${marks} tone marks (want exactly 1)`);
      }
      note(!/\d/.test(marked), `${numbered} -> ${JSON.stringify(marked)} keeps a tone digit`);
      if (/[aeiouüê]/.test(marked)) {
        note(marked === marked.normalize('NFC'), `${numbered} -> ${JSON.stringify(marked)} is not NFC-normalised`);
      }
      // marked -> numbered -> marked must be stable
      note(numberedToMarked(markedToNumbered(marked)) === marked, `marked instability ${numbered} -> ${marked} -> ${markedToNumbered(marked)}`);
      // numbered -> marked -> numbered must return the canonical spelling
      note(markedToNumbered(marked) === numbered, `round-trip ${numbered} -> ${marked} -> ${markedToNumbered(marked)}`);
      // plain must be toneless lowercase letters (plus digits/punctuation)
      const plain = toPlain(numbered);
      note(!/[0-5]$/.test(plain) || /^\d+$/.test(plain), `plain of ${numbered} ends in a tone digit: ${plain}`);
      note(plain === plain.toLowerCase(), `plain of ${numbered} is not lowercase: ${plain}`);
    }
  }

  // 4. the three spellings of ü agree, and `nv3`/`nu:3` both give `nǚ`
  for (const group of [
    ['nv3', 'nu:3', 'n\u00FC3'],
    ['lv4', 'lu:4', 'l\u00FC4'],
    ['nve4', 'nu:e4', 'n\u00FCe4'],
    ['lve4', 'lu:e4', 'l\u00FCe4'],
  ]) {
    const got = [...new Set(group.map((g) => numberedToMarked(g)))];
    note(got.length === 1, `ü spellings ${JSON.stringify(group)} disagree: ${JSON.stringify(got)}`);
  }
  note(numberedToMarked('nv3') === 'n\u01DA', `nv3 must render as nǚ, got ${numberedToMarked('nv3')}`);
  note(numberedToMarked('nu:3') === 'n\u01DA', `nu:3 must render as nǚ, got ${numberedToMarked('nu:3')}`);
  note(numberedToMarked('lv4') === 'l\u01DC', `lv4 must render as lǜ, got ${numberedToMarked('lv4')}`);

  // 5. after j/q/x/y the umlaut is written u
  for (const [syl, want] of [
    ['ju1', 'j\u016B'],
    ['qu2', 'q\u00FA'],
    ['xu3', 'x\u01D4'],
    ['yu4', 'y\u00F9'],
    ['jue2', 'ju\u00E9'],
    ['xuan3', 'xu\u01CEn'], // xuǎn: the mark goes on `a`
    ['juan4', 'ju\u00E0n'],
  ]) {
    const got = numberedToMarked(syl);
    note(got === want, `${syl} -> ${got} wanted ${want}`);
    note(!got.includes('\u00FC'), `${syl} must not keep an umlaut: ${got}`);
  }

  // 6. tone-mark placement follows a > e > ou > last vowel
  for (const [syl, wantVowel] of [
    ['hao3', 'a'],
    ['hei4', 'e'],
    ['gui4', 'i'],
    ['dou1', 'o'],
    ['dui4', 'i'],
    ['liu4', 'u'],
    ['zhong4', 'o'],
    ['ming2', 'i'],
    ['nv3', '\u00FC'],
    ['lüe4', 'e'],
  ]) {
    const marked = numberedToMarked(syl);
    const row = TONE_VOWEL_TABLE[wantVowel];
    const ok = row ? [...marked].some((c) => row.includes(c)) : false;
    note(ok, `placement ${syl} -> ${marked}: expected the mark on '${wantVowel}'`);
  }

  // 7. multi-syllable strings keep their spacing and punctuation tokens
  note(numberedToMarked('ni4 hao3') === 'n\u00EC h\u01CEo', `ni4 hao3 -> ${numberedToMarked('ni4 hao3')}`);
  note(numberedToMarked('a1 a1 a1') === '\u0101 \u0101 \u0101', 'repeated syllables');
  note(markedToNumbered('zh\u01D2ng gu\u00F3') === 'zhong3 guo2', `reverse zhǒng guó -> ${markedToNumbered('zh\u01D2ng gu\u00F3')}`);
  note(canonicalNumbered('  Zhong1   guo2 ') === 'zhong1 guo2', `canonical -> ${canonicalNumbered('  Zhong1   guo2 ')}`);

  return { checks, failures };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain || process.argv.includes('--pinyin-selftest')) {
  const { checks, failures } = selftest();
  if (failures.length === 0) {
    console.log(`pinyin selftest: OK (${checks} checks)`);
  } else {
    console.error(`pinyin selftest: FAILED (${failures.length} of ${checks} checks)`);
    for (const f of failures.slice(0, 40)) console.error('  - ' + f);
    process.exitCode = 1;
  }
}
