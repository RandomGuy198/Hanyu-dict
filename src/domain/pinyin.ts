/** Pinyin handling: tone-number <-> tone-mark conversion, toneless keys, and query variants.
 *  Written from the published rules of Hanyu Pinyin (an orthographic system, not licensed
 *  content); no third-party romanisation table is copied. */

const VOWELS: Record<string, string[]> = {
  a: ['a', 'ā', 'á', 'ǎ', 'à'],
  e: ['e', 'ē', 'é', 'ě', 'è'],
  'ê': ['ê', 'ê̂', 'ế', 'ê̌', 'ề'],
  i: ['i', 'ī', 'í', 'ǐ', 'ì'],
  o: ['o', 'ō', 'ó', 'ǒ', 'ò'],
  u: ['u', 'ū', 'ú', 'ǔ', 'ù'],
  'ü': ['ü', 'ǖ', 'ǘ', 'ǚ', 'ǜ'],
};

const MARKED_TO_PLAIN = new Map<string, string>();
for (const [key, forms] of Object.entries(VOWELS)) {
  forms.forEach((form, tone) => {
    if (tone > 0) MARKED_TO_PLAIN.set(form, key);
  });
}
// Pre-composed forms that Unicode decomposition quirks can miss.
MARKED_TO_PLAIN.set('ê̂', 'ê');
MARKED_TO_PLAIN.set('ế', 'ê');
MARKED_TO_PLAIN.set('ê̌', 'ê');
MARKED_TO_PLAIN.set('ề', 'ê');

/** `u:`, `v` and `ü` all mean the same vowel; internal key form is `ü`. */
export function canonicaliseVowel(input: string): string {
  return input.replace(/u:/g, 'ü').replace(/[vV]/g, 'ü');
}

/** Split `zhong3 guo2` / `Zhong1 yang2 Xian4` into syllable tokens with tone digits. */
export function syllables(numbered: string): { base: string; tone: number }[] {
  return canonicaliseVowel(numbered)
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => {
      const match = /^(.*?)([1-5])?$/.exec(token);
      const base = (match?.[1] ?? token).toLowerCase();
      const tone = match?.[2] ? Number(match[2]) : toneFromMarks(base) || 5;
      return { base, tone };
    });
}

function markVowel(syllable: string, tone: number): string {
  if (tone <= 0 || tone > 4) return syllable;
  const chars = [...syllable];
  const isVowel = (c: string) => 'aeiouüê'.includes(c.toLowerCase());
  const findIndex = (): number => {
    const lower = syllable.toLowerCase();
    const a = lower.indexOf('a');
    if (a >= 0) return a;
    const e = lower.indexOf('e');
    if (e >= 0) return e;
    if (lower.includes('ou')) return lower.indexOf('o');
    const ê = lower.indexOf('ê');
    if (ê >= 0) return ê;
    let last = -1;
    for (let i = 0; i < chars.length; i++) if (isVowel(chars[i])) last = i;
    return last;
  };
  const idx = findIndex();
  if (idx < 0) return syllable;
  const vowel = chars[idx].toLowerCase();
  const forms = VOWELS[vowel];
  if (!forms) return syllable;
  const marked = forms[tone];
  const wasUpper = chars[idx] !== chars[idx].toLowerCase();
  chars[idx] = wasUpper ? marked.toUpperCase() : marked;
  return chars.join('');
}

/** `zhong3 guo2` -> `zhǒng guó` (capitalisation preserved, `u:`/`v` -> `ü`). */
export function numberedToMarks(numbered: string): string {
  return canonicaliseVowel(numbered)
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => {
      const match = /^(.*?)([1-5])?$/.exec(token);
      const base = (match?.[1] ?? token).toLowerCase();
      const tone = match?.[2] ? Number(match[2]) : 5;
      return markVowel(base, tone);
    })
    .join(' ');
}

/** Tone marks -> tone digits; used when a learner types accented pinyin. */
export function marksToNumbered(marked: string): string {
  return canonicaliseVowel(marked)
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => {
      const tone = toneFromMarks(token);
      return stripToneMarks(token).toLowerCase() + (tone || '5');
    })
    .join(' ');
}

export function toneFromMarks(token: string): number {
  for (const [marked, plain] of MARKED_TO_PLAIN) {
    if (token.includes(marked)) {
      const forms = VOWELS[plain];
      const idx = forms ? forms.indexOf(marked) : -1;
      if (idx > 0) return idx;
    }
  }
  return 0;
}

/** Remove tone diacritics, keeping `ü`. */
export function stripToneMarks(marked: string): string {
  let out = '';
  for (const ch of marked) {
    const plain = MARKED_TO_PLAIN.get(ch);
    out += plain ?? ch;
  }
  // ê is two code points; collapse the combining forms back to the base sequence.
  return out.normalize('NFC').replace(/ê\u0302/g, 'ê');
}

/** Key form used by the index: lowercase, toneless, `ü` written as `v`.
 *  A trailing tone digit is only dropped from tokens that contain a letter, so numeric
 *  headwords such as `110` keep their digits. */
export function pinyinKey(input: string): string {
  const lower = input.toLowerCase();
  const hasMarks = [...lower].some((ch) => MARKED_TO_PLAIN.has(ch));
  const source = hasMarks ? marksToNumbered(lower) : lower;
  return canonicaliseVowel(source)
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => {
      const cleaned = token.replace(/[^a-z0-9üê]/g, '');
      return /[a-z]/.test(cleaned) ? cleaned.replace(/[1-5]$/, '') : cleaned;
    })
    .join('')
    .replace(/ü/g, 'v');
}

