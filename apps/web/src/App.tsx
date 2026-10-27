import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { fetchChart, fetchCurrent, fetchDevices } from "./api";
import { LevelChart } from "./LevelChart";

// "Live" ranges end at the present and follow it; a zoomed range is fixed.
const PRESETS = [
  { label: "1 hour", seconds: 3600 },
  { label: "6 hours", seconds: 6 * 3600 },
  { label: "24 hours", seconds: 86_400 },
  { label: "7 days", seconds: 7 * 86_400 },
  { label: "30 days", seconds: 30 * 86_400 },
  { label: "1 year", seconds: 365 * 86_400 },
];

type Range = { kind: "live"; seconds: number } | { kind: "fixed"; from: number; to: number };

function formatAge(seconds: number): string {
  if (seconds < 90) return `${seconds} s ago`;
  if (seconds < 5400) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 172_800) return `${Math.round(seconds / 3600)} h ago`;
  return `${Math.round(seconds / 86_400)} days ago`;
}

function formatSpan(from: number, to: number): string {
  const fmt = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
  return `${fmt.format(from * 1000)} – ${fmt.format(to * 1000)}`;
}

export function App() {
  const devices = useQuery({ queryKey: ["devices"], queryFn: fetchDevices });
  // One device for now; the API already supports several.
  const device = devices.data?.[0];

  return (
    <main>
      <h1>{device?.name ?? "Sump level"}</h1>
      {devices.isError && <p className="problem">Could not reach the server.</p>}
      {devices.data && devices.data.length === 0 && <p>No device has been set up yet.</p>}
      {device && (
        <>
          <Current id={device.id} />
          <History id={device.id} />
        </>
      )}
    </main>
  );
}

function Current({ id }: { id: number }) {
  const { data, isError } = useQuery({
    queryKey: ["current", id],
    queryFn: () => fetchCurrent(id),
    refetchInterval: 5000,
  });
  if (isError) return <p className="problem">Could not load the current level.</p>;
  if (!data) return <p className="muted">Loading…</p>;
  if (!data.reading) return <p>No readings yet.</p>;
  const { inches, ageSeconds, at } = data.reading;
  // The device reports about once a minute, so a quiet spell of a few minutes is normal.
  const stale = ageSeconds > 300;
  return (
    <section className="current" aria-label="Current level">
      <div className="value">
        {inches.toFixed(1)}
        <span className="unit"> in</span>
      </div>
      <div className={stale ? "age stale" : "age"} title={new Date(at).toLocaleString()}>
        {stale ? "No data since " : "Updated "}
        {formatAge(ageSeconds)}
      </div>
    </section>
  );
}

function History({ id }: { id: number }) {
  const [range, setRange] = useState<Range>({ kind: "live", seconds: 86_400 });

  const { data, isError, isFetching } = useQuery({
    // A live range is recomputed from the clock on every fetch, so it is keyed by its length only.
    queryKey: ["chart", id, range],
    queryFn: () => {
      const to = range.kind === "live" ? Math.floor(Date.now() / 1000) : range.to;
      const from = range.kind === "live" ? to - range.seconds : range.from;
      return fetchChart(id, from, to, 800).then((series) => ({ series, from, to }));
    },
    refetchInterval: range.kind === "live" ? 30_000 : false,
    placeholderData: (previous) => previous,
  });

  return (
    <section aria-label="History">
      <div className="toolbar">
        {PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            aria-pressed={range.kind === "live" && range.seconds === p.seconds}
            onClick={() => setRange({ kind: "live", seconds: p.seconds })}
          >
            {p.label}
          </button>
        ))}
      </div>
      {isError && <p className="problem">Could not load the history.</p>}
      {data && (
        <>
          <LevelChart
            series={data.series}
            range={{ from: data.from, to: data.to }}
            onZoom={(from, to) => setRange({ kind: "fixed", from, to })}
          />
          <p className="muted hint">
            {formatSpan(data.from, data.to)}
            {data.series.t.length === 0 && !isFetching && " · no data in this span"}
            {" · drag across the chart to zoom in"}
            {range.kind === "fixed" && (
              <>
                {" · "}
                <button type="button" className="link" onClick={() => setRange({ kind: "live", seconds: 86_400 })}>
                  reset
                </button>
              </>
            )}
          </p>
        </>
      )}
    </section>
  );
}
