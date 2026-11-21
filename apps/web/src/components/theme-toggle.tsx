"use client";

import { type MouseEvent, useState } from "react";
import { flushSync } from "react-dom";
import { revealRadius, type Theme, themeCookie } from "@/lib/theme";

/**
 * Switches between the light and dark themes. The new theme spreads out from the button in a
 * circle (View Transitions API); with reduced motion, or in browsers without view transitions, the
 * switch is instant.
 */
export function ThemeToggle({ initial }: { initial: Theme }) {
  const [theme, setTheme] = useState<Theme>(initial);
  const next: Theme = theme === "dark" ? "light" : "dark";

  function apply(value: Theme) {
    document.documentElement.dataset.theme = value;
    // biome-ignore lint/suspicious/noDocumentCookie: a first-party preference cookie, read by the server to render the right theme.
    document.cookie = themeCookie(value);
    flushSync(() => setTheme(value));
  }

  function toggle(event: MouseEvent<HTMLButtonElement>) {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion || typeof document.startViewTransition !== "function") {
      apply(next);
      return;
    }
    // A keyboard press has no pointer position (detail is 0), so start from the button's centre.
    const box = event.currentTarget.getBoundingClientRect();
    const x = event.detail > 0 ? event.clientX : box.left + box.width / 2;
    const y = event.detail > 0 ? event.clientY : box.top + box.height / 2;
    const radius = revealRadius(x, y, window.innerWidth, window.innerHeight);

    const transition = document.startViewTransition(() => apply(next));
    transition.ready.then(() => {
      document.documentElement.animate(
        { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        {
          duration: 600,
          easing: "cubic-bezier(0.4, 0, 0.2, 1)",
          pseudoElement: "::view-transition-new(root)",
        },
      );
    });
  }

  const dark = theme === "dark";
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
      className="grid size-9 place-items-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        aria-hidden="true"
        className="overflow-visible"
      >
        {/* Sun rays: spin away and fade out in dark mode. */}
        <g
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          className="transition-[transform,opacity] duration-500 ease-out"
          style={{
            transformOrigin: "12px 12px",
            transform: dark ? "rotate(90deg) scale(0.4)" : "none",
            opacity: dark ? 0 : 1,
          }}
        >
          <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
        </g>
        {/* The disc: a small sun in light mode; grows and has a bite taken out for the moon. */}
        <mask id="theme-toggle-moon">
          <rect width="24" height="24" fill="white" />
          <circle
            cx="16.5"
            cy="7.5"
            r="6"
            fill="black"
            className="transition-transform duration-500 ease-out"
            style={{ transform: dark ? "none" : "translate(9px, -9px)" }}
          />
        </mask>
        <circle
          cx="12"
          cy="12"
          r="8"
          fill="currentColor"
          mask="url(#theme-toggle-moon)"
          className="transition-transform duration-500 ease-out"
          style={{ transformOrigin: "12px 12px", transform: dark ? "none" : "scale(0.56)" }}
        />
      </svg>
    </button>
  );
}
