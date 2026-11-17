"use client";

import { STATS_RANGES, type StatsRange, type StatsResponse } from "@forkyou/shared";
import { useEffect, useState } from "react";
import { api } from "@/lib/api.client";
import { formatDuration, languageName, percent } from "@/lib/format";
import { Card, CardTitle } from "./ui";

const labels: Record<StatsRange, string> = { "7d": "7 days", "30d": "30 days", "365d": "Year" };

/** Fetched in the browser so days are bucketed in the viewer's own time zone. */
export function StatsPanel() {
  const [range, setRange] = useState<StatsRange>("7d");
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    setError(null);
    api<StatsResponse>(`/v1/me/stats?range=${range}&tz=${encodeURIComponent(tz)}`)
      .then((s) => !cancelled && setStats(s))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [range]);

  const days = stats?.days ?? [];
  const max = Math.max(1, ...days.map((d) => d.seconds));
  const activeDays = days.filter((d) => d.seconds > 0).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Your activity</h1>
        <div
          role="tablist"
          aria-label="Range"
          className="flex rounded-lg border border-border p-0.5 text-sm"
        >
          {STATS_RANGES.map((r) => (
            <button
              key={r}
              type="button"
              role="tab"
              aria-selected={r === range}
              onClick={() => setRange(r)}
              className={`rounded-md px-3 py-1.5 ${r === range ? "bg-surface-2 text-fg" : "text-muted hover:text-fg"}`}
            >
              {labels[r]}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Total" value={stats ? formatDuration(stats.totalSeconds) : "—"} />
        <Stat
          label="Daily average"
          value={stats ? formatDuration(stats.totalSeconds / Math.max(1, days.length)) : "—"}
        />
        <Stat label="Active days" value={stats ? `${activeDays} / ${days.length}` : "—"} />
      </div>

      <Card>
        <CardTitle>Time per day</CardTitle>
        <div className="flex h-40 items-end gap-[2px]" role="img" aria-label="Time per day chart">
          {days.map((d) => (
            <div
              key={d.day}
              title={`${d.day}: ${formatDuration(d.seconds)}`}
              className="flex-1 rounded-t-sm bg-accent/80 hover:bg-accent"
              style={{
                height: `${Math.max(d.seconds > 0 ? 3 : 1, (d.seconds / max) * 100)}%`,
                opacity: d.seconds > 0 ? 1 : 0.25,
              }}
            />
          ))}
        </div>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Breakdown
          title="Languages"
          total={stats?.totalSeconds ?? 0}
          rows={(stats?.languages ?? []).map((l) => ({
            label: languageName(l.language),
            seconds: l.seconds,
          }))}
        />
        <Breakdown
          title="Projects"
          total={stats?.totalSeconds ?? 0}
          rows={(stats?.projects ?? []).map((p) => ({ label: p.project, seconds: p.seconds }))}
        />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 font-mono text-2xl tabular-nums">{value}</p>
    </Card>
  );
}

function Breakdown({
  title,
  rows,
  total,
}: {
  title: string;
  rows: { label: string; seconds: number }[];
  total: number;
}) {
  return (
    <Card>
      <CardTitle>{title}</CardTitle>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">Nothing yet.</p>
      ) : (
        <ul className="space-y-3">
          {rows.slice(0, 8).map((r) => (
            <li key={r.label} className="space-y-1">
              <div className="flex justify-between text-sm">
                <span className="truncate">{r.label}</span>
                <span className="font-mono text-muted tabular-nums">
                  {formatDuration(r.seconds)}
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-surface-2">
                <div
                  className="h-full rounded-full bg-accent"
                  style={{ width: `${percent(r.seconds, total)}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
