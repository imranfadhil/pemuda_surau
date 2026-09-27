import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { PRAYER_LABELS, formatDate, SURAU, CATEGORIES, badgeFor, ROLE_LABELS } from '../lib/constants.js';

function QuranCard() {
  const [data, setData] = useState({ recitation: 0, memorization: 0, logs: [] });
  const [form, setForm] = useState({ kind: 'recitation', surah: '', juz: '', pages: '', note: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function load() {
    api.myQuran().then(setData).catch((e) => setError(e.message));
  }

  useEffect(load, []);

  async function submit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api.logQuran({
        kind: form.kind,
        surah: form.surah || null,
        juz: form.juz ? Number(form.juz) : null,
        pages: form.pages ? Number(form.pages) : null,
        note: form.note || null,
      });
      setForm({ kind: form.kind, surah: '', juz: '', pages: '', note: '' });
      load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id) {
    setError('');
    try {
      await api.deleteQuran(id);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="card">
      <h2 className="card-title">📖 Quran activity</h2>
      <p className="muted" style={{ marginBottom: 12 }}>
        Log your recitation and memorization to earn badges and climb the leaderboard.
      </p>

      {error && <div className="alert alert-error">{error}</div>}

      <div className="stat-grid" style={{ marginBottom: 12 }}>
        <div className="stat">
          <div className="value">{data.recitation}</div>
          <div className="label">📖 Recitations</div>
        </div>
        <div className="stat">
          <div className="value">{data.memorization}</div>
          <div className="label">🧠 Memorizations</div>
        </div>
      </div>

      <form onSubmit={submit}>
        <div className="row">
          <div className="field" style={{ flex: 1 }}>
            <label>Type</label>
            <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              <option value="recitation">Recitation</option>
              <option value="memorization">Memorization</option>
            </select>
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>Surah (optional)</label>
            <input
              type="text"
              placeholder="e.g. Al-Kahf"
              value={form.surah}
              onChange={(e) => setForm({ ...form, surah: e.target.value })}
            />
          </div>
        </div>
        <div className="row">
          <div className="field" style={{ flex: 1 }}>
            <label>Juz (optional)</label>
            <input
              type="number"
              min="1"
              max="30"
              value={form.juz}
              onChange={(e) => setForm({ ...form, juz: e.target.value })}
            />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>Pages (optional)</label>
            <input
              type="number"
              min="1"
              value={form.pages}
              onChange={(e) => setForm({ ...form, pages: e.target.value })}
            />
          </div>
        </div>
        <div className="field">
          <label>Note (optional)</label>
          <input
            type="text"
            placeholder="Anything to remember"
            value={form.note}
            onChange={(e) => setForm({ ...form, note: e.target.value })}
          />
        </div>
        <button className="btn btn-block" disabled={busy}>
          {busy ? 'Saving…' : 'Log activity'}
        </button>
      </form>

      {data.logs.length > 0 && (
        <div style={{ marginTop: 16 }}>
          {data.logs.slice(0, 10).map((log) => (
            <div key={log.id} className="leader-row">
              <div className="rank-badge" style={{ background: 'var(--teal-100)', color: 'var(--teal-900)' }}>
                {log.kind === 'recitation' ? '📖' : '🧠'}
              </div>
              <div className="leader-name">
                {log.kind === 'recitation' ? 'Recitation' : 'Memorization'}
                <div className="muted" style={{ fontWeight: 400 }}>
                  {[log.surah, log.juz ? `Juz ${log.juz}` : null, log.pages ? `${log.pages} pages` : null]
                    .filter(Boolean)
                    .join(' · ') || '—'}
                  {' · '}
                  {formatDate(log.logged_date)}
                </div>
              </div>
              <button className="btn btn-sm btn-secondary" onClick={() => remove(log.id)}>
                Delete
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function BadgesCard() {
  const [leaders, setLeaders] = useState([]);
  const { user } = useAuth();

  useEffect(() => {
    api
      .leaderboard('all', 'overall')
      .then((d) => setLeaders(d.leaderboard))
      .catch(() => {});
  }, []);

  const me = leaders.find((r) => r.id === user?.id);

  return (
    <div className="card">
      <h2 className="card-title">🎖️ Your badges</h2>
      <p className="muted" style={{ marginBottom: 12 }}>
        Earned from your all-time activity in each category.
      </p>
      {!me ? (
        <p className="muted">No activity yet — start checking in and logging Quran activity.</p>
      ) : (
        CATEGORIES.filter((c) => c.key !== 'overall').map((c) => {
          const score = me[c.key] ?? 0;
          const badge = badgeFor(score);
          return (
            <div key={c.key} className="leader-row">
              <div className="rank-badge" style={{ background: 'var(--slate-100)', color: 'var(--slate-800)' }}>
                {c.icon}
              </div>
              <div className="leader-name">
                {c.label}
                <div className="muted" style={{ fontWeight: 400 }}>
                  {score} {c.unit}
                </div>
              </div>
              {badge ? (
                <span className="badge">
                  {badge.icon} {badge.label}
                </span>
              ) : (
                <span className="pill warn">No badge yet</span>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

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
        Telegram is the main way to sign in — your login codes arrive instantly and free, with no
        SMS charges.
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
  const [dependents, setDependents] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api.familyAttendance(60), api.listDependents()])
      .then(([data, deps]) => {
        setHistory(data.attendance);
        setDependents(deps.dependents);
      })
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
          <span className="pill">{ROLE_LABELS[user?.role] || 'Member'}</span>
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

      <div className="card">
        <div className="row-between">
          <h2 className="card-title">👨‍👩‍👧 Family</h2>
          <Link className="pill" to="/family">
            Manage
          </Link>
        </div>
        <p className="muted" style={{ margin: '6px 0 12px' }}>
          Add your children so you can check them in for prayers — they don't need their own phone.
        </p>
        {dependents.length === 0 ? (
          <p className="muted">No dependents added yet.</p>
        ) : (
          dependents.map((dep) => (
            <div key={dep.id} className="leader-row">
              <div className="leader-name">
                {dep.fullName}
                <div className="muted" style={{ fontWeight: 400 }}>
                  {dep.age ? `${dep.age} years` : 'Age not set'}
                </div>
              </div>
              <span className={`pill ${dep.hasFace ? '' : 'warn'}`}>
                {dep.hasFace ? 'face ✓' : 'no face'}
              </span>
            </div>
          ))
        )}
      </div>

      <TelegramCard />

      <BadgesCard />

      <QuranCard />

      <div className="card">
        <h2 className="card-title">🕌 {SURAU.name}</h2>
        <p className="muted" style={{ margin: '6px 0' }}>{SURAU.address}</p>
        <a href={SURAU.mapsUrl} target="_blank" rel="noreferrer">
          {SURAU.latitude}° N, {SURAU.longitude}° E — Open in Maps
        </a>
      </div>

      <div className="card">
        <h2 className="card-title">Attendance history</h2>
        <p className="muted" style={{ marginBottom: 12 }}>You and your dependents — most recent 60 records</p>
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
                  {row.guardian_id ? `${row.full_name} · ` : ''}
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