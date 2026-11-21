# Brand

**Version 1.** How ForkYou looks and sounds, for anyone building the web app, the extensions or
anything else with the name on it. The tokens live in
[`apps/web/src/app/globals.css`](../apps/web/src/app/globals.css) and the artwork in
[`apps/web/public/brand/`](../apps/web/public/brand/). The page designs will refine this; when they
change a rule, they change it here too.

## The idea

**Calm by default, playful when you win.** ForkYou is a tool developers keep open all day, so the
base is quiet: graphite, white, one accent, plain Geist. The fun lives in a thin layer on top: a
scoreboard for numbers, stickers for the things you earn, and a mascot for the moments that matter.
Students and working developers are both the audience: approachable, never childish.

## Logo

| File                                                        | Use                                                                                                                                                                                                        |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`logo.svg`](../apps/web/public/brand/logo.svg)             | The mark: a cyan flame with a clock in it. The flame is the energy (and its two tips the fork in the name); the clock is what ForkYou measures. A white die-cut edge makes it a sticker on any background. |
| [`logo-mono.svg`](../apps/web/public/brand/logo-mono.svg)   | One colour (`currentColor`), with the clock cut out. For places that allow one colour: a print, an embossed surface, a monochrome UI.                                                                      |
| [`apps/web/src/app/icon.svg`](../apps/web/src/app/icon.svg) | The favicon: thicker outline, bigger clock, no hands, so it still reads at 16 px.                                                                                                                          |

- The **wordmark** is `fork` in Bricolage Grotesque 800 followed by `you` in Instrument Serif
  italic in the accent colour: **fork*you***. "You" is the point.
- Use the mark at 24 px or more; below that, use the favicon. Keep clear space of a quarter of the
  mark's width around it.
- Don't recolour, outline, rotate past a slight tilt, or put it on a busy image.

## Colour

| Token                  | Light                | Dark                 | Role                                                                              |
| ---------------------- | -------------------- | -------------------- | --------------------------------------------------------------------------------- |
| `bg`                   | `#f6f8f9`            | `#0a0e12`            | Page                                                                              |
| `surface`, `surface-2` | `#ffffff`, `#eef3f5` | `#11171d`, `#151d24` | Cards, wells                                                                      |
| `border`               | `#e1e6ea`            | `#22303a`            | Hairlines                                                                         |
| `fg`, `muted`          | `#0c1116`, `#56616b` | `#e8eef2`, `#92a1ad` | Text                                                                              |
| `accent`               | `#0e7490`            | `#22d3ee`            | **You and your time**: links, primary buttons, your row, the clock                |
| `win`                  | `#fbbf24`            | `#fbbf24`            | **Wins**: streaks, personal bests, medals. Always a fill with `win-fg` text on it |
| `win-text`             | `#b45309`            | `#fbbf24`            | Amber as text, where it has to be                                                 |
| `led`                  | `#070a0d`            | `#070a0d`            | Scoreboard panels (`led-matrix`), dark in both themes                             |
| `danger`               | `#dc2626`            | `#f87171`            | Destructive actions and errors only                                               |

Every text colour meets 4.5:1 against the surfaces it's used on. Light-mode cyan text is the darker
`#0e7490` for that reason; the bright `#22d3ee` is for dark mode, the mark and glows. Don't add
colours: if a design needs one, it needs a token and a line in this table first.

## Type

| Role            | Font                    | Tailwind            | Rules                                                                                      |
| --------------- | ----------------------- | ------------------- | ------------------------------------------------------------------------------------------ |
| Reading         | Geist                   | `font-sans`         | Body, labels, buttons, everything that isn't one of the below                              |
| Code, commands  | Geist Mono              | `font-mono`         | Install commands, keys, technical values                                                   |
| Headlines       | Bricolage Grotesque 800 | `font-display`      | Page and section headings, tight tracking (`-0.04em`)                                      |
| One accent word | Instrument Serif italic | `font-serif italic` | At most one word per heading, in the accent colour: "Every minute in the editor _counts._" |
| Scores          | Geist Pixel             | `font-pixel`        | Times, ranks, streak counts, and nothing else. 14 px or larger                             |

All five are loaded with `next/font`, so they're self-hosted and the browser never calls Google.

## Motifs

- **The scoreboard.** Rankings and live figures sit on a dark LED panel (`led-matrix`) with pixel
  numbers; cyan glows for you (`glow-accent`), amber for wins (`glow-win`). It's dark in light mode
  too: a scoreboard is lit, not printed.
- **Stickers.** Anything you _earn_ or that represents ForkYou is a die-cut sticker: a white edge,
  ink outlines, flat fills (`sticker` adds the shadow). Badges, the streak flame and Ember are
  stickers. Ordinary UI isn't.
- **The progress underline.** One key word in a headline can sit on a bar that's partly filled,
  like a timer. Use it once per page at most.
- **The streak flame** ([`streak-flame.svg`](../apps/web/public/brand/streak-flame.svg)) is the
  logo's flame in warm colours: amber outside, cyan inside. It marks streaks and nothing else, so
  a streak never looks like the brand mark.

## Ember, the mascot

A chubby warm flame with a face (working name). Ember only appears when something happens to you,
never as decoration.

| File                                                            | When                                       |
| --------------------------------------------------------------- | ------------------------------------------ |
| [`ember-happy.svg`](../apps/web/public/brand/ember-happy.svg)   | Default: sign-in, the dashboard header     |
| [`ember-focus.svg`](../apps/web/public/brand/ember-focus.svg)   | While you're coding                        |
| [`ember-party.svg`](../apps/web/public/brand/ember-party.svg)   | A streak day, a badge earned               |
| [`ember-shades.svg`](../apps/web/public/brand/ember-shades.svg) | A personal best, a top-10 week             |
| [`ember-sleep.svg`](../apps/web/public/brand/ember-sleep.svg)   | Nothing tracked yet, empty states          |
| [`ember-sad.svg`](../apps/web/public/brand/ember-sad.svg)       | A streak just ended. Gentle, never shaming |

## Voice

Plain and calm, with a wink when you win. Short sentences, real numbers, no hype.

- Streak: "Five days in a row. Keep it going tomorrow."
- Rank: "You passed linus. You're #11 this week."
- Empty: "Nothing on the board yet. Open a file and start working."
- Error: "This API key was revoked. Create a new one in Settings."
- Never guilt people for a broken streak or a slow week, and never compare anyone to a named person
  except on the leaderboard itself.

## Motion

Motion is feedback, not decoration: a number that ticks up, a ring that fills, a sticker that pops
when you earn it. Keep it under a second, and turn it all off under `prefers-reduced-motion`.

## Regenerating the PNGs

The extension icon, the Apple touch icon and the social image are PNGs, because the Marketplace and
social sites don't take SVG. They're rendered from the SVGs above with headless Chrome. After
changing the logo, run:

```bash
bash apps/web/scripts/render-brand-pngs.sh
```

| File                                   | Size                    |
| -------------------------------------- | ----------------------- |
| `extensions/vscode/media/icon.png`     | 256 × 256, transparent  |
| `apps/web/src/app/apple-icon.png`      | 180 × 180, on `#0c1116` |
| `apps/web/src/app/opengraph-image.png` | 1200 × 630              |

It finds Chrome or Chromium on its own (set `CHROME=/path/to/chrome` otherwise). The social image
loads its fonts from Google Fonts, so it needs a network connection.
