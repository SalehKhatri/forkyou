import type { LeaderboardEntry } from "@forkyou/shared";
import { formatDuration, languageName } from "@/lib/format";
import { Avatar, OnlineDot } from "./ui";

export function LeaderboardTable({ entries }: { entries: LeaderboardEntry[] }) {
  if (entries.length === 0) {
    return (
      <p className="py-10 text-center text-sm text-muted">No one has coded in this window yet.</p>
    );
  }
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs text-muted">
          <th className="w-12 pb-2 font-normal">#</th>
          <th className="pb-2 font-normal">Developer</th>
          <th className="hidden pb-2 font-normal sm:table-cell">Top language</th>
          <th className="pb-2 text-right font-normal">Time</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((e) => (
          <tr key={e.username} className="border-t border-border">
            <td className="py-2.5 font-mono text-muted">{e.rank}</td>
            <td className="py-2.5">
              <span className="flex items-center gap-2.5">
                <Avatar src={e.avatarUrl} name={e.username} />
                <span className="truncate font-medium">{e.username}</span>
                {e.online && <OnlineDot />}
              </span>
            </td>
            <td className="hidden py-2.5 text-muted sm:table-cell">
              {languageName(e.topLanguage)}
            </td>
            <td className="py-2.5 text-right font-mono tabular-nums">
              {formatDuration(e.totalSeconds)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
