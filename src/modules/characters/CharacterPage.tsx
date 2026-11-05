/** /character/:value — one Hanzi, only what the installed packs actually record:
 *  readings, radical, stroke count, gloss, variants, real example words and sentences,
 *  and the shared stroke animation / quiz panel. Nothing is fabricated. */

import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  AttributionNote,
  EmptyState,
  EntryLine,
  LoadingGate,
  PageHeader,
  SpeakButton,
} from '../../components';
import { IconAlert, IconPen, IconSearch } from '../../app/icons';
import { useDictionary, usePreferences } from '../../app/providers';
import { isHanCharacter } from '../../domain/pinyin';
import type { CharRecord } from '../../domain/service';
import type { ExampleSentence, SearchResult } from '../../domain/types';
import { packOverview } from '../../data/packs';
import type { PackOverview } from '../../data/packs';
import { StrokePanel } from './StrokePanel';
import './characters.css';

function codepointLabel(codepoint: number): string {
  return `U+${codepoint.toString(16).toUpperCase().padStart(4, '0')}`;
}

function radicalLabel(radical: string): string | null {
  const match = /^(\d+)'(\d+)$/.exec(radical.trim());
  if (!match) return radical.trim() ? radical.trim() : null;
  return `Kangxi radical ${match[1]}, ${match[2]} further stroke${match[2] === '1' ? '' : 's'}`;
}

