import { useEffect, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { PRAYERS, CATEGORIES, PERIODS, badgeFor } from '../lib/constants.js';

// Distinct, readable teals for the stacked prayer segments.
const PRAYER_COLORS = {
  subuh: '#0f766e',
  zuhur: '#0d9488',
  asar: '#14b8a6',
  maghrib: '#2dd4bf',
  isyak: '#5eead4',
};

export default function DashboardPage() {
  const { user } = useAuth();
  const [stats, setStats] = useState(null);
  const [weekly, setWeekly] = useState([]);
  const [leaders, setLeaders] = useState([]);
  const [period, setPeriod] = useState('month');
  const [category, setCategory] = useState('overall');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.stats().then(setStats).catch(() => {});
    api.weekly().then((d) => setWeekly(d.days)).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    api
      .leaderboard(period, category)
      .then((data) => setLeaders(data.leaderboard))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [period, category]);

  const activeCategory = CATEGORIES.find((c) => c.key === category) || CATEGORIES[0];

  const todayChart = PRAYERS.map((p) => ({
    name: p.label,
    count: stats?.todayByPrayer?.[p.key] || 0,
  }));

  // Weekly activity across ALL categories — prayer attendance (stacked by
  // prayer), Quran recitation, Quran memorization and merits. Each category is
  // normalised against its OWN weekly peak so the smaller ones stay visible.
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

  return (
    <div>
      <h1 className="page-title">Dashboard & ranking</h1>
      <p className="page-sub">Prayer, Quran and good deeds across the surau.</p>

      {/* ---- Stats: all categories, not just prayer ---- */}
      <div className="stat-grid">
        <div className="stat">
          <div className="value">{stats?.activeMembers ?? '–'}</div>
          <div className="label">Active members</div>
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
          <div className="label">🏅 Merits awarded</div>
        </div>
      </div>

      {/* ---- Weekly activity: prayer + Quran + merits ---- */}
      <div className="card">
        <div className="row-between" style={{ marginBottom: 8 }}>
          <h2 className="card-title">Weekly activity</h2>
          <span className="muted">Last 7 days · % of each category's weekly peak</span>
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
              <Bar dataKey="subuh" name="Subuh" stackId="att" fill={PRAYER_COLORS.subuh} />
              <Bar dataKey="zuhur" name="Zuhur" stackId="att" fill={PRAYER_COLORS.zuhur} />
              <Bar dataKey="asar" name="Asar" stackId="att" fill={PRAYER_COLORS.asar} />
              <Bar dataKey="maghrib" name="Maghrib" stackId="att" fill={PRAYER_COLORS.maghrib} />
              <Bar dataKey="isyak" name="Isyak" stackId="att" fill={PRAYER_COLORS.isyak} radius={[4, 4, 0, 0]} />
              <Bar dataKey="recitation" name="📖 Recitation" fill="#f59e0b" radius={[4, 4, 0, 0]} />
              <Bar dataKey="memorization" name="🧠 Memorization" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
              <Bar dataKey="merits" name="🏅 Merits" fill="#ef4444" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="card">
        <h2 className="card-title">Today by prayer</h2>
        <p className="muted" style={{ marginBottom: 8 }}>Number of members who prayed in congregation today</p>
        <div style={{ width: '100%', height: 200 }}>
          <ResponsiveContainer>
            <BarChart data={todayChart}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
              <XAxis dataKey="name" tick={{ fontSize: 12 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
              <Tooltip />
              <Bar dataKey="count" fill="#0d9488" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ---- Leaderboard (bottom, scrollable so it doesn't push content away) ---- */}
      <div className="card">
        <div className="row-between" style={{ marginBottom: 12 }}>
          <h2 className="card-title">🏆 Leaderboard</h2>
          <span className="pill">
            {activeCategory.icon} {activeCategory.label}
          </span>
        </div>

        <div className="tab-row">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              className={`tab ${period === p.key ? 'active' : ''}`}
              onClick={() => setPeriod(p.key)}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="tab-row" style={{ marginTop: 8 }}>
          {CATEGORIES.map((c) => (
            <button
              key={c.key}
              className={`tab ${category === c.key ? 'active' : ''}`}
              onClick={() => setCategory(c.key)}
            >
              {c.icon} {c.label}
            </button>
          ))}
        </div>

        {loading ? (
          <p className="muted">Loading…</p>
        ) : leaders.length === 0 ? (
          <p className="muted">No activity recorded yet.</p>
        ) : (
          <div className="leader-scroll">
            {leaders.map((row) => {
              const medal = row.rank === 1 ? 'gold' : row.rank === 2 ? 'silver' : row.rank === 3 ? 'bronze' : '';
              const isMe = row.id === user?.id;
              const score = row[category] ?? 0;
              const badge = badgeFor(score);
              return (
                <div key={row.id} className="leader-row">
                  <div className={`rank-badge ${medal}`}>{row.rank}</div>
                  <div className="leader-name">
                    {row.full_name} {isMe && <span className="pill">You</span>}
                    {badge && (
                      <span className="badge" title={`${badge.label} tier`}>
                        {badge.icon} {badge.label}
                      </span>
                    )}
                    <div className="muted" style={{ fontWeight: 400 }}>
                      {row.days_attended} days
                      {row.guardian_name ? ` · child of ${row.guardian_name}` : ''}
                    </div>
                  </div>
                  <div className="leader-score">
                    {score}
                    <div className="muted" style={{ fontWeight: 400, fontSize: '0.68rem' }}>
                      {activeCategory.unit}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}