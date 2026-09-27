import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { PRAYER_LABELS, formatDate } from '../lib/constants.js';

function TelegramCard() {
  const { user, refreshUser } = useAuth();
  const [link, setLink] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function generateLink() {
    setError('');
    setBusy(true);
    try {
      const res = await api.telegramLinkToken();
      setLink(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function unlink() {
    setError('');
    setBusy(true);
    try {
      await api.telegramUnlink();
      setLink(null);
      await refreshUser();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <h2 className="card-title">Telegram login</h2>
      <p className="muted" style={{ marginBottom: 12 }}>
        Link Telegram to receive your login codes instantly — free, no SMS charges.
      </p>

      {error && <div className="alert alert-error">{error}</div>}

      {user?.telegramLinked ? (
        <>
          <div className="alert alert-success">
            ✅ Linked{user.telegramUsername ? ` as @${user.telegramUsername}` : ''}
          </div>
          <button className="btn btn-secondary btn-sm" disabled={busy} onClick={unlink}>
            Unlink Telegram
          </button>
        </>
      ) : link ? (
        <>
          <div className="alert alert-info">
            Open Telegram and tap the link below, then press <strong>Start</strong>.
          </div>
          <a
            className="btn btn-block"
            style={{ display: 'block', textAlign: 'center' }}
            href={link.linkUrl}
            target="_blank"
            rel="noreferrer"
          >
            Open Telegram
          </a>
          <p className="muted" style={{ marginTop: 10, wordBreak: 'break-all' }}>
            Or send <code>/start {link.token}</code> to @{link.botUsername}
          </p>
          <button
            className="btn btn-secondary btn-sm"
            style={{ marginTop: 10 }}
            onClick={refreshUser}
          >
            I've linked it — refresh
          </button>
        </>
      ) : (
        <button className="btn btn-block" disabled={busy} onClick={generateLink}>
          {busy ? 'Generating…' : 'Link Telegram'}
        </button>
      )}
    </div>
  );
}

export default function ProfilePage() {
  const { user, logout } = useAuth();
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .myAttendance(60)
      .then((data) => setHistory(data.attendance))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <h1 className="page-title">Profile</h1>
      <p className="page-sub">Your account and attendance history.</p>

      <div className="card">
        <div className="row-between">
          <div>
            <strong style={{ fontSize: '1.1rem' }}>{user?.fullName}</strong>
            <div className="muted">{user?.phone}</div>
          </div>
          <span className="pill">{user?.role === 'admin' ? 'Admin' : 'Member'}</span>
        </div>
        <div className="row" style={{ marginTop: 14, gap: 8 }}>
          <span className={`pill ${user?.hasFace ? '' : 'warn'}`}>
            {user?.hasFace ? '✅ Face enrolled' : '⚠️ No face enrolled'}
          </span>
        </div>
        <div className="row" style={{ marginTop: 16 }}>
          <Link className="btn btn-sm btn-secondary" to="/register">
            {user?.hasFace ? 'Re-enroll face' : 'Enroll face'}
          </Link>
          <button className="btn btn-sm btn-danger" onClick={logout}>
            Log out
          </button>
        </div>
      </div>

      <TelegramCard />

      <div className="card">
        <h2 className="card-title">Attendance history</h2>
        <p className="muted" style={{ marginBottom: 12 }}>Most recent 60 records</p>
        {loading ? (
          <p className="muted">Loading…</p>
        ) : history.length === 0 ? (
          <p className="muted">No attendance yet. Start checking in!</p>
        ) : (
          history.map((row) => (
            <div key={row.id} className="leader-row">
              <div className="rank-badge" style={{ background: 'var(--teal-100)', color: 'var(--teal-900)' }}>
                {PRAYER_LABELS[row.prayer]?.[0]}
              </div>
              <div className="leader-name">
                {PRAYER_LABELS[row.prayer]}
                <div className="muted" style={{ fontWeight: 400 }}>
                  {formatDate(row.attendance_date)}
                </div>
              </div>
              <span className="pill">{row.method}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}