import Link from "next/link";
import { getMe } from "@/lib/api.server";
import { Avatar, ButtonLink } from "./ui";

export async function SiteHeader() {
  const me = await getMe();
  return (
    <header className="border-b border-border">
      <nav className="mx-auto flex h-14 max-w-5xl items-center gap-6 px-4">
        <Link href="/" className="font-mono text-sm font-semibold tracking-tight">
          fork<span className="text-accent">you</span>
        </Link>
        <div className="flex items-center gap-4 text-sm text-muted">
          <Link href="/leaderboard" className="hover:text-fg">
            Leaderboard
          </Link>
          {me && (
            <Link href="/dashboard" className="hover:text-fg">
              Dashboard
            </Link>
          )}
        </div>
        <div className="ml-auto">
          {me ? (
            <Link
              href="/settings"
              className="flex items-center gap-2 text-sm text-muted hover:text-fg"
            >
              <Avatar src={me.avatarUrl} name={me.username} size={24} />
              <span className="hidden sm:inline">{me.username}</span>
            </Link>
          ) : (
            <ButtonLink href="/login" variant="primary">
              Sign in
            </ButtonLink>
          )}
        </div>
      </nav>
    </header>
  );
}
