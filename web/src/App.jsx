import { Routes, Route, Navigate, NavLink, Link, useLocation } from 'react-router-dom';
import { useAuth } from './lib/auth.jsx';
import { can } from './lib/constants.js';
import LoginPage from './pages/LoginPage.jsx';
import RegisterPage from './pages/RegisterPage.jsx';
import HomePage from './pages/HomePage.jsx';
import CheckInPage from './pages/CheckInPage.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import KioskDashboard from './pages/KioskDashboard.jsx';
import ProgramsPage from './pages/ProgramsPage.jsx';
import ProfilePage from './pages/ProfilePage.jsx';
import DependentPage from './pages/DependentPage.jsx';
import AdminPage from './pages/AdminPage.jsx';

function BottomNav() {
  const { user } = useAuth();
  const items = user
    ? [
        { to: '/', label: 'Dashboard', icon: '🏆' },
        { to: '/home', label: 'Home', icon: '🏠' },
        { to: '/check-in', label: 'Check-in', icon: '🕌' },
        { to: '/programs', label: 'Programs', icon: '📅' },
        { to: '/profile', label: 'Profile', icon: '👤' },
      ]
    : [
        { to: '/', label: 'Dashboard', icon: '🏆' },
        { to: '/login', label: 'Log in', icon: '🔑' },
      ];
  if (user?.role === 'admin') {
    items.push({ to: '/admin', label: 'Admin', icon: '⚙️' });
  } else if (can(user, 'manageMerits') || can(user, 'manageQuran')) {
    items.push({ to: '/admin', label: 'Staff', icon: '🧑‍🏫' });
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
      <Link className="brand" to="/">
        <span className="brand-logo">🕌</span>
        <span>Pemuda Surau Al-Abqori</span>
      </Link>
      <div className="topbar-user">
        {user ? (
          <>
            <span>{user.fullName}</span>
            <button className="btn-ghost" onClick={logout}>
              Log out
            </button>
          </>
        ) : (
          <Link className="btn-ghost" to="/login">
            Log in
          </Link>
        )}
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
  if (!can(user, 'manageMerits') && !can(user, 'manageQuran') && user?.role !== 'admin') {
    return <Navigate to="/" replace />;
  }
  return children;
}

export default function App() {
  const { token, loading } = useAuth();

  if (loading) return <div className="loading-screen">Loading…</div>;

  return (
    <Routes>
      <Route path="/login" element={token ? <Navigate to="/" replace /> : <LoginPage />} />
      {/* Full-screen wall display — always public, no app chrome. */}
      <Route path="/display" element={<KioskDashboard />} />
      <Route
        path="/*"
        element={
          token ? (
            <div className="app-shell">
              <TopBar />
              <main className="main">
                <Routes>
                  <Route path="/" element={<DashboardPage />} />
                  <Route
                    path="/home"
                    element={
                      <Protected>
                        <HomePage />
                      </Protected>
                    }
                  />
                  <Route
                    path="/check-in"
                    element={
                      <Protected>
                        <CheckInPage />
                      </Protected>
                    }
                  />
                  <Route
                    path="/programs"
                    element={
                      <Protected>
                        <ProgramsPage />
                      </Protected>
                    }
                  />
                  <Route
                    path="/profile"
                    element={
                      <Protected>
                        <ProfilePage />
                      </Protected>
                    }
                  />
                  <Route
                    path="/register"
                    element={
                      <Protected>
                        <RegisterPage />
                      </Protected>
                    }
                  />
                  <Route
                    path="/family"
                    element={
                      <Protected>
                        <DependentPage />
                      </Protected>
                    }
                  />
                  <Route
                    path="/admin"
                    element={
                      <Protected>
                        <AdminOnly>
                          <AdminPage />
                        </AdminOnly>
                      </Protected>
                    }
                  />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </main>
              <BottomNav />
            </div>
          ) : (
            /* Logged out: the landing page is the non-scrolling wall display. */
            <Routes>
              <Route path="/" element={<KioskDashboard />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          )
        }
      />
    </Routes>
  );
}
