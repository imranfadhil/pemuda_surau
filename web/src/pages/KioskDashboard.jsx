import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { api } from '../lib/api.js';
import { CATEGORIES, badgeFor, SURAU } from '../lib/constants.js';

// How long each leaderboard category stays on screen before rotating.
const ROTATE_MS = 12000;
// How many members to show per column (keeps everything on one screen).
const TOP_N = 10;
// How often to refresh data from the API.
const REFRESH_MS = 60000;

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function LeaderColumn({ title, rows, category }) {
  return (
    <div className="kiosk-leader-col">
      <div className="kiosk-leader-head">{title}</div>
      {rows.length === 0 ? (
        <p className="muted" style={{ paddingTop: 12 }}>No activity yet.</p>
      ) : (
        rows.map((row) => {
          const medal = row.rank === 1 ? 'gold' : row.rank === 2 ? 'silver' : row.rank === 3 ? 'bronze' : '';
          const score = row[category.key] ?? 0;
          const badge = badgeFor(score);
          return (
            <div key={row.id} className="kiosk-leader-row">
              <div className={`rank-badge ${medal}`}>{row.rank}</div>
              <div className="kiosk-leader-name">
                {row.full_name}
                {badge && <span className="badge">{badge.icon}</span>}
              </div>
              <div className="kiosk-leader-score">{score}</div>
            </div>
          );
        })
      )}
    </div>
  );
}

/**
 * Full-screen, non-scrolling dashboard for the surau's wall monitor.
 * Shown on the public landing page (and at /display). No interaction is
 * required: the leaderboard category rotates automatically and the login QR
 * is always visible.
 */
