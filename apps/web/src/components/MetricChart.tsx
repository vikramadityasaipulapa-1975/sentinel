import { chartPaths, numericSeries } from "../api/evidence";
import { record } from "../api/client";
import { When } from "./Common";
const definitions = [
  {
    key: "request_rate",
    title: "Request rate",
    unit: "requests / second",
    factor: 1,
  },
  { key: "error_ratio", title: "HTTP 5xx ratio", unit: "percent", factor: 100 },
  {
    key: "p95_seconds",
    title: "Pointwise p95 latency",
    unit: "seconds",
    factor: 1,
  },
];
export function MetricCharts({
  data,
  start,
  end,
}: {
  data: Record<string, unknown>;
  start: string;
  end: string;
}) {
  const series = record(data.series ?? {});
  return (
    <div className="charts">
      {definitions.map((def) => {
        const points = numericSeries(series[def.key]).map(
          ([t, v]) => [t, v * def.factor] as [number, number],
        );
        const paths = chartPaths(
          points,
          Date.parse(start) / 1000,
          Date.parse(end) / 1000,
          typeof data.step_seconds === "number" ? data.step_seconds : 15,
        );
        return (
          <figure key={def.key} className="metric">
            <figcaption>
              <strong>{def.title}</strong>
              <span className="muted small">{def.unit}</span>
            </figcaption>
            {!points.length ? (
              <p className="muted">
                No usable samples. Missing data is not zero.
              </p>
            ) : (
              <>
                <svg
                  viewBox="0 0 600 140"
                  role="img"
                  aria-label={`${def.title} over the saved evidence window`}
                >
                  <line x1="20" x2="580" y1="115" y2="115" stroke="#506368" />
                  <text x="3" y="120" fill="#a6b8ba" fontSize="10">
                    0
                  </text>
                  {paths.map((d, i) => (
                    <path
                      key={i}
                      d={d}
                      fill="none"
                      stroke="#a6dbb5"
                      strokeWidth="2"
                    />
                  ))}
                  {points.map(([t, v], i) => (
                    <circle
                      key={i}
                      cx={
                        20 +
                        ((t - Date.parse(start) / 1000) /
                          Math.max(
                            (Date.parse(end) - Date.parse(start)) / 1000,
                            1,
                          )) *
                          560
                      }
                      cy={
                        115 - (v / Math.max(...points.map((p) => p[1]), 1)) * 95
                      }
                      r="2"
                      fill="#a6dbb5"
                    />
                  ))}
                </svg>
                <details>
                  <summary>Sample values · {points.length}</summary>
                  <div
                    className="table-scroll"
                    tabIndex={0}
                    role="region"
                    aria-label="Scrollable evidence table"
                  >
                    <table>
                      <caption>
                        {def.title} · {def.unit}
                      </caption>
                      <thead>
                        <tr>
                          <th>Timestamp</th>
                          <th>Value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {points.map(([t, v], i) => (
                          <tr key={i}>
                            <td>
                              <When value={new Date(t * 1000).toISOString()} />
                            </td>
                            <td>{Number(v.toPrecision(6))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              </>
            )}
          </figure>
        );
      })}
    </div>
  );
}
