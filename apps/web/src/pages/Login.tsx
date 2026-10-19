import { useState, type FormEvent } from "react";
import { useSession } from "../auth/Session";
import { message } from "../api/client";
import { Notice } from "../components/Common";
export function Login() {
  const { login, notice } = useSession();
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await login(email, password);
    } catch (error) {
      setError(message(error));
    } finally {
      setPassword("");
      setBusy(false);
    }
  }
  return (
    <main className="login">
      <div className="brand-mark" aria-hidden="true">
        S
      </div>
      <p className="eyebrow">SENTINEL / OPERATIONS</p>
      <h1>Clarity when it matters.</h1>
      <p className="muted">
        Investigate incidents. Follow the evidence. Keep people in control.
      </p>
      <form onSubmit={submit} className="panel login-form">
        <h2>Sign in to your workspace</h2>
        {notice && <Notice>{notice}</Notice>}
        {error && <Notice>{error}</Notice>}
        <label>
          Email
          <input
            type="email"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            maxLength={254}
          />
        </label>
        <label>
          Password
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            maxLength={128}
          />
        </label>
        <button className="primary" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
        <p className="small muted">
          Use your existing Sentinel account. Sessions stay in memory; a refresh
          requires signing in again.
        </p>
      </form>
    </main>
  );
}
