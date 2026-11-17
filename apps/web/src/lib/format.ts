/** 0 -> "0m", 59 -> "0m", 3720 -> "1h 2m", 90000 -> "25h 0m". Hours never roll into days. */
export function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(Math.max(0, totalSeconds) / 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** Display names for common VS Code language ids; falls back to the id itself. */
const LANGUAGE_NAMES: Record<string, string> = {
  typescript: "TypeScript",
  typescriptreact: "TSX",
  javascript: "JavaScript",
  javascriptreact: "JSX",
  python: "Python",
  rust: "Rust",
  go: "Go",
  java: "Java",
  kotlin: "Kotlin",
  csharp: "C#",
  cpp: "C++",
  c: "C",
  ruby: "Ruby",
  php: "PHP",
  swift: "Swift",
  lua: "Lua",
  html: "HTML",
  css: "CSS",
  scss: "SCSS",
  json: "JSON",
  markdown: "Markdown",
  shellscript: "Shell",
  sql: "SQL",
  yaml: "YAML",
};

export function languageName(id: string | null | undefined): string {
  if (!id) return "—";
  return LANGUAGE_NAMES[id] ?? id;
}

/** Share of `part` in `total` as a whole percentage, safe for total = 0. */
export function percent(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}
