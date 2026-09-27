import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { PRAYERS } from '../lib/constants.js';

export default function HomePage() {
  const { user } = useAuth();
  const [today, setToday] = useState([]);
  const [breakdown, setBreakdown] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api.myToday(), api.myBreakdown()])
      .then(([t, b]) => {
        setToday(t.prayers);
        setBreakdown(b.breakdown);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const total = breakdown ? Object.values(breakdown).reduce((a, b) => a + b, 0) : 0;

  return (
    <div>
      <h1 className="page-title">Assalamualaikum, {user?.fullName?.split(' ')[0] || 'friend'} 👋</h1>
      <p className="page-sub">Here is your prayer attendance today.</p>

      {!user?.hasFace && (
        <div className="alert alert-info">
          You haven't enrolled your face yet.{' '}
          <Link to="/register"><strong>Complete registration →</strong></Link>
        </div>
      )}

      <div className="stat-grid">
        <div className="stat">
          <div className="value">{loading ? '–' : today.length}/5</div>
          <div className="label">Today</div>
        </div>
        <div className="stat">
          <div className="value">{loading ? '–' : total}</div>
          <div className="label">Total check-ins</div>
        </div>
      </div>

      <div className="card">
        <div className="row-between" style={{ marginBottom: 14 }}>
          <h2 className="card-title">Today's prayers</h2>
          <Link className="pill" to="/check-in">
            Check in
          </Link>
        </div>
        <div className="prayer-grid">
          {PRAYERS.map((p) => {
            const done = today.includes(p.key);
            return (
              <div key={p.key} className={`prayer-tile ${done ? 'done' : ''}`}>
                <div className="check">{done ? '✅' : '⭕'}</div>
                <div>{p.label}</div>
              </div>
            );
          })}
        </div>
      </div>

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
    </div>
  );
}