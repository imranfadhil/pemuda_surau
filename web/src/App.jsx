import { useEffect, useRef } from 'react';
import { Routes, Route, Navigate, NavLink, Link, useLocation } from 'react-router-dom';
import { useAuth } from './lib/auth.jsx';
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
import QuranPage from './pages/QuranPage.jsx';
import MeritsPage from './pages/MeritsPage.jsx';

function BottomNav() {
  const { user } = useAuth();
  const location = useLocation();
  const navRef = useRef(null);
  const items = user
    ? [
        { to: '/', label: 'Dashboard', icon: '🏆' },
        { to: '/home', label: 'Home', icon: '🏠' },
        { to: '/check-in', label: 'Check-in', icon: '🕌' },
        { to: '/quran', label: 'Quran', icon: '📖' },
        { to: '/merits', label: 'Merits', icon: '🏅' },
        { to: '/profile', label: 'Profile', icon: '👤' },
      ]
    : [
        { to: '/', label: 'Dashboard', icon: '🏆' },
        { to: '/login', label: 'Log in', icon: '🔑' },
      ];
  if (user?.role === 'admin') {
    items.push({ to: '/admin', label: 'Admin', icon: '⚙️' });
  }

  // Admins get 7 items, which overflows a phone's width. Keep the active item
  // scrolled into view so it is always visible (e.g. Admin when on /admin).
  useEffect(() => {
    const active = navRef.current?.querySelector('a.active');
    active?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }, [location.pathname]);

  return (
    <nav className="bottom-nav" ref={navRef}>
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
        <img className="brand-logo" src="/logo.png" alt="" />
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
  if (user?.role !== 'admin') {
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
                    path="/quran"
                    element={
                      <Protected>
                        <QuranPage />
                      </Protected>
                    }
                  />
                  <Route
                    path="/merits"
                    element={
                      <Protected>
                        <MeritsPage />
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
