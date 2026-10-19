import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, test, vi, beforeEach } from "vitest";
import { useSession } from "../auth/Session";
import { Incidents } from "./Incidents";
vi.mock("../auth/Session", () => ({ useSession: vi.fn() }));
const api = vi.fn();
beforeEach(() => {
  api.mockReset();
  vi.mocked(useSession).mockReturnValue({
    token: "synthetic",
    user: { id: "u", email: "viewer@example.test", role: "VIEWER" },
    notice: "",
    api,
    login: vi.fn(),
    logout: vi.fn(),
    expire: vi.fn(),
  });
  api.mockImplementation(async (path: string) =>
    path === "/api/v1/services"
      ? { services: [] }
      : { incidents: [], next_cursor: null },
  );
});
test("viewer sees empty filters but no creation control", async () => {
  render(
    <MemoryRouter>
      <Incidents />
    </MemoryRouter>,
  );
  expect(await screen.findByText("No incidents match")).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Create incident" }),
  ).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Status"), {
    target: { value: "OPEN" },
  });
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      "/api/v1/incidents?limit=20&status=OPEN",
      {},
      expect.any(AbortSignal),
    ),
  );
});
test("network error is displayed without pretending the list is empty", async () => {
  api.mockRejectedValue(new Error("Storage unavailable"));
  render(
    <MemoryRouter>
      <Incidents />
    </MemoryRouter>,
  );
  expect((await screen.findAllByRole("alert"))[0]).toHaveTextContent(
    "Storage unavailable",
  );
  expect(screen.queryByText("No incidents match")).not.toBeInTheDocument();
});
