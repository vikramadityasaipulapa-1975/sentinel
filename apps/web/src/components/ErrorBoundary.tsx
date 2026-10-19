import { Component, type ErrorInfo, type ReactNode } from "react";
export class ErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(_error: Error, _info: ErrorInfo) {
    /* Never log operational payloads or credentials. */
  }
  render() {
    if (this.state.failed)
      return (
        <section className="panel">
          <h1>This view could not be displayed</h1>
          <p role="alert">
            The response did not match the expected format. Your saved data has
            not been changed.
          </p>
          <p className="muted">
            Try another page, or reload and sign in again.
          </p>
          <button onClick={() => window.location.reload()}>
            Reload and sign in
          </button>
        </section>
      );
    return this.props.children;
  }
}
