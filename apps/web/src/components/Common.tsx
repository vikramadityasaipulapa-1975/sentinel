import { useEffect, useRef, useState } from "react";
import { message } from "../api/client";
export function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="notice" role="alert">
      {children}
    </div>
  );
}
export function Badge({ value }: { value: string }) {
  return (
    <span
      className={`badge ${["CRITICAL", "HIGH", "FAILED", "UNVERIFIED"].includes(value) ? "danger" : ["PARTIAL", "PENDING", "UNAVAILABLE"].includes(value) ? "warning" : ""}`}
    >
      {value.replaceAll("_", " ")}
    </span>
  );
}
export function When({ value }: { value: string | null | undefined }) {
  return (
    <>
      {value && Number.isFinite(Date.parse(value)) ? (
        <time dateTime={value}>{new Date(value).toLocaleString()}</time>
      ) : (
        "Not recorded"
      )}
    </>
  );
}
export function useLoad<T>(
  load: (signal: AbortSignal) => Promise<T>,
  deps: readonly (string | number | null | undefined)[],
) {
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [revision, setRevision] = useState(0);
  // Callers supply primitive request identity, not unstable inline callback identity.
  const requestKey = JSON.stringify(deps);
  const loader = useRef(load);
  useEffect(() => {
    loader.current = load;
  }, [load]);
  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setLoading(true);
    setError("");
    loader
      .current(controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setData(value);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(message(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [requestKey, revision]);
  return {
    data,
    error,
    loading,
    refresh: () => setRevision((value) => value + 1),
  };
}
