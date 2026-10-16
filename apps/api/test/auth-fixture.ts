import type { AuthService } from "../src/auth.js";

// Explicit fake auth for pre-auth domain tests only. The real server never uses it.
export const domainAuth: AuthService = {
  ready: async () => true,
  login: async () => {
    throw new Error("Not used by domain fixtures");
  },
  authenticate: async () => ({
    id: "33333333-3333-4333-8333-333333333333",
    email: "fixture@example.test",
    role: "ADMIN",
  }),
};
