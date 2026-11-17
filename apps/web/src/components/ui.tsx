import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";

const variants: Record<Variant, string> = {
  primary: "bg-accent text-accent-fg hover:opacity-90",
  secondary: "border border-border bg-surface hover:bg-surface-2",
  ghost: "text-muted hover:text-fg hover:bg-surface-2",
  danger: "border border-border text-danger hover:bg-surface-2",
};

const base =
  "inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

export function Button({
  variant = "secondary",
  className = "",
  ...props
}: ComponentProps<"button"> & { variant?: Variant }) {
  return <button className={`${base} ${variants[variant]} ${className}`} {...props} />;
}

export function ButtonLink({
  variant = "secondary",
  className = "",
  ...props
}: ComponentProps<typeof Link> & { variant?: Variant }) {
  return <Link className={`${base} ${variants[variant]} ${className}`} {...props} />;
}

export function Card({ className = "", ...props }: ComponentProps<"section">) {
  return (
    <section className={`rounded-xl border border-border bg-surface p-5 ${className}`} {...props} />
  );
}

export function CardTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <h2 className="text-sm font-medium text-muted">{children}</h2>
      {action}
    </div>
  );
}

/** Pulsing green dot for "online now". */
export function OnlineDot({ label = "Online now" }: { label?: string }) {
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className="inline-block size-2 shrink-0 rounded-full bg-accent [animation:pulse-dot_2s_ease-in-out_infinite]"
    />
  );
}

export function Avatar({
  src,
  name,
  size = 28,
}: {
  src: string | null;
  name: string;
  size?: number;
}) {
  if (!src) {
    return (
      <span
        aria-hidden
        style={{ width: size, height: size }}
        className="inline-flex shrink-0 items-center justify-center rounded-full bg-surface-2 font-mono text-xs text-muted"
      >
        {name.slice(0, 1).toUpperCase()}
      </span>
    );
  }
  return (
    // biome-ignore lint/performance/noImgElement: tiny avatars; next/image adds little here
    <img src={src} alt="" width={size} height={size} className="shrink-0 rounded-full" />
  );
}
