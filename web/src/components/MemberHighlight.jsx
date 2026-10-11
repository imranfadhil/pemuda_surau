import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { CATEGORIES, PRAYERS, PERIODS, badgeFor } from '../lib/constants.js';
import { duplicateNameKeys, disambiguatorFor } from '../lib/members.js';

/**
 * How long each member stays on screen in auto-play (ceremony) mode before
 * moving to the next one. Paused while the pointer/keyboard is at rest — a
 * click on prev/next or close stops the slideshow until re-enabled.
 */
const DEFAULT_AUTO_MS = 15000;

const PERIOD_LABELS = Object.fromEntries(PERIODS.map((p) => [p.key, p.label]));

/**
 * The score a category tile shows, pulled from a member-summary payload.
 * `overall`/`attendance`/`programs`/`merits` are already in points; recitation
 * and memorization are raw session counts (matching the leaderboard).
 */
function categoryScore(summary, key) {
  if (!summary) return 0;
  switch (key) {
    case 'overall':
      return summary.overall ?? 0;
    case 'attendance':
      return summary.attendance_points ?? 0;
    case 'programs':
      return summary.programs ?? 0;
    case 'merits':
      return summary.merits ?? 0;
    case 'recitation':
      return summary.recitation ?? 0;
    case 'memorization':
      return summary.memorization ?? 0;
    default:
      return 0;
  }
}

/** A little extra context under each category tile. */
function categoryDetail(summary, key) {
  if (!summary) return '';
  switch (key) {
    case 'attendance':
      return `${summary.attendance ?? 0} prayers · ${summary.days_attended ?? 0} days`;
    case 'recitation':
      return 'recitation sessions';
    case 'memorization':
      return 'memorization sessions';
    case 'programs':
      return 'program bonus';
    case 'merits':
      return 'good deeds';
    default:
      return '';
  }
}

/**
 * Presentation-ready "highlight" for a single member, designed for the prize
 * giving ceremony: a big, clear summary of one person's performance with
 * prev/next navigation and an optional slideshow that walks through every
 * member automatically (so it can run hands-free on the wall display).
 *
 * The parent owns the queue + current index so the same component works on the
 * user dashboard (the visible leaderboard) and on the kiosk (month/year boards).
 *
 * Props:
 *   members       ordered leaderboard rows ({ id, full_name, rank, ... })
 *   index         current position in `members`
 *   onIndexChange (i) => void
 *   onClose       () => void
 *   period        month | year | all  (score window for the summary)
 *   autoPlay      start the slideshow (default true)
 *   autoPlayMs    dwell time per member (default 15000)
 */
export default function MemberHighlight({
  members,
  index,
  onIndexChange,
  onClose,
  period = 'all',
  autoPlay = true,
  autoPlayMs = DEFAULT_AUTO_MS,
}) {
  const row = members?.[index] || null;
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [playing, setPlaying] = useState(autoPlay);

  const hasMany = (members?.length || 0) > 1;

  // Fetch the full summary whenever we land on a different member.
  useEffect(() => {
    if (!row?.id) return;
    let active = true;
    setLoading(true);
    setSummary(null);
    api
      .memberSummary(row.id, period)
      .then((data) => {
        if (active) setSummary(data.member);
      })
      .catch(() => {
        if (active) setSummary(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [row?.id, period]);

  // Auto-advance through the queue. Stops at the last member rather than
  // looping, so the ceremony naturally ends on the #1 winner.
  useEffect(() => {
    if (!playing || !hasMany) return undefined;
    const t = setInterval(() => {
      onIndexChange(index + 1 >= members.length ? 0 : index + 1);
    }, autoPlayMs);
    return () => clearInterval(t);
  }, [playing, hasMany, index, members?.length, onIndexChange, autoPlayMs]);

  // Keyboard controls: ← / → navigate, Esc closes.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowLeft' && hasMany) onIndexChange((index - 1 + members.length) % members.length);
      else if (e.key === 'ArrowRight' && hasMany) onIndexChange((index + 1) % members.length);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, hasMany, members?.length, onIndexChange, onClose]);

  if (!row) return null;

  const name = row.full_name ?? summary?.full_name ?? '';
  // Same-name members get a disambiguator, but only if a collision exists in
  // this queue (consistent with the leaderboard rows).
  const disambig = disambiguatorFor({ ...row, ...summary }, duplicateNameKeys(members));
  const overall = summary?.overall ?? 0;
  const badge = badgeFor(categoryScore(summary, 'overall'));
  const medal = row.rank === 1 ? 'gold' : row.rank === 2 ? 'silver' : row.rank === 3 ? 'bronze' : '';

  return (
    <div className="highlight-overlay" role="dialog" aria-modal="true" aria-label={`Highlight: ${name}`}>
      <button className="highlight-close" onClick={onClose} aria-label="Close highlight">
        ✕
      </button>

      <div className="highlight-card">
        <div className="highlight-head">
          <div className={`rank-badge highlight-rank ${medal}`}>{row.rank}</div>
          <div className="highlight-title">
            <div className="highlight-name">
              {name}
              {disambig && <span className="highlight-disambig"> · {disambig}</span>}
            </div>
            <div className="highlight-sub">
              {row.guardian_name ? `Child of ${row.guardian_name} · ` : ''}
              {PERIOD_LABELS[period] || 'All time'}
            </div>
          </div>
          {badge && (
            <div className="highlight-tier">
              <span className="highlight-tier-icon">{badge.icon}</span>
              <span className="highlight-tier-label">{badge.label}</span>
            </div>
          )}
        </div>

        {loading ? (
          <p className="highlight-loading">Loading summary…</p>
        ) : (
          <>
            <div className="highlight-hero">
              <div className="highlight-hero-value">{overall}</div>
              <div className="highlight-hero-label">⭐ Overall points</div>
            </div>

            <div className="highlight-cats">
              {CATEGORIES.filter((c) => c.key !== 'overall').map((c) => {
                const score = categoryScore(summary, c.key);
                const detail = categoryDetail(summary, c.key);
                return (
                  <div key={c.key} className="highlight-cat">
                    <div className="highlight-cat-icon">{c.icon}</div>
                    <div className="highlight-cat-score">{score}</div>
                    <div className="highlight-cat-label">{c.label}</div>
                    {detail && <div className="highlight-cat-detail">{detail}</div>}
                  </div>
                );
              })}
            </div>

            <div className="highlight-prayers">
              <div className="highlight-prayers-label">🕌 Prayers in congregation</div>
              <div className="highlight-prayer-row">
                {PRAYERS.map((p) => (
                  <div key={p.key} className="highlight-prayer">
                    <div className="highlight-prayer-count">{summary?.prayers?.[p.key] ?? 0}</div>
                    <div className="highlight-prayer-name">{p.label}</div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {hasMany && (
          <div className="highlight-nav">
            <button
              className="btn highlight-nav-btn"
              onClick={() => onIndexChange((index - 1 + members.length) % members.length)}
            >
              ‹ Previous
            </button>
            <button
              className="btn-ghost highlight-play"
              onClick={() => setPlaying((v) => !v)}
              title={playing ? 'Pause slideshow' : 'Play slideshow'}
            >
              {playing ? '⏸ Pause' : '▶ Play'}
            </button>
            <span className="highlight-pos">
              {index + 1} / {members.length}
            </span>
            <button
              className="btn highlight-nav-btn"
              onClick={() => onIndexChange((index + 1) % members.length)}
            >
              Next ›
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
