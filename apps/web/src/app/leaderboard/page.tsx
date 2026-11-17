import { LEADERBOARD_RANGES, type LeaderboardRange } from "@forkyou/shared";
import type { Metadata } from "next";
import Link from "next/link";
import { LeaderboardTable } from "@/components/leaderboard-table";
import { Card } from "@/components/ui";
import { getLeaderboard } from "@/lib/api.server";

export const metadata: Metadata = { title: "Leaderboard" };

const labels: Record<LeaderboardRange, string> = {
  day: "24 hours",
  week: "7 days",
  month: "30 days",
};

export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const { range: raw } = await searchParams;
  const range = (LEADERBOARD_RANGES as readonly string[]).includes(raw ?? "")
    ? (raw as LeaderboardRange)
    : "week";
  const board = await getLeaderboard(range);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Leaderboard</h1>
          <p className="text-sm text-muted">Top 100 by time coded. Updates every 30 seconds.</p>
        </div>
        <nav aria-label="Time range" className="flex rounded-lg border border-border p-0.5 text-sm">
          {LEADERBOARD_RANGES.map((r) => (
            <Link
              key={r}
              href={`/leaderboard?range=${r}`}
              aria-current={r === range ? "page" : undefined}
              className={`rounded-md px-3 py-1.5 ${r === range ? "bg-surface-2 text-fg" : "text-muted hover:text-fg"}`}
            >
              {labels[r]}
            </Link>
          ))}
        </nav>
      </div>
      <Card>
        <LeaderboardTable entries={board.entries} />
      </Card>
    </div>
  );
}
