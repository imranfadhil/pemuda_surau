import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { formatDateTime, can } from '../lib/constants.js';
import ProgramCheckIn from '../components/ProgramCheckIn.jsx';

/** "in 2h 15m" / "started 10m ago" — a quick sense of how far off a program is. */
function relativeTo(iso, now) {
  const diff = new Date(iso).getTime() - now;
  const abs = Math.abs(diff);
  const totalMin = Math.floor(abs / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  const span = h > 0 ? `${h}h ${m}m` : `${m}m`;
  return diff >= 0 ? `in ${span}` : `${span} ago`;
}

/**
 * Full-screen viewer for a program poster. The card thumbnail is far too small
 * to read the details printed on a poster, so tapping it opens the image at a
 * readable size. Closes on backdrop click, the ✕ button, or Escape.
 */
function PosterLightbox({ src, alt, onClose }) {
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    // Lock background scroll while the overlay is open.
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div className="poster-lightbox" onClick={onClose} role="dialog" aria-modal="true" aria-label={alt}>
      <button className="poster-lightbox-close" onClick={onClose} aria-label="Close">
        ✕
      </button>
      <img
        className="poster-lightbox-img"
        src={src}
        alt={alt}
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}

function ProgramCard({ program, now, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [checkingIn, setCheckingIn] = useState(false);
  const [result, setResult] = useState(null);
  const [posterOpen, setPosterOpen] = useState(false);

  const start = new Date(program.starts_at);
  const isPast = !program.is_recurring && new Date(program.check_in_closes_at) < new Date(now);
  const hasEnded = program.ends_at ? new Date(program.ends_at) < new Date(now) : false;
  const nextStart = program.next_start || program.starts_at;

  async function toggleJoin() {
    setBusy(true);
    setError('');
    try {
      if (program.joined) await api.leaveProgram(program.id);
      else await api.joinProgram(program.id);
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (checkingIn) {
    return (
      <ProgramCheckIn
        program={program}
        onCancel={() => setCheckingIn(false)}
        onDone={(res) => {
          setCheckingIn(false);
          setResult(res);
          onChanged();
        }}
      />
    );
  }

  return (
    <div className="card">
      <div className="program-card">
        {program.poster_url ? (
          <button
            type="button"
            className="program-poster-btn"
            onClick={() => setPosterOpen(true)}
            aria-label={`View poster for ${program.title}`}
          >
            <img className="program-poster-thumb" src={program.poster_url} alt="" />
          </button>
        ) : (
          <div
            className="program-date"
            style={isPast ? { background: 'var(--slate-400)' } : undefined}
          >
            <div className="day">{start.getDate()}</div>
            <div className="mon">{start.toLocaleDateString(undefined, { month: 'short' })}</div>
          </div>
        )}
        <div style={{ flex: 1 }}>
          <div className="row-between">
            <strong>{program.title}</strong>
            <div className="row" style={{ gap: 6 }}>
              {program.is_recurring && <span className="pill">🔁 Recurring</span>}
              {program.is_open && <span className="pill">Check-in open</span>}
              {program.checked_in_at && <span className="pill">✓ Attended</span>}
              {program.joined && !program.checked_in_at && <span className="pill">Going</span>}
            </div>
          </div>

          <div className="muted" style={{ margin: '4px 0' }}>
            {program.is_recurring ? (
              <>
                {program.recurrence_summary || 'Recurring'} · next {formatDateTime(nextStart)}
              </>
            ) : (
              <>
                {formatDateTime(program.starts_at)}
                {program.ends_at ? ` – ${formatDateTime(program.ends_at)}` : ''}
              </>
            )}
            {program.location ? ` · ${program.location}` : ''}
          </div>

          {!isPast && (
            <div className="muted" style={{ fontSize: '0.78rem' }}>
              Starts {relativeTo(nextStart, now)}
            </div>
          )}

          {program.description && (
            <p style={{ margin: '6px 0', fontSize: '0.9rem' }}>{program.description}</p>
          )}

          {program.links?.length > 0 && (
            <div className="row" style={{ gap: 6, flexWrap: 'wrap', margin: '6px 0' }}>
              {program.links.map((l, i) => (
                <a key={i} className="btn btn-sm btn-secondary" href={l.url} target="_blank" rel="noreferrer">
                  🔗 {l.label}
                </a>
              ))}
            </div>
          )}

          <div className="muted" style={{ fontSize: '0.78rem' }}>
            {program.join_count} going · {program.checked_in_count} attended
          </div>

          {error && <div className="alert alert-error" style={{ marginTop: 10 }}>{error}</div>}
          {result && (
            <div className="alert alert-success" style={{ marginTop: 10 }}>
              Checked in to <strong>{program.title}</strong>! Confidence{' '}
              {(result.confidence * 100).toFixed(1)}%
            </div>
          )}

          <div className="row" style={{ marginTop: 10, flexWrap: 'wrap' }}>
            {!isPast && (
              <button className="btn btn-sm btn-secondary" disabled={busy} onClick={toggleJoin}>
                {program.joined ? 'Not going' : "I'm going"}
              </button>
            )}
            {program.is_open && program.check_in_enabled && !program.checked_in_at && (
              <button className="btn btn-sm" onClick={() => setCheckingIn(true)}>
                Check in
              </button>
            )}
            {program.checked_in_at && (
              <span className="muted" style={{ fontSize: '0.78rem' }}>
                Checked in {formatDateTime(program.checked_in_at)}
              </span>
            )}
            {!program.is_open && !hasEnded && program.check_in_enabled && (
              <span className="muted" style={{ fontSize: '0.78rem' }}>
                Check-in opens {formatDateTime(program.check_in_opens_at)}
              </span>
            )}
          </div>
        </div>
      </div>
      {posterOpen && (
        <PosterLightbox
          src={program.poster_url}
          alt={`${program.title} poster`}
          onClose={() => setPosterOpen(false)}
        />
      )}
    </div>
  );
}

export default function ProgramsPage() {
  const { user } = useAuth();
  const isAdmin = can(user, 'managePrograms');
  const [programs, setPrograms] = useState([]);
  const [includePast, setIncludePast] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());

  function load() {
    setLoading(true);
    api
      .listPrograms(includePast)
      .then((data) => setPrograms(data.programs))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }

  useEffect(load, [includePast]);

  // Keeps the "starts in…" labels and the check-in buttons honest without a
  // full refetch.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  const openNow = programs.filter((p) => p.is_open && p.check_in_enabled && !p.checked_in_at);

  return (
    <div>
      <div className="row-between">
        <div>
          <h1 className="page-title">Programs</h1>
          <p className="page-sub">Activities at the surau — join and check in on arrival.</p>
        </div>
        {isAdmin && (
          <Link className="btn btn-sm btn-secondary" to="/admin">
            Manage
          </Link>
        )}
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {!user?.hasFace && (
        <div className="alert alert-info">
          You haven't enrolled your face yet — you'll need it to check in.{' '}
          <Link to="/register"><strong>Complete registration →</strong></Link>
        </div>
      )}

      {openNow.length > 0 && (
        <div className="alert alert-success">
          <strong>{openNow.length}</strong> program{openNow.length > 1 ? 's are' : ' is'} open for
          check-in right now.
        </div>
      )}

      <div className="tab-row">
        <button className={`tab ${!includePast ? 'active' : ''}`} onClick={() => setIncludePast(false)}>
          Current &amp; upcoming
        </button>
        <button className={`tab ${includePast ? 'active' : ''}`} onClick={() => setIncludePast(true)}>
          All
        </button>
      </div>

      {loading ? (
        <p className="muted">Loading…</p>
      ) : programs.length === 0 ? (
        <div className="card center muted">No programs yet.</div>
      ) : (
        programs.map((p) => (
          <ProgramCard key={p.id} program={p} now={now} onChanged={load} />
        ))
      )}
    </div>
  );
}
