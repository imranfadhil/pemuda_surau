import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import CommunityLink from '../components/CommunityLink.jsx';
import { PRAYERS, PRAYER_LABELS, SURAU } from '../lib/constants.js';

function formatClock(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export default function HomePage() {
  const { user } = useAuth();
  const [today, setToday] = useState([]);
  const [family, setFamily] = useState([]);
  const [breakdown, setBreakdown] = useState(null);
  const [quran, setQuran] = useState(null);
  const [merits, setMerits] = useState(null);
  const [win, setWin] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.myToday(),
      api.myBreakdown(),
      api.familyToday(),
      api.myQuran(),
      api.myMerits(),
    ])
      .then(([t, b, f, q, m]) => {
        setToday(t.prayers);
        setBreakdown(b.breakdown);
        setFamily(f.members);
        setQuran(q);
        setMerits(m);
      })
      .catch(() => {})
      .finally(() => setLoading(false));

    const loadWindow = () => api.currentWindow().then(setWin).catch(() => {});
    loadWindow();
    const poll = setInterval(loadWindow, 60000);
    return () => clearInterval(poll);
  }, []);

  const total = breakdown ? Object.values(breakdown).reduce((a, b) => a + b, 0) : 0;
  const current = win?.current || null;
  const next = win?.next || null;
  const activePrayer = current?.prayer || null;
  const dependents = family.filter((m) => m.isDependent);

  return (
    <div>
      <h1 className="page-title">Assalamualaikum, {user?.fullName?.split(' ')[0] || 'friend'} 👋</h1>
      <p className="page-sub">Your prayer, Quran and good deeds today.</p>

      <div className="card">
        <h2 className="card-title">🕌 {SURAU.name}</h2>
        <p className="muted" style={{ margin: '6px 0' }}>{SURAU.address}</p>
        <a href={SURAU.mapsUrl} target="_blank" rel="noreferrer">
          {SURAU.latitude}° N, {SURAU.longitude}° E — Open in Maps
        </a>
      </div>

      <CommunityLink variant="card" />

      {!user?.hasFace && (
        <div className="alert alert-info">
          You haven't enrolled your face yet.{' '}
          <Link to="/register"><strong>Complete registration →</strong></Link>
        </div>
      )}

      <div className="stat-grid">
        <div className="stat">
          <div className="value">{loading ? '–' : today.length}/5</div>
          <div className="label">🕌 Today</div>
        </div>
        <div className="stat">
          <div className="value">{loading ? '–' : total}</div>
          <div className="label">🕌 Check-ins</div>
        </div>
        <div className="stat">
          <div className="value">{loading ? '–' : quran?.recitation ?? 0}</div>
          <div className="label">📖 Recitations</div>
        </div>
        <div className="stat">
          <div className="value">{loading ? '–' : quran?.memorization ?? 0}</div>
          <div className="label">🧠 Memorizations</div>
        </div>
        <div className="stat">
          <div className="value">{loading ? '–' : merits?.total ?? 0}</div>
          <div className="label">🏅 Merit points</div>
        </div>
      </div>

      <div className="card">
        <div className="row-between" style={{ marginBottom: 14 }}>
          <h2 className="card-title">Today's prayers</h2>
          <Link className="pill" to="/check-in">
            Check in
          </Link>
        </div>

        {current ? (
          <div className="alert alert-success" style={{ marginBottom: 14 }}>
            <strong>{PRAYER_LABELS[current.prayer]}</strong> is open for check-in until{' '}
            {formatClock(current.end)}.
          </div>
        ) : (
          next && (
            <div className="alert alert-info" style={{ marginBottom: 14 }}>
              Next prayer: <strong>{PRAYER_LABELS[next.prayer]}</strong> at{' '}
              {formatClock(next.adhan)}.
            </div>
          )
        )}

        <div className="prayer-grid">
          {PRAYERS.map((p) => {
            const done = today.includes(p.key);
            return (
              <div
                key={p.key}
                className={`prayer-tile ${done ? 'done' : ''} ${
                  activePrayer === p.key ? 'active' : ''
                }`}
              >
                <div className="check">{done ? '✅' : '⭕'}</div>
                <div>{p.label}</div>
              </div>
            );
          })}
        </div>
      </div>

      {dependents.length > 0 && (
        <div className="card">
          <div className="row-between" style={{ marginBottom: 12 }}>
            <h2 className="card-title">👨‍👩‍👧 Family today</h2>
            <Link className="pill" to="/check-in">
              Check in
            </Link>
          </div>
          {dependents.map((m) => (
            <div key={m.id} className="leader-row">
              <div className="leader-name">
                {m.fullName}
                <div className="muted" style={{ fontWeight: 400 }}>
                  {m.prayers.length}/5 prayers
                </div>
              </div>
              <span className={`pill ${m.hasFace ? '' : 'warn'}`}>
                {m.hasFace ? 'face ✓' : 'no face'}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <h2 className="card-title">Your breakdown</h2>
        <p className="muted" style={{ marginBottom: 12 }}>All-time attendance per prayer</p>
        {PRAYERS.map((p) => {
          const count = breakdown?.[p.key] || 0;
          const max = breakdown ? Math.max(1, ...Object.values(breakdown)) : 1;
          return (
            <div key={p.key} style={{ marginBottom: 10 }}>
              <div className="row-between" style={{ fontSize: '0.82rem', marginBottom: 4 }}>
                <span>{p.label}</span>
                <span className="muted">{count}</span>
              </div>
              <div style={{ background: 'var(--slate-100)', borderRadius: 999, height: 8 }}>
                <div
                  style={{
                    width: `${(count / max) * 100}%`,
                    background: 'var(--teal-500)',
                    height: '100%',
                    borderRadius: 999,
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>

      <div className="card">
        <div className="row-between" style={{ marginBottom: 12 }}>
          <h2 className="card-title">📖 Quran & 🏅 merits</h2>
          <Link className="pill" to="/quran">
            Log activity
          </Link>
        </div>
        {merits?.merits?.length > 0 ? (
          <>
            <p className="muted" style={{ marginBottom: 6 }}>Recent merits</p>
            {merits.merits.slice(0, 3).map((m) => (
              <div key={m.id} className="leader-row">
                <div className="leader-name">
                  {m.reason || 'Good behaviour'}
                  <div className="muted" style={{ fontWeight: 400 }}>
                    {m.awarded_by_name ? `by ${m.awarded_by_name}` : 'awarded'}
                  </div>
                </div>
                <div className="leader-score">+{m.points}</div>
              </div>
            ))}
          </>
        ) : (
          <p className="muted">
            No Quran activity or merits yet.{' '}
            <Link to="/quran"><strong>Log your first recitation →</strong></Link>
          </p>
        )}
      </div>
    </div>
  );
}