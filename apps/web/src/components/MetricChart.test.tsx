import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { MetricCharts } from "./MetricChart";
test("metric labels keep units and missing data explicit", () => {
  render(
    <MetricCharts
      start="2026-10-19T00:00:00Z"
      end="2026-10-19T00:01:00Z"
      data={{
        series: {
          request_rate: [[1792368000, 0]],
          error_ratio: [],
          p95_seconds: [],
        },
        step_seconds: 15,
      }}
    />,
  );
  expect(screen.getByText("requests / second")).toBeInTheDocument();
  expect(
    screen.getAllByText("No usable samples. Missing data is not zero."),
  ).toHaveLength(2);
  expect(screen.getByRole("img", { name: /Request rate/ })).toBeInTheDocument();
});
