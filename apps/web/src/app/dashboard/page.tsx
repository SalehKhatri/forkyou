import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { StatsPanel } from "@/components/stats-panel";
import { ButtonLink, Card } from "@/components/ui";
import { getApiKeys, getMe } from "@/lib/api.server";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const me = await getMe();
  if (!me) redirect("/login");
  const keys = await getApiKeys();

  return (
    <div className="space-y-8">
      {keys.length === 0 && (
        <Card className="flex flex-wrap items-center justify-between gap-4 border-accent/40 bg-accent-soft">
          <div>
            <h2 className="font-medium">Connect your editor</h2>
            <p className="text-sm text-muted">
              Create an API key, then paste it into the ForkYou extension to start tracking.
            </p>
          </div>
          <ButtonLink href="/settings#keys" variant="primary">
            Create API key
          </ButtonLink>
        </Card>
      )}
      <StatsPanel />
    </div>
  );
}
