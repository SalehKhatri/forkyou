import { LeaderboardTable } from "@/components/leaderboard-table";
import { ButtonLink, Card, CardTitle, OnlineDot } from "@/components/ui";
import { getLeaderboard, getOnline } from "@/lib/api.server";
import { languageName } from "@/lib/format";

const steps = [
  ["Sign in with GitHub", "One click. No passwords, no email."],
  ["Install the extension", "VS Code, JetBrains or Neovim. Paste your API key once."],
  ["Just code", "Sessions sync in the background. Idle time is never counted."],
] as const;

export default async function Home() {
  const [online, board] = await Promise.all([
    getOnline(),
    getLeaderboard("week").catch(() => ({ range: "week" as const, entries: [] })),
  ]);

  return (
    <div className="space-y-14">
      <section className="space-y-6 pt-6">
        <p className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1 text-xs text-muted">
          <OnlineDot />
          <span>
            <span className="font-mono text-fg">{online.count}</span>{" "}
            {online.count === 1 ? "developer is" : "developers are"} coding right now
          </span>
        </p>
        <h1 className="max-w-2xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
          Your coding time, measured honestly.
        </h1>
        <p className="max-w-xl text-lg text-muted text-pretty">
          ForkYou tracks real time spent in your editor, shows you where it goes, and puts you on a
          leaderboard with everyone else who ships.
        </p>
        <div className="flex flex-wrap gap-3">
          <ButtonLink href="/login" variant="primary">
            Get started
          </ButtonLink>
          <ButtonLink href="/leaderboard">See the leaderboard</ButtonLink>
        </div>
      </section>

      {online.users.length > 0 && (
        <section aria-label="Coding now" className="flex flex-wrap gap-2">
          {online.users.slice(0, 12).map((u) => (
            <span
              key={u.username}
              className="inline-flex items-center gap-2 rounded-full bg-surface-2 px-3 py-1 text-xs"
            >
              <OnlineDot />
              {u.username}
              {u.language && <span className="text-muted">· {languageName(u.language)}</span>}
            </span>
          ))}
        </section>
      )}

      <section className="grid gap-4 sm:grid-cols-3">
        {steps.map(([title, body], i) => (
          <Card key={title}>
            <p className="mb-3 font-mono text-xs text-accent">0{i + 1}</p>
            <h3 className="font-medium">{title}</h3>
            <p className="mt-1 text-sm text-muted">{body}</p>
          </Card>
        ))}
      </section>

      <Card>
        <CardTitle
          action={
            <ButtonLink href="/leaderboard" variant="ghost">
              Full leaderboard →
            </ButtonLink>
          }
        >
          Top this week
        </CardTitle>
        <LeaderboardTable entries={board.entries.slice(0, 5)} />
      </Card>
    </div>
  );
}
