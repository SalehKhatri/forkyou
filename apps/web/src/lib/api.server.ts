import "server-only";
import type {
  ApiKey,
  LeaderboardRange,
  LeaderboardResponse,
  MeResponse,
  OnlineUser,
} from "@forkyou/shared";
import { cookies } from "next/headers";

const API_URL = process.env.API_URL ?? "http://localhost:4000";

/** Server-side fetch to the API, forwarding the visitor's cookies. */
async function apiFetch(path: string, init: RequestInit & { revalidate?: number } = {}) {
  const { revalidate, ...rest } = init;
  const cookieHeader = (await cookies()).toString();
  return fetch(`${API_URL}${path}`, {
    ...rest,
    headers: { ...(cookieHeader ? { cookie: cookieHeader } : {}), ...rest.headers },
    ...(revalidate === undefined ? { cache: "no-store" } : { next: { revalidate } }),
  });
}

/** The signed-in user, or null. Never throws for a signed-out visitor. */
export async function getMe(): Promise<MeResponse | null> {
  try {
    const res = await apiFetch("/v1/me");
    return res.ok ? ((await res.json()) as MeResponse) : null;
  } catch {
    return null;
  }
}

export async function getLeaderboard(range: LeaderboardRange): Promise<LeaderboardResponse> {
  const res = await fetch(`${API_URL}/v1/leaderboard?range=${range}`, { next: { revalidate: 30 } });
  if (!res.ok) throw new Error(`leaderboard: ${res.status}`);
  return (await res.json()) as LeaderboardResponse;
}

export async function getOnline(): Promise<{ count: number; users: OnlineUser[] }> {
  try {
    const res = await fetch(`${API_URL}/v1/presence/online`, { next: { revalidate: 15 } });
    if (!res.ok) return { count: 0, users: [] };
    return (await res.json()) as { count: number; users: OnlineUser[] };
  } catch {
    return { count: 0, users: [] };
  }
}

export async function getApiKeys(): Promise<ApiKey[]> {
  const res = await apiFetch("/v1/keys");
  return res.ok ? ((await res.json()) as ApiKey[]) : [];
}
