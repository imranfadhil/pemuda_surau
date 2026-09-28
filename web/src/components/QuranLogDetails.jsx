import { formatDate } from '../lib/constants.js';

/**
 * The surah / juz / pages / note a teacher (or the member) recorded for a Quran
 * activity.
 *
 * This detail is the whole point of the record for a parent — "your child
 * recited Al-Kahf, Juz 15, 3 pages" — so it is rendered in full rather than
 * truncated into a single muted line. `note` gets its own line because it is
 * free text and can be long.
 */
export default function QuranLogDetails({ log, showMember = false, className = '' }) {
  const facts = [
    log.surah,
    log.juz ? `Juz ${log.juz}` : null,
    log.pages ? `${log.pages} ${log.pages === 1 ? 'page' : 'pages'}` : null,
  ].filter(Boolean);

  return (
    <div className={`quran-details ${className}`}>
      <div className="quran-details-head">
        <span className={`pill ${log.kind === 'memorization' ? 'quran-pill-mem' : 'quran-pill-rec'}`}>
          {log.kind === 'recitation' ? '📖 Recitation' : '🧠 Memorization'}
        </span>
        {showMember && log.full_name && <strong>{log.full_name}</strong>}
        <span className="muted">{formatDate(log.logged_date)}</span>
      </div>

      {facts.length > 0 ? (
        <div className="quran-facts">
          {facts.map((f) => (
            <span key={f} className="quran-fact">
              {f}
            </span>
          ))}
        </div>
      ) : (
        <div className="muted quran-fact-empty">No surah, juz or pages recorded.</div>
      )}

      {log.note && <div className="quran-note">📝 {log.note}</div>}

      <div className="muted quran-byline">
        {log.logged_by_name ? `Recorded by ${log.logged_by_name}` : 'Self-logged'}
        {log.updated_by_name && (
          <span className="quran-edited"> · ✏️ edited by {log.updated_by_name}</span>
        )}
      </div>
    </div>
  );
}
