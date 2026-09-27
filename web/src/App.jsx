import { Routes, Route, Navigate, NavLink, useLocation } from 'react-router-dom';
import { useAuth } from './lib/auth.jsx';
import LoginPage from './pages/LoginPage.jsx';
import RegisterPage from './pages/RegisterPage.jsx';
import HomePage from './pages/HomePage.jsx';
import CheckInPage from './pages/CheckInPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import ProgramsPage from './pages/ProgramsPage.jsx';
import ProfilePage from './pages/ProfilePage.jsx';
import AdminPage from './pages/AdminPage.jsx';

function BottomNav() {
  const { user } = useAuth();
  const items = [
    { to: '/', label: 'Home', icon: '🏠' },
    { to: '/check-in', label: 'Check-in', icon: '🕌' },
    { to: '/dashboard', label: 'Ranking', icon: '🏆' },
    { to: '/programs', label: 'Programs', icon: '📅' },
    { to: '/profile', label: 'Profile', icon: '👤' },
  ];
  if (user?.role === 'admin') {
    items.push({ to: '/admin', label: 'Admin', icon: '⚙️' });
  }
  return (
    <nav className="bottom-nav">
      {items.map((item) => (
        <NavLink key={item.to} to={item.to} end={item.to === '/'}>
          <span className="nav-icon">{item.icon}</span>
          {item.label}
        </NavLink>
      ))}
    </nav>
  );
}

function TopBar() {
  const { user, logout } = useAuth();
  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-logo">🕌</span>
        <span>Pemuda Surau</span>
      </div>
      <div className="topbar-user">
        <span>{user?.fullName}</span>
        <button className="btn-ghost" onClick={logout}>
          Log out
        </button>
      </div>
    </header>
  );
}

function Protected({ children }) {
  const { token, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="loading-screen">Loading…</div>;
  if (!token) return <Navigate to="/login" state={{ from: location }} replace />;
  return children;
}

function AdminOnly({ children }) {
  const { user } = useAuth();
  if (user?.role !== 'admin') return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  const { token, loading } = useAuth();

  if (loading) return <div className="loading-screen">Loading…</div>;

  return (
    <Routes>
      <Route path="/login" element={token ? <Navigate to="/" replace /> : <LoginPage />} />
      <Route
        path="/register"
        element={
          <Protected>
            <RegisterPage />
          </Protected>
        }
      />
      <Route
        path="/*"
        element={
          <Protected>
            <div className="app-shell">
              <TopBar />
              <main className="main">
                <Routes>
                  <Route path="/" element={<HomePage />} />
                  <Route path="/check-in" element={<CheckInPage />} />
                  <Route path="/dashboard" element={<DashboardPage />} />
                  <Route path="/programs" element={<ProgramsPage />} />
                  <Route path="/profile" element={<ProfilePage />} />
                  <Route
                    path="/admin"
                    element={
                      <AdminOnly>
                        <AdminPage />
                      </AdminOnly>
                    }
                  />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </main>
              <BottomNav />
            </div>
          </Protected>
        }
      />
    </Routes>
  );
}
