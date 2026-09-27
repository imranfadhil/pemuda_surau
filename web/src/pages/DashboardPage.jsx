import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.jsx';
import { PRAYERS, PRAYER_LABELS } from '../lib/constants.js';

const RANGES = [
  { label: 'All time', days: 0 },
  { label: '7 days', days: 7 },
  { label: '30 days', days: 30 },
];

export default function DashboardPage() {
  const { user } = useAuth();
  const [stats, setStats] = useState(null);
  const [leaders, setLeaders] = useState([]);
  const [range, setRange] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loginUrl, setLoginUrl] = useState('');

  useEffect(() => {
    // Auto-generate the login link from the current URL so the QR always
    // points at wherever this app is being served from.
    setLoginUrl(`${window.location.origin}/login`);
  }, []);

  useEffect(() => {
    api.stats().then(setStats).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    api
      .leaderboard(range)
      .then((data) => setLeaders(data.leaderboard))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [range]);

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

      <div className="card qr-card">
        <div className="qr-box">
          {loginUrl && (
            <QRCodeSVG value={loginUrl} size={148} level="M" marginSize={1} />
          )}
        </div>
        <div className="qr-info">
          <h2 className="card-title">📱 Scan to log in</h2>
          <p className="muted" style={{ margin: '6px 0 12px' }}>
            Point your phone camera at the code to open the login page and check in.
          </p>
          {user ? (
            <Link className="btn btn-sm" to="/check-in">
              Go to check-in
            </Link>
          ) : (
            <Link className="btn btn-sm" to="/login">
              Log in
            </Link>
          )}
        </div>
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

      <div className="card">
        <div className="row-between" style={{ marginBottom: 12 }}>
          <h2 className="card-title">🏆 Leaderboard</h2>
        </div>
        <div className="tab-row">
          {RANGES.map((r) => (
            <button
              key={r.days}
              className={`tab ${range === r.days ? 'active' : ''}`}
              onClick={() => setRange(r.days)}
            >
              {r.label}
            </button>
          ))}
        </div>

        {loading ? (
          <p className="muted">Loading…</p>
        ) : leaders.length === 0 ? (
          <p className="muted">No attendance recorded yet.</p>
        ) : (
          leaders.map((row) => {
            const medal = row.rank === 1 ? 'gold' : row.rank === 2 ? 'silver' : row.rank === 3 ? 'bronze' : '';
            const isMe = row.id === user?.id;
            return (
              <div key={row.id} className="leader-row">
                <div className={`rank-badge ${medal}`}>{row.rank}</div>
                <div className="leader-name">
                  {row.full_name} {isMe && <span className="pill">You</span>}
                  <div className="muted" style={{ fontWeight: 400 }}>
                    {row.days_attended} days
                    {row.guardian_name ? ` · child of ${row.guardian_name}` : ''}
                  </div>
                </div>
                <div className="leader-score">{row.total}</div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}