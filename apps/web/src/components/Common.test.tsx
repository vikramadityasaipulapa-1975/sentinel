import { act, render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { useLoad } from "./Common";
test("changing a request key aborts the old read and ignores late responses", async () => {
  const reads: {
    key: string;
    signal: AbortSignal;
    resolve: (value: string) => void;
  }[] = [];
  function View({ query }: { query: string }) {
    const state = useLoad(
      (signal) =>
        new Promise<string>((resolve) =>
          reads.push({ key: query, signal, resolve }),
        ),
      [query],
    );
    return <p>{state.data ?? "Loading"}</p>;
  }
  const view = render(<View query="old" />);
  expect(reads).toHaveLength(1);
  view.rerender(<View query="new" />);
  expect(reads).toHaveLength(2);
  expect(reads[0].signal.aborted).toBe(true);
  await act(async () => {
    reads[1].resolve("New response");
  });
  expect(screen.getByText("New response")).toBeInTheDocument();
  await act(async () => {
    reads[0].resolve("Stale response");
  });
  expect(screen.queryByText("Stale response")).not.toBeInTheDocument();
  expect(reads).toHaveLength(2);
  view.unmount();
  expect(reads[1].signal.aborted).toBe(true);
});
