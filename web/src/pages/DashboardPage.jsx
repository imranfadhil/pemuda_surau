import { useEffect, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { PRAYERS, CATEGORIES, PERIODS, badgeFor } from '../lib/constants.js';

export default function DashboardPage() {
  const { user } = useAuth();
  const [stats, setStats] = useState(null);
  const [leaders, setLeaders] = useState([]);
  const [period, setPeriod] = useState('month');
  const [category, setCategory] = useState('overall');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.stats().then(setStats).catch(() => {});
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

  const chartData = (stats?.last7Days || []).map((row) => ({
    date: new Date(row.attendance_date).toLocaleDateString(undefined, { weekday: 'short' }),
    count: row.count,
  }));

  const todayChart = PRAYERS.map((p) => ({
    name: p.label,
    count: stats?.todayByPrayer?.[p.key] || 0,
  }));

  return (
    <div>
      <h1 className="page-title">Dashboard & ranking</h1>
      <p className="page-sub">Attendance statistics across the surau.</p>

      {/* ---- Leaderboard (top) ---- */}
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
          leaders.map((row) => {
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
          })
        )}
      </div>

      <div className="stat-grid">
        <div className="stat">
          <div className="value">{stats?.activeMembers ?? '–'}</div>
          <div className="label">Active members</div>
        </div>
        <div className="stat">
          <div className="value">{stats?.totalCheckIns ?? '–'}</div>
          <div className="label">Total check-ins</div>
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

      <div className="card">
        <h2 className="card-title">Last 7 days</h2>
        <div style={{ width: '100%', height: 200, marginTop: 8 }}>
          <ResponsiveContainer>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
              <XAxis dataKey="date" tick={{ fontSize: 12 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
              <Tooltip />
              <Bar dataKey="count" fill="#14b8a6" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}