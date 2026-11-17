"use client";

import type { ApiKey, ApiKeyCreated } from "@forkyou/shared";
import { useState } from "react";
import { api } from "@/lib/api.client";
import { Button, Card, CardTitle } from "./ui";

export function ApiKeys({ initial }: { initial: ApiKey[] }) {
  const [keys, setKeys] = useState(initial);
  const [created, setCreated] = useState<ApiKeyCreated | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const key = await api<ApiKeyCreated>("/v1/keys", {
        method: "POST",
        body: JSON.stringify({ name: name.trim() || "My editor" }),
      });
      setCreated(key);
      setKeys((k) => [...k, key]);
      setName("");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    if (!confirm("Revoke this key? Editors using it will stop syncing.")) return;
    try {
      await api(`/v1/keys/${id}`, { method: "DELETE" });
      setKeys((k) => k.filter((key) => key.id !== id));
      if (created?.id === id) setCreated(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function copy(text: string) {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Card id="keys">
      <CardTitle>API keys</CardTitle>
      <p className="mb-4 text-sm text-muted">
        Each editor uses an API key to sync your sessions. Create one per machine so you can revoke
        them individually.
      </p>

      {created && (
        <div className="mb-4 space-y-2 rounded-lg border border-accent/40 bg-accent-soft p-3">
          <p className="text-sm font-medium">Copy your key now. You won't see it again.</p>
          <div className="flex gap-2">
            <code className="flex-1 truncate rounded-md bg-surface px-2 py-1.5 font-mono text-xs">
              {created.key}
            </code>
            <Button type="button" onClick={() => copy(created.key)}>
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        </div>
      )}

      {keys.length > 0 && (
        <ul className="mb-4 divide-y divide-border rounded-lg border border-border">
          {keys.map((k) => (
            <li key={k.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{k.name}</p>
                <p className="font-mono text-xs text-muted">
                  {k.prefix}… ·{" "}
                  {k.lastUsedAt
                    ? `last used ${new Date(k.lastUsedAt).toLocaleDateString()}`
                    : "never used"}
                </p>
              </div>
              <Button type="button" variant="danger" onClick={() => revoke(k.id)}>
                Revoke
              </Button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={create} className="flex gap-2">
        <label htmlFor="key-name" className="sr-only">
          Key name
        </label>
        <input
          id="key-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Work laptop"
          maxLength={64}
          className="min-w-0 flex-1 rounded-lg border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-accent"
        />
        <Button type="submit" variant="primary" disabled={busy}>
          Create key
        </Button>
      </form>
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
    </Card>
  );
}
