import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { useSession } from "./auth/Session";
import { Login } from "./pages/Login";
import { Services } from "./pages/Services";
export function App() {
  const { user, logout } = useSession();
  if (!user) return <Login />;
  return (
    <div className="app">
      <aside className="sidebar">
        <a className="wordmark" href="/dashboard/">
          <span className="brand-mark" aria-hidden="true">
            S
          </span>
          SENTINEL
        </a>
        <p className="eyebrow">INCIDENT OPERATIONS</p>
        <nav aria-label="Main navigation">
          <NavLink to="/" end>
            Overview
          </NavLink>
        </nav>
        <div className="sidebar-bottom">
          <span className="environment">DEVELOPMENT</span>
          <p className="small">{user.email}</p>
          <p className="muted small">{user.role}</p>
          <button onClick={logout}>Sign out</button>
        </div>
      </aside>
      <main id="main-content" className="workspace">
        <Routes>
          <Route path="/" element={<Services />} />
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
      </main>
    </div>
  );
}
