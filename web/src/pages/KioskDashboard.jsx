import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { api } from '../lib/api.js';
import { CATEGORIES, badgeFor, SURAU, COMMUNITY } from '../lib/constants.js';
import { duplicateNameKeys, disambiguatorFor } from '../lib/members.js';
import { useIsMobile } from '../lib/device.js';

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

function LeaderColumn({ title, rows, category, duplicates }) {
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
          const disambig = disambiguatorFor(row, duplicates);
          return (
            <div key={row.id} className="kiosk-leader-row">
              <div className={`rank-badge ${medal}`}>{row.rank}</div>
              <div className="kiosk-leader-name">
                {row.full_name}
                {disambig && <span className="kiosk-leader-disambig"> · {disambig}</span>}
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
 * Shown instead of the wall display on phones / small screens, where the
 * non-scrolling kiosk layout is unusable. On the public landing page (`/`) we
 * render the mobile-friendly viewer dashboard; on `/display` we nudge them to
 * log in.
 */
function MobileNotice() {
  return (
    <div className="kiosk-mobile">
      <img className="brand-logo" src="/logo.png" alt="" />
      <h1 className="kiosk-title" style={{ fontSize: '1.4rem' }}>
        Pemuda {SURAU.name}
      </h1>
      <p className="kiosk-sub" style={{ marginBottom: 24 }}>
        The wall display is meant for a large landscape screen.
      </p>
      <div className="card" style={{ textAlign: 'center', maxWidth: 360 }}>
        <p style={{ marginTop: 0 }}>
          Log in to check in for prayers and track your progress.
        </p>
        <Link
          className="btn btn-block"
          style={{ display: 'block', textAlign: 'center' }}
          to="/login"
        >
          Log in
        </Link>
        <a
          className="community-text-link"
          style={{ display: 'block', marginTop: 12 }}
          href={COMMUNITY.whatsappUrl}
          target="_blank"
          rel="noreferrer"
        >
          💬 Join our {COMMUNITY.label} for program updates
        </a>
      </div>
    </div>
  );
}

/**
 * Mobile-friendly version of the public landing view. Same read-only data as the
 * wall display (no login QR, no rotation), but laid out as a normal scrolling
 * page so it works on a phone.
 */
function MobileDashboard({ stats, weeklyChart, monthly, yearly, category, catIndex, onSelectCat, duplicates }) {
  const dateStr = new Date().toLocaleDateString(undefined, {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

  return (
    <div className="mobile-dashboard">
      <header className="mobile-dash-head">
        <img className="brand-logo" src="/logo.png" alt="" />
        <div className="mobile-dash-headtext">
          <div className="mobile-dash-title">Pemuda {SURAU.name}</div>
          <div className="mobile-dash-sub">{dateStr}</div>
        </div>
      </header>

      {/* Primary call to action, above the fold. */}
      <div className="mobile-cta">
        <div className="mobile-cta-text">
          <strong>Log in to check in for prayers</strong>
          <span>Track your prayers, Quran and merits — and climb the leaderboard.</span>
        </div>
        <Link className="btn mobile-cta-btn" to="/login">
          Log in
        </Link>
      </div>

      <div className="stat-grid">
        <div className="stat">
          <div className="value">{stats?.activeMembers ?? '–'}</div>
          <div className="label">Members</div>
        </div>
        <div className="stat">
          <div className="value">{stats?.totalCheckIns ?? '–'}</div>
          <div className="label">🕌 Check-ins</div>
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

      <div className="card">
        <h2 className="card-title">🏆 Leaderboard</h2>
        <div className="category-pills">
          {CATEGORIES.map((c, i) => (
            <button
              key={c.key}
              type="button"
              className={`pill ${i === catIndex ? 'active' : ''}`}
              onClick={() => onSelectCat(i)}
            >
              {c.icon} {c.label}
            </button>
          ))}
        </div>
        <div className="mobile-leader-grid">
          <LeaderColumn title="This month" rows={monthly} category={category} duplicates={duplicates} />
          <LeaderColumn title="This year" rows={yearly} category={category} duplicates={duplicates} />
        </div>
      </div>

      <div className="card">
        <div className="row-between" style={{ marginBottom: 8 }}>
          <h2 className="card-title">Weekly activity</h2>
        </div>
        <div style={{ width: '100%', height: 240 }}>
          <ResponsiveContainer>
            <BarChart data={weeklyChart} barGap={2} barCategoryGap="22%">
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
              <XAxis dataKey="day" tick={{ fontSize: 12 }} />
              <YAxis
                allowDecimals={false}
                tick={{ fontSize: 12 }}
                domain={[0, 100]}
                ticks={[0, 25, 50, 75, 100]}
                tickFormatter={(v) => `${v}%`}
              />
              <Tooltip formatter={(v) => `${v}%`} />
              <Legend wrapperStyle={{ fontSize: '0.75rem' }} />
              <Bar dataKey="subuh" name="Subuh" stackId="att" fill="#0f766e" />
              <Bar dataKey="zuhur" name="Zuhur" stackId="att" fill="#0d9488" />
              <Bar dataKey="asar" name="Asar" stackId="att" fill="#14b8a6" />
              <Bar dataKey="maghrib" name="Maghrib" stackId="att" fill="#2dd4bf" />
              <Bar dataKey="isyak" name="Isyak" stackId="att" fill="#5eead4" radius={[4, 4, 0, 0]} />
              <Bar dataKey="recitation" name="📖 Recitation" fill="#f59e0b" radius={[4, 4, 0, 0]} />
              <Bar dataKey="memorization" name="🧠 Memorization" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
              <Bar dataKey="merits" name="🏅 Merits" fill="#ef4444" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Repeated at the end, for anyone who scrolled all the way down. */}
      <div className="card mobile-cta-card">
        <h2 className="card-title">Ready to join in?</h2>
        <p className="muted" style={{ margin: '6px 0 14px' }}>
          Log in to check in for prayers and track your own progress.
        </p>
        <Link className="btn btn-block" style={{ display: 'block', textAlign: 'center' }} to="/login">
          Log in
        </Link>
      </div>

      <div className="card" style={{ textAlign: 'center' }}>
        <h2 className="card-title">💬 {COMMUNITY.name}</h2>
        <p className="muted" style={{ margin: '6px 0 12px', fontSize: '0.85rem' }}>
          {COMMUNITY.description}
        </p>
        <a
          className="btn community-btn"
          style={{ display: 'block', textAlign: 'center' }}
          href={COMMUNITY.whatsappUrl}
          target="_blank"
          rel="noreferrer"
        >
          💬 Join the {COMMUNITY.label}
        </a>
      </div>
    </div>
  );
}

/**
 * Full-screen, non-scrolling dashboard for the surau's wall monitor.
 * Shown on the public landing page (and at /display). No interaction is
 * required: the leaderboard category rotates automatically and the login QR
 * is always visible.
 *
 * On phones the wall layout is unusable, so on the public landing page we render
 * the mobile-friendly {@link MobileDashboard}, and at `/display` we show
 * {@link MobileNotice}.
 */
export default function KioskDashboard({ publicHome = false }) {
  const isMobile = useIsMobile();
  const now = useClock();
  const [stats, setStats] = useState(null);
  const [weekly, setWeekly] = useState([]);
  const [monthly, setMonthly] = useState([]);
  const [yearly, setYearly] = useState([]);
  const [catIndex, setCatIndex] = useState(0);
  const [loginUrl, setLoginUrl] = useState('');

  const category = CATEGORIES[catIndex];

  // Names are not unique, so tell same-named members apart by phone last-4 —
  // but only when a collision actually exists in the displayed boards.
  const duplicates = duplicateNameKeys([...monthly, ...yearly]);

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

  // Small screens can't render the non-scrolling wall layout usefully.
  if (isMobile) {
    if (!publicHome) return <MobileNotice />;
    return (
      <MobileDashboard
        stats={stats}
        weeklyChart={weeklyChart}
        monthly={monthly}
        yearly={yearly}
        category={category}
        catIndex={catIndex}
        onSelectCat={setCatIndex}
        duplicates={duplicates}
      />
    );
  }

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
              <LeaderColumn title="This month" rows={monthly} category={category} duplicates={duplicates} />
              <LeaderColumn title="This year" rows={yearly} category={category} duplicates={duplicates} />
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

          {/* Community group link, tucked under the stats in the right column. */}
          <div className="card kiosk-community">
            <div className="qr-box kiosk-community-qr">
              <QRCodeSVG value={COMMUNITY.whatsappUrl} size={72} level="L" marginSize={0} />
            </div>
            <div className="kiosk-community-text">
              <div className="kiosk-community-title">💬 Join our {COMMUNITY.label}</div>
              <div className="kiosk-community-sub">Program updates &amp; announcements</div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
