import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ApiKeys } from "@/components/api-keys";
import { PrivacySettings } from "@/components/privacy-settings";
import { SignOutButton } from "@/components/sign-out-button";
import { Avatar } from "@/components/ui";
import { YourData } from "@/components/your-data";
import { getApiKeys, getMe } from "@/lib/api.server";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const me = await getMe();
  if (!me) redirect("/login");
  const keys = await getApiKeys();

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center gap-3">
        <Avatar src={me.avatarUrl} name={me.username} size={40} />
        <div className="flex-1">
          <h1 className="text-xl font-semibold tracking-tight">{me.name ?? me.username}</h1>
          <p className="text-sm text-muted">@{me.username}</p>
        </div>
        <SignOutButton />
      </div>
      <ApiKeys initial={keys} />
      <PrivacySettings me={me} />
      <YourData username={me.username} />
    </div>
  );
}
