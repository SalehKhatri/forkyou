"use client";

import { useRouter } from "next/navigation";
import { api } from "@/lib/api.client";
import { Button } from "./ui";

export function SignOutButton() {
  const router = useRouter();
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={async () => {
        await api("/auth/logout", { method: "POST" });
        router.push("/");
        router.refresh();
      }}
    >
      Sign out
    </Button>
  );
}