export default function KioskDashboard() {
  const now = useClock();
  const [stats, setStats] = useState(null);
  const [weekly, setWeekly] = useState([]);
  const [monthly, setMonthly] = useState([]);
  const [yearly, setYearly] = useState([]);
  const [catIndex, setCatIndex] = useState(0);
  const [loginUrl, setLoginUrl] = useState('');

  const category = CATEGORIES[catIndex];

  useEffect(() => {
    // Auto-generate the login link from the current URL so the QR always
    // points at wherever this app is being served from.
    setLoginUrl(`${window.location.origin}/login`);
  }, []);

  // Overall stats, refreshed periodically.
  useEffect(() => {
    const load = () => api.stats().then(setStats).catch(() => {});
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, []);

  // Weekly activity breakdown (attendance, Quran, merits), refreshed periodically.
  useEffect(() => {
    const load = () => api.weekly().then((d) => setWeekly(d.days)).catch(() => {});
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => clearInterval(t);
  }, []);

  // Monthly + yearly leaderboards for the active category.
  useEffect(() => {
    let active = true;
    const load = () =>
      Promise.all([api.leaderboard('month', category.key), api.leaderboard('year', category.key)])
        .then(([m, y]) => {
          if (!active) return;
          setMonthly(m.leaderboard.slice(0, TOP_N));
          setYearly(y.leaderboard.slice(0, TOP_N));
        })
        .catch(() => {});
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, [category.key]);

  // Rotate through the categories so every board gets screen time.
  useEffect(() => {
    const t = setInterval(() => setCatIndex((i) => (i + 1) % CATEGORIES.length), ROTATE_MS);
    return () => clearInterval(t);
  }, []);

  // Normalise each category against its own weekly peak, so every category is
  // visible and comparable across the week (a single global max would make the
  // smaller categories invisible next to attendance). The attendance bar is
  // stacked by prayer; its segments sum to that day's attendance share.
  const weeklyChart = (() => {
    if (weekly.length === 0) return [];
    const maxOf = (fn) => Math.max(1, ...weekly.map(fn));
    const maxAtt = maxOf((r) => r.attendance);
    const maxRec = maxOf((r) => r.recitation);
    const maxMem = maxOf((r) => r.memorization);
    const maxMer = maxOf((r) => r.merits);
    const pct = (v, max) => Number(((v / max) * 100).toFixed(1));
    return weekly.map((row) => ({
      day: new Date(row.date).toLocaleDateString(undefined, { weekday: 'short' }),
      subuh: pct(row.prayers?.subuh || 0, maxAtt),
      zuhur: pct(row.prayers?.zuhur || 0, maxAtt),
      asar: pct(row.prayers?.asar || 0, maxAtt),
      maghrib: pct(row.prayers?.maghrib || 0, maxAtt),
      isyak: pct(row.prayers?.isyak || 0, maxAtt),
      recitation: pct(row.recitation, maxRec),
      memorization: pct(row.memorization, maxMem),
      merits: pct(row.merits, maxMer),
    }));
  })();

  const dateStr = now.toLocaleDateString(undefined, {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
  const timeStr = now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="kiosk">
      <header className="kiosk-header">
        <div className="kiosk-brand">
          <img className="brand-logo" src="/logo.png" alt="" />
          <div>
            <div className="kiosk-title">Pemuda {SURAU.name}</div>
            <div className="kiosk-sub">Prayer · Quran · Good Deeds</div>
          </div>
        </div>
        <div className="kiosk-clock">
          <div className="kiosk-time">{timeStr}</div>
          <div className="kiosk-date">{dateStr}</div>
        </div>
      </header>

      <div className="kiosk-body">
        <section className="kiosk-left">
          <div className="card kiosk-leaderboard">
            <div className="row-between">
              <h2 className="card-title">🏆 Leaderboard</h2>
              <div className="kiosk-cat">
                <span className="pill">
                  {category.icon} {category.label}
                </span>
                <div className="kiosk-dots">
                  {CATEGORIES.map((c, i) => (
                    <span key={c.key} className={`kiosk-dot ${i === catIndex ? 'active' : ''}`} />
                  ))}
                </div>
              </div>
            </div>
            <div className="kiosk-leader-grid">
              <LeaderColumn title="This month" rows={monthly} category={category} />
              <LeaderColumn title="This year" rows={yearly} category={category} />
            </div>
          </div>

          <div className="card kiosk-chart">
            <div className="row-between">
              <h2 className="card-title">Weekly activity</h2>
              <span className="muted">Last 7 days · % of each category's weekly peak</span>
            </div>
            <div className="kiosk-chart-body">
              <ResponsiveContainer>
                <BarChart data={weeklyChart} barGap={2} barCategoryGap="22%">
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                  <XAxis dataKey="day" tick={{ fontSize: 13 }} />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 12 }}
                    domain={[0, 100]}
                    ticks={[0, 25, 50, 75, 100]}
                    tickFormatter={(v) => `${v}%`}
                  />
                  <Tooltip formatter={(v) => `${v}%`} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  {/* Attendance, stacked by prayer (distinct, readable colours). */}
                  <Bar dataKey="subuh" name="Subuh" stackId="att" fill="#0f766e" />
                  <Bar dataKey="zuhur" name="Zuhur" stackId="att" fill="#0d9488" />
                  <Bar dataKey="asar" name="Asar" stackId="att" fill="#14b8a6" />
                  <Bar dataKey="maghrib" name="Maghrib" stackId="att" fill="#2dd4bf" />
                  <Bar dataKey="isyak" name="Isyak" stackId="att" fill="#5eead4" radius={[4, 4, 0, 0]} />
                  {/* Other categories, normalised to their own weekly peak. */}
                  <Bar dataKey="recitation" name="📖 Recitation" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="memorization" name="🧠 Memorization" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="merits" name="🏅 Merits" fill="#ef4444" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </section>

        <aside className="kiosk-right">
          <div className="card kiosk-qr">
            <h2 className="card-title">📱 Scan to log in</h2>
            <div className="qr-box kiosk-qr-box">
              {loginUrl && <QRCodeSVG value={loginUrl} size={220} level="M" marginSize={1} />}
            </div>
            <p className="muted kiosk-qr-hint">
              Open your phone camera and scan to check in for prayers.
            </p>
          </div>

          <div className="kiosk-stats">
            <div className="stat">
              <div className="value">{stats?.activeMembers ?? '–'}</div>
              <div className="label">Members</div>
            </div>
            <div className="stat">
              <div className="value">{stats?.totalCheckIns ?? '–'}</div>
              <div className="label">Check-ins</div>
            </div>
            <div className="stat">
              <div className="value">{stats?.quran?.recitation ?? '–'}</div>
              <div className="label">📖 Recitations</div>
            </div>
            <div className="stat">
              <div className="value">{stats?.quran?.memorization ?? '–'}</div>
              <div className="label">🧠 Memorizations</div>
            </div>
            <div className="stat">
              <div className="value">{stats?.totalMerits ?? '–'}</div>
              <div className="label">🏅 Merits</div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
