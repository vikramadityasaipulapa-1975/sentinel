import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ApiError,
  profile,
  record,
  request,
  text,
  type Profile,
} from "../api/client";
type Session = {
  token: string | null;
  user: Profile | null;
  notice: string;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  expire: () => void;
  api: (
    path: string,
    options?: RequestInit,
    signal?: AbortSignal,
  ) => Promise<unknown>;
};
const Context = createContext<Session | null>(null);
export function SessionProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null),
    [user, setUser] = useState<Profile | null>(null),
    [notice, setNotice] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    generation = useRef(0);
  const clear = useCallback((reason = "") => {
    generation.current++;
    clearTimeout(timer.current);
    setToken(null);
    setUser(null);
    setNotice(reason);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  async function login(email: string, password: string) {
    const current = ++generation.current;
    const data = record(
      await request("/api/v1/auth/login", null, {
        method: "POST",
        body: JSON.stringify({ email, password }),
      }),
    );
    const access = text(data.access_token),
      account = profile(data.user),
      seconds = data.expires_in;
    if (
      typeof seconds !== "number" ||
      !Number.isFinite(seconds) ||
      seconds <= 0 ||
      seconds > 3600
    )
      throw new Error("Invalid session expiry");
    if (current !== generation.current) return;
    clearTimeout(timer.current);
    setToken(access);
    setUser(account);
    setNotice("");
    timer.current = setTimeout(
      () => clear("Session expired. Sign in again."),
      seconds * 1000,
    );
  }
  async function api(
    path: string,
    options?: RequestInit,
    signal?: AbortSignal,
  ) {
    const current = generation.current;
    try {
      return await request(path, token, options, signal);
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.status === 401 &&
        current === generation.current
      )
        clear("Session expired or revoked. Sign in again.");
      throw error;
    }
  }
  const expire = useCallback(
    () => clear("Session expired or revoked. Sign in again."),
    [clear],
  );
  return (
    <Context.Provider
      value={{
        token,
        user,
        expire,
        notice,
        login,
        logout: () =>
          clear(
            "Signed out on this browser. Other token copies are not revoked.",
          ),
        api,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useSession() {
  const value = useContext(Context);
  if (!value) throw new Error("Session provider missing");
  return value;
}
