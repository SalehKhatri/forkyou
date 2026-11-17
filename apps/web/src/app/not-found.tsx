import { ButtonLink } from "@/components/ui";

export default function NotFound() {
  return (
    <div className="space-y-4 pt-10 text-center">
      <p className="font-mono text-sm text-muted">404</p>
      <h1 className="text-2xl font-semibold">This page doesn't exist.</h1>
      <ButtonLink href="/">Go home</ButtonLink>
    </div>
  );
}
