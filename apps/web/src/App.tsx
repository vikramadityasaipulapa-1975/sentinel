import { useEffect } from "react";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Incidents } from "./pages/Incidents";
import { IncidentDetail } from "./pages/IncidentDetail";
import { NavLink, Route, Routes, useLocation } from "react-router-dom";
import { useSession } from "./auth/Session";
import { Login } from "./pages/Login";
import { Services } from "./pages/Services";
export function App() {
  const { user, logout } = useSession();
  const location = useLocation();
  useEffect(() => {
    document.title = "Sentinel · Incident operations";
    document.getElementById("main-content")?.focus();
  }, [location.pathname, user?.id]);
  if (!user) return <Login />;
  return (
    <div className="app">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <aside className="sidebar">
        <NavLink className="wordmark" to="/">
          <span className="brand-mark" aria-hidden="true">
            S
          </span>
          SENTINEL
        </NavLink>
        <p className="eyebrow">INCIDENT OPERATIONS</p>
        <nav aria-label="Main navigation">
          <NavLink to="/" end>
            Overview
          </NavLink>
          <NavLink to="/incidents">Incidents</NavLink>
        </nav>
        <div className="sidebar-bottom">
          <span className="environment">DEVELOPMENT</span>
          <p className="small">{user.email}</p>
          <p className="muted small">{user.role}</p>
          <button onClick={logout}>Sign out</button>
        </div>
      </aside>
      <main id="main-content" className="workspace" tabIndex={-1}>
        <ErrorBoundary key={`${location.pathname}-${user.id}`}>
          <Routes>
            <Route path="/" element={<Services />} />
            <Route path="/incidents" element={<Incidents />} />
            <Route path="/incidents/:id" element={<IncidentDetail />} />
            <Route
              path="*"
              element={
                <>
                  <h1>Page not found</h1>
                  <NavLink to="/">Return to overview</NavLink>
                </>
              }
            />
          </Routes>
        </ErrorBoundary>
      </main>
    </div>
  );
}