export default function CharacterPage() {
  const params = useParams();
  const { api } = useDictionary();
  const { prefs } = usePreferences();
  const char = [...(params.value ?? '')][0] ?? '';
  const valid = char !== '' && isHanCharacter(char);

  const [rec, setRec] = useState<CharRecord | null | undefined>(undefined);
  const [rows, setRows] = useState<SearchResult[]>([]);
  const [examples, setExamples] = useState<ExampleSentence[]>([]);
  const [packRows, setPackRows] = useState<PackOverview[] | null>(null);

  useEffect(() => {
    let alive = true;
    packOverview()
      .then((rows) => {
        if (alive) setPackRows(rows);
      })
      .catch(() => {
        if (alive) setPackRows([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!api || !valid) return;
    let alive = true;
    setRec(undefined);
    setRows([]);
    api
      .character(char)
      .then((record) => {
        if (alive) setRec(record);
      })
      .catch((error: unknown) => {
        console.error('[characters] character lookup failed', error);
        if (alive) setRec(null);
      });
    api
      .search(char, { limit: 40 })
      .then((outcome) => {
        if (!alive) return;
        setRows(
          outcome.results.filter(
            (row) => row.entry.simplified.includes(char) || row.entry.traditional.includes(char),
          ),
        );
      })
      .catch((error: unknown) => {
        console.error('[characters] character search failed', error);
      });
    return () => {
      alive = false;
    };
  }, [api, char, valid]);

  useEffect(() => {
    if (!api || !prefs.showExamples) return;
    const words = [
      ...new Set(
        rows
          .slice(0, 8)
          .map((row) => row.entry.simplified)
          .filter((word) => word.length >= 2 && word.includes(char)),
      ),
    ].slice(0, 4);
    if (words.length === 0) {
      setExamples([]);
      return;
    }
    let alive = true;
    Promise.all(words.map((word) => api.examples(word, 1)))
      .then((lists) => {
        if (alive) setExamples(lists.flat());
      })
      .catch((error: unknown) => {
        console.error('[characters] example lookup failed', error);
        if (alive) setExamples([]);
      });
    return () => {
      alive = false;
    };
  }, [api, rows, char, prefs.showExamples]);

  const charPack = packRows?.find((row) => row.pack.id === 'characters') ?? null;
  const examplesPack = packRows?.find((row) => row.pack.id === 'examples') ?? null;

  const header = (
    <PageHeader
      title={valid ? `Character ${char}` : 'Character'}
      subtitle={
        valid ? (
          <>
            Readings and definitions from the installed Unihan-based data.{' '}
            <Link to={`/writing?c=${encodeURIComponent(char)}`}>Practise writing {char}</Link>
          </>
        ) : (
          'This page shows one Chinese character from the installed data.'
        )
      }
      back={{ label: 'Back to search', to: valid ? `/search?q=${encodeURIComponent(char)}` : '/search' }}
      actions={
        valid ? (
          <>
            <SpeakButton text={char} label={`Speak ${char}`} />
            <Link className="btn btn-sm" to={`/search?q=${encodeURIComponent(char)}`}>
              <IconSearch /> Words with {char}
            </Link>
          </>
        ) : null
      }
    />
  );

  if (!valid) {
    return (
      <div className="stack">
        {header}
        <EmptyState
          icon={<IconAlert />}
          title="That is not a Chinese character"
          detail={
            params.value
              ? `“${params.value.slice(0, 12)}” is not a CJK ideograph, so there is no character record to show. Character pages accept exactly one Hanzi, e.g. #/character/中.`
              : 'Character pages accept exactly one Hanzi, e.g. #/character/中.'
          }
          action={
            <Link className="btn btn-primary" to="/search">
              Search the dictionary instead
            </Link>
          }
        />
      </div>
    );
  }

  const glosses = rec ? rec.definition.split(';').map((g) => g.trim()).filter(Boolean) : [];
  const radical = rec ? radicalLabel(rec.radical) : null;
  const variantGroup = (title: string, codepoints: number[]) => {
    const items = codepoints
      .filter((cp) => cp !== rec?.codepoint)
      .map((cp) => String.fromCodePoint(cp));
    if (items.length === 0) return null;
    return (
      <div className="char-variants-row" key={title}>
        <span className="text-sm muted">{title}: </span>
        {items.map((variant) => (
          <Link key={variant} className="chip" to={`/character/${encodeURIComponent(variant)}`}>
            {variant}
          </Link>
        ))}
      </div>
    );
  };

  return (
    <div className="stack">
      {header}
      <LoadingGate>
        {rec === undefined ? (
          <>
            <div className="skeleton" style={{ height: 110 }} />
            <div className="skeleton" style={{ height: 220 }} />
          </>
        ) : rec === null ? (
          <div className="stack">
            <EmptyState
              title={`No data for ${char} in this dictionary`}
              detail="This character is not recorded in the installed characters pack. Nothing here invents a reading or a stroke count; the codepoint below is simply a fact about the input."
            />
            <p className="char-codepoint">{codepointLabel(char.codePointAt(0) ?? 0)}</p>
            <div className="char-links">
              <Link className="btn btn-sm" to={`/search?q=${encodeURIComponent(char)}`}>
                Look for words containing {char}
              </Link>
            </div>
            <StrokePanel char={char} />
          </div>
        ) : (
          <div className="stack">
            <div className="card">
              <div className="char-head">
                <div className="char-glyph-box">
                  <p className="char-glyph cjk" lang="zh">
                    {rec.char}
                  </p>
                  <span className="char-codepoint">{codepointLabel(rec.codepoint)}</span>
                </div>
                <dl className="char-facts">
                  {rec.mandarin.length > 0 ? (
                    <>
                      <dt>Mandarin</dt>
                      <dd>
                        <span className="char-readings">
                          {rec.mandarin.map((reading) => (
                            <span className="pinyin" key={reading}>
                              {reading}
                            </span>
                          ))}
                        </span>
                      </dd>
                    </>
                  ) : null}
                  {rec.hanViet && rec.hanViet.length > 0 ? (
                    <>
                      <dt>Hán-Việt</dt>
                      <dd lang="vi">{rec.hanViet.join(', ')}</dd>
                    </>
                  ) : null}
                  {rec.cantonese ? (
                    <>
                      <dt>Cantonese</dt>
                      <dd lang="yue">{rec.cantonese}</dd>
                    </>
                  ) : null}
                  <dt>Strokes</dt>
                  <dd>{rec.strokeCount ?? 'not recorded in this data'}</dd>
                  {radical ? (
                    <>
                      <dt>Radical</dt>
                      <dd>{radical}</dd>
                    </>
                  ) : null}
                  {rec.traditionalOf.length > 0 ? (
                    <>
                      <dt>Traditional</dt>
                      <dd>{rec.traditionalOf.map((cp) => String.fromCodePoint(cp)).join(' / ')}</dd>
                    </>
                  ) : null}
                  {rec.simplifiedOf.length > 0 ? (
                    <>
                      <dt>Simplified</dt>
                      <dd>{rec.simplifiedOf.map((cp) => String.fromCodePoint(cp)).join(' / ')}</dd>
                    </>
                  ) : null}
                </dl>
              </div>
              {glosses.length > 0 ? (
                <ol className="char-glosses" lang="en">
                  {glosses.map((gloss, index) => (
                    <li key={`${index}-${gloss.slice(0, 16)}`}>{gloss}</li>
                  ))}
                </ol>
              ) : (
                <p className="muted text-sm">No English definition is recorded for this character.</p>
              )}
              <div className="char-variants">
                {variantGroup('Simplified variants', rec.simplifiedOf)}
                {variantGroup('Traditional variants', rec.traditionalOf)}
              </div>
              {charPack ? (
                <AttributionNote
                  attribution={charPack.pack.attribution}
                  license={charPack.pack.license}
                  version={charPack.pack.version}
                />
              ) : null}
            </div>

            <StrokePanel char={char} />
            <Link className="btn" to={`/writing?c=${encodeURIComponent(char)}`}>
              <IconPen /> Practise {char} on the writing grid
            </Link>

            <section aria-label="Example sentences">
              <div className="section-title">
                <h2>Example sentences</h2>
              </div>
              {examples.length > 0 ? (
                <div className="card card-tight">
                  {examples.map((sentence) => (
                    <div className="char-example" key={`${sentence.headword}-${sentence.simplified}`}>
                      <p className="char-example-zh" lang="zh">
                        {prefs.displayScript === 'traditional' ? sentence.traditional : sentence.simplified}
                      </p>
                      <p className="char-example-py">{sentence.pinyin}</p>
                      <p className="char-example-en" lang="en">
                        {sentence.english}
                      </p>
                    </div>
                  ))}
                </div>
              ) : examplesPack ? (
                <p className="muted text-sm">
                  No example sentences are recorded for words built on {char}.
                </p>
              ) : (
                <p className="muted text-sm">This dictionary build ships without example sentences.</p>
              )}
            </section>

            <section aria-label="Words containing this character">
              <div className="section-title">
                <h2>Words containing {char}</h2>
                {rows.length > 0 ? <span className="badge">{rows.length} found</span> : null}
              </div>
              {rows.length === 0 ? (
                <p className="muted text-sm">
                  No dictionary entry on this device contains {char}.
                </p>
              ) : (
                <ul className="list">
                  {rows.slice(0, 12).map((row) => (
                    <EntryLine key={row.entry.id} entry={row.entry} />
                  ))}
                </ul>
              )}
              {rows.length > 12 ? (
                <Link className="btn btn-sm" to={`/search?q=${encodeURIComponent(char)}`}>
                  See all {rows.length} results in search
                </Link>
              ) : null}
            </section>
          </div>
        )}
      </LoadingGate>
    </div>
  );
}
