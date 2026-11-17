import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Card } from "@/components/ui";
import { getMe } from "@/lib/api.server";

export const metadata: Metadata = { title: "Sign in" };

const errors: Record<string, string> = {
  state: "Your sign-in link expired. Please try again.",
  github: "GitHub didn't accept the sign-in. Please try again.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  if (await getMe()) redirect("/dashboard");
  const { error } = await searchParams;

  return (
    <div className="mx-auto max-w-sm pt-10">
      <Card className="space-y-5 p-7 text-center">
        <h1 className="text-xl font-semibold tracking-tight">Sign in to ForkYou</h1>
        {error && (
          <p role="alert" className="rounded-lg bg-surface-2 px-3 py-2 text-sm text-danger">
            {errors[error] ?? "Something went wrong. Please try again."}
          </p>
        )}
        {/* A plain link, not fetch: OAuth needs a full-page redirect. */}
        <a
          href="/api/auth/github"
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-fg px-4 py-2.5 text-sm font-medium text-bg hover:opacity-90"
        >
          <svg aria-hidden viewBox="0 0 16 16" className="size-4" fill="currentColor">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
          </svg>
          Continue with GitHub
        </a>
        <p className="text-xs text-muted">We only read your public GitHub profile.</p>
      </Card>
    </div>
  );
}
