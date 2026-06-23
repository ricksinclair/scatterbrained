# Scatterbrained — brand guide

**A second brain for the scatterbrained.** A personal, agent-maintained knowledge
graph you can *see* — scattered thoughts in, a navigable constellation out.

> Warm, literary, constellation-driven — scattered points that resolve into a
> connected map.

## Logo system — one system, three registers

The wordmark splits into **`scatter`** + **`brained`**, with contrast and an offset
baseline, so the mark itself is scattered-then-assembled (your eye does what the
product does). In most places, **the logo is the whole branding** — it stands alone.

| Register | Use | Asset |
|---|---|---|
| **Primary wordmark** | everywhere by default | [`logo-wordmark.svg`](logo-wordmark.svg) — ember `scatter` · teal node-dot · paper `brained`, offset baselines |
| **Mono** | one color / stamps / small / merch | [`logo-mono.svg`](logo-mono.svg) — solid `scatter` + outline `brained`, `currentColor` |
| **Hero (living)** | site hero, splash, loading | the wordmark's letters drift in *scattered* and settle into order (animate variant of the primary) |
| **Favicon / app-mark** | tabs, app icon, avatar | [`favicon.svg`](favicon.svg) — the three-dot **node cluster** (the constellation in miniature) |

**Rules:** lowercase always. Clear space = the height of one letter on all sides.
Min wordmark width ~96px. Don't recolor the two words the same; don't remove the
offset; don't set it in a sans for primary use.

## Palette

| Token | Hex | Role |
|---|---|---|
| ink | `#0b0d12` | primary background |
| ink-2 | `#10131a` | raised surface |
| paper | `#ece6d8` | primary text (warm parchment) |
| paper-dim | `#b6b2a7` | secondary text |
| muted | `#7e8492` | tertiary / captions |
| **ember** | `#ef9a5b` | primary accent — the "memory-trace" glow (`scatter`, links) |
| ember-dk | `#d77f42` | ember on light backgrounds |
| **teal** | `#79b4ab` | secondary accent — the node/connection (`brained` dot) |
| teal-dk | `#3f7a72` | teal on light backgrounds |
| line | `rgba(236,230,216,0.09)` | hairlines / faint grid |

On light backgrounds: text → ink, accents → ember-dk / teal-dk.

## Type

- **Fraunces** — display & headings & the wordmark (warm, literary serif).
- **Spectral** — body serif.
- **JetBrains Mono** — code, kickers, labels, the all-caps mono eyebrow.

> The SVGs reference the Fraunces stack; for final/portable logo files, outline the
> text to paths in a vector tool so they render without the webfont.

## Motif & voice

- **Motif:** the constellation — scattered glowing points resolving into a connected
  map (it *is* the product's force-graph). Use it as the hero, in dividers, and in
  loading states (scattered → gathered).
- **Voice:** warm, witty, self-aware, honest. It owns the name — *for* the
  scatterbrained, not a cold "AI memory infrastructure." Honest about what it is:
  a local-first observatory for your own knowledge.
