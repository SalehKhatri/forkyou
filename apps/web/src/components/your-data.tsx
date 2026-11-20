"use client";

import type { AccountDelete } from "@forkyou/shared";
import { useId, useState } from "react";
import { api } from "@/lib/api.client";
import { Button, Card, CardTitle } from "./ui";

/** Download everything ForkYou stores about you, or delete your account. */
export function YourData({ username }: { username: string }) {
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();

  async function deleteAccount() {
    setDeleting(true);
    setError(null);
    try {
      const body: AccountDelete = { confirm: typed };
      await api("/v1/me", { method: "DELETE", body: JSON.stringify(body) });
      window.location.assign("/");
    } catch (err) {
      setError((err as Error).message);
      setDeleting(false);
    }
  }

  return (
    <Card>
      <CardTitle>Your data</CardTitle>
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted">
            Download your profile, settings, API key names and every coding session as JSON.
          </p>
          {/* A plain link: the API sends it as a file download. */}
          <a
            href="/api/v1/me/export"
            className="inline-flex items-center justify-center rounded-lg border border-border bg-surface px-3.5 py-2 text-sm font-medium transition hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Download my data
          </a>
        </div>

        <div className="border-t border-border pt-5">
          {!confirming ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted">
                Delete your account and all your coding time. This can't be undone.
              </p>
              <Button variant="danger" onClick={() => setConfirming(true)}>
                Delete account
              </Button>
            </div>
          ) : (
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                void deleteAccount();
              }}
            >
              <label htmlFor={inputId} className="block text-sm">
                This permanently deletes your account, your coding sessions and your API keys. Type{" "}
                <strong>{username}</strong> to confirm.
              </label>
              <input
                id={inputId}
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
              />
              <div className="flex gap-2">
                <Button type="submit" variant="danger" disabled={typed !== username || deleting}>
                  {deleting ? "Deleting…" : "Delete my account"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setConfirming(false);
                    setTyped("");
                    setError(null);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </form>
          )}
          {error && (
            <p role="alert" className="mt-3 text-sm text-danger">
              {error}
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}
