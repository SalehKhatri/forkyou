"use client";

import type { MeResponse, SettingsUpdate } from "@forkyou/shared";
import { useState } from "react";
import { api } from "@/lib/api.client";
import { Card, CardTitle } from "./ui";

export function PrivacySettings({ me }: { me: MeResponse }) {
  const [settings, setSettings] = useState({
    showPresence: me.showPresence,
    showLanguage: me.showLanguage,
  });
  const [error, setError] = useState<string | null>(null);

  async function update(patch: SettingsUpdate) {
    const previous = settings;
    setSettings({ ...settings, ...patch });
    setError(null);
    try {
      await api("/v1/me/settings", { method: "PATCH", body: JSON.stringify(patch) });
    } catch (err) {
      setSettings(previous);
      setError((err as Error).message);
    }
  }

  return (
    <Card>
      <CardTitle>Privacy</CardTitle>
      <div className="space-y-4">
        <Toggle
          label="Show when I'm online"
          description="A green dot next to your name while you're coding."
          checked={settings.showPresence}
          onChange={(v) => update({ showPresence: v })}
        />
        <Toggle
          label="Show what I'm coding in"
          description={`"Coding in Rust" next to your online status.`}
          checked={settings.showLanguage}
          disabled={!settings.showPresence}
          onChange={(v) => update({ showLanguage: v })}
        />
      </div>
      {error && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      )}
    </Card>
  );
}

function Toggle({
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className={`flex items-start justify-between gap-4 ${disabled ? "opacity-50" : ""}`}>
      <span>
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-sm text-muted">{description}</span>
      </span>
      <input
        type="checkbox"
        role="switch"
        aria-checked={checked}
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 size-4 accent-[var(--accent)]"
      />
    </label>
  );
}
