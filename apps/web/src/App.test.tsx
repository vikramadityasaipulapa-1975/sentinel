import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { SessionProvider } from "./auth/Session";
import { App } from "./App";
afterEach(() => vi.unstubAllGlobals());
function mount() {
  render(
    <MemoryRouter>
      <SessionProvider>
        <App />
      </SessionProvider>
    </MemoryRouter>,
  );
}
function signin() {
  fireEvent.change(screen.getByLabelText("Email"), {
    target: { value: "operator@example.test" },
  });
  fireEvent.change(screen.getByLabelText("Password"), {
    target: { value: "synthetic-password" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
}
test("sign in renders real response services and sign out removes protected UI", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async (path: string) =>
        new Response(
          JSON.stringify(
            path.endsWith("login")
              ? {
                  access_token: "synthetic-token",
                  expires_in: 900,
                  user: {
                    id: "u1",
                    email: "operator@example.test",
                    role: "OPERATOR",
                  },
                }
              : {
                  services: [
                    {
                      id: "s1",
                      name: "payment-service",
                      owner: "sentinel-demo",
                      environment: "development",
                    },
                  ],
                },
          ),
          { status: 200 },
        ),
    ),
  );
  mount();
  signin();
  expect(await screen.findByText("payment-service")).toBeInTheDocument();
  expect(localStorage.length).toBe(0);
  fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
  expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
  expect(screen.queryByText("payment-service")).not.toBeInTheDocument();
});
test("invalid credentials keep protected content hidden and show an error", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: "UNAUTHORIZED",
            message: "Authentication required or credentials invalid",
          },
        }),
        { status: 401 },
      ),
    ),
  );
  mount();
  signin();
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "credentials invalid",
  );
  expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
});