/** Search keys for a learner-typed query: tolerates `lv`, `lü`, `lu:`, tone digits, marks. */
export function queryPinyinKeys(text: string): string[] {
  const trimmed = text.trim().toLowerCase();
  if (!trimmed) return [];
  const spaced = trimmed.replace(/([1-5])(?=[^\s]*\s|$)/g, '$1 ');
  const keys = new Set<string>();
  const base = canonicaliseVowel(spaced);
  keys.add(pinyinKey(base));
  // `v` typed for the u-umlaut and the reverse reading are both accepted.
  keys.add(pinyinKey(base.replace(/v/g, 'ü')));
  keys.add(pinyinKey(spaced.replace(/ü/g, 'u')));
  keys.delete('');
  return [...keys].filter((k) => k.length > 0);
}

/** Rough syllable inventory used only to bias a query toward pinyin; a miss is harmless
 *  because the engine always runs definition search in parallel. */
const BASE_SYLLABLES = new Set(
  ('a ai an ang ao ba bai ban bang bao bei ben beng bi bian biao bie bo bu cai can cang cao ce ' +
    'cen ceng cha chai chan chang chao che chen cheng chi chong chou chu chua chuai chuan chuang ' +
    'chui chun chuo ci cong cu cuan cui cun cuo da dai dan dang dao de dei den deng di dia dian ' +
    'diao die ding diu dong dou du duan dui dun duo e ei en eng er fa fan fang fei fen feng fo ' +
    'fou fu ga gai gan gang gao ge gei gen geng gong gou gu gua guai guan guang gui gun guo ha ' +
    'hai han hang hao he hei hen hong hou hu hua huai huan huang hui hun huo ji jia jian jiang ' +
    'jiao jie jin jing jiong jiu ju juan jue jun ka kai kan kang kao ke ken keng kong kou ku kua ' +
    'kuai kuan kuang kui kun kuo la lai lan lang lao le lei leng li lia lian liang liao lie lin ' +
    'ling liu long lou lu luan lun luo lv lve ma mai man mang mao me mei men meng mi mian miao ' +
    'mie min ming miu mo mou mu na nai nan nang nao ne nen neng ni nian niang niao nie nin ning ' +
    'niu nong nou nu nuan nun nuo nv nve o ou pa pai pan pang pao pei pen peng pi pian piao pie ' +
    'pin ping po pou pu qi qia qian qiang qiao qie qin qing qiong qiu qu quan que qun ran rang ' +
    'rao re ren reng ri rong rou ru ruan rui run ruo sa sai san sang sao se sen seng sha shai ' +
    'shan shang shao she shen sheng shi shou shu shua shuai shuan shuang shui shun shuo si song ' +
    'sou su suan sui sun suo ta tai tan tang tao te teng ti tian tiao tie ting tong tou tu tuan ' +
    'tui tun tuo wa wai wan wang wei wen weng wo wu xi xia xian xiang xiao xie xin xing xiong xiu ' +
    'xu xuan xue xun ya yan yang yao ye yi yin ying yo yong you yu yuan yue yun za zai zan zang ' +
    'ze zei zen zeng zha zhai zhan zhang zhao zhe zhen zheng zhi zhong zhou zhu zhua zhuai zhuan ' +
    'zhuang zhui zhun zhuo zi zong zou zu zuan zui zun zuo')
    .split(' '),
);

/** How many whitespace-separated tokens of the query are plausible pinyin syllables. */
export function pinyinPlausibility(text: string): number {
  const tokens = canonicaliseVowel(text.trim().toLowerCase()).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return 0;
  // The table keeps the `v` spellings (lv, nve); the token is canonicalised to `ü` first, so
  // both spellings are looked up.
  const known = (syllable: string) =>
    BASE_SYLLABLES.has(syllable) || BASE_SYLLABLES.has(syllable.replace(/ü/g, 'v'));
  const syllabic = tokens.filter((token) => {
    const bare = token.replace(/[1-5]$/, '').replace(/[^a-züvê]/g, '');
    if (!bare) return false;
    if (known(bare)) return true;
    // concatenated syllables, e.g. "zhongguo": accept when a greedy split works
    let rest = bare;
    let hits = 0;
    while (rest.length > 0) {
      let matched = '';
      for (const size of [6, 5, 4, 3, 2, 1]) {
        const candidate = rest.slice(0, size);
        if (known(candidate)) {
          matched = candidate;
          break;
        }
      }
      if (!matched) break;
      rest = rest.slice(matched.length);
      hits++;
    }
    return hits > 0 && rest.length === 0;
  });
  return syllabic.length / tokens.length;
}

/** Han ideographs on the plane a UTF-16 code unit can address. Written as escapes with the `u`
 *  flag: a literal range such as 豈-﫿 (U+8C48-U+FAFF) swallows the surrogate block
 *  U+D800-U+DFFF, which makes every astral character - emoji included - test as Han. */
const HAN = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/u;
const KANA = /[\u3040-\u30FF]/u;

export function hasCjk(text: string): boolean {
  return HAN.test(text) || KANA.test(text);
}

export function isHanCharacter(ch: string): boolean {
  return HAN.test(ch);
}
