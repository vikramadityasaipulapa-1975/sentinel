import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { ErrorBoundary } from "./ErrorBoundary";
test("invalid render data has a recoverable error view instead of blank content", () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  function Invalid(): never {
    throw new Error("Synthetic invalid response");
  }
  try {
    render(
      <ErrorBoundary>
        <Invalid />
      </ErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "saved data has not been changed",
    );
    expect(
      screen.getByRole("button", { name: "Reload and sign in" }),
    ).toBeInTheDocument();
  } finally {
    log.mockRestore();
  }
});
