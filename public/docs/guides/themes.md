# Themes

The Studio ships **six themes, each with a dark and a light mode** — twelve
looks, one design system. Everything re-themes live: the constellation canvas,
panels, syntax highlighting, charts, and even already-rendered PlantUML
diagrams (they're re-colored in place, no re-render).

## The themes

| Theme | Character |
|---|---|
| **Scatterbrained** | The brand look — warm ember, teal and gold on ink; paper-warm in light mode |
| **Observatory** | Deep indigo night sky; the original constellation feel |
| **Nebula** | Violet and magenta, cosmic |
| **Terminal** | Green-on-black phosphor; calm sage in light mode |
| **Solar** | Amber and ember, warm desert tones |
| **Slate** | Neutral graphite — the quiet, get-work-done option |

## Switching

- **Settings ▸ Appearance** — pick theme and mode (dark / light / follow
  system).
- Or press **⌘K** and type the theme's name.

Your choice persists locally in the browser.

## How it works (for customizers)

Themes are **pure data**: `public/lib/themes.js` holds six configs of color
tokens (background, ink, accent, panel surfaces, per-label node palettes,
syntax palettes). The engine in `theme-ui.js` applies a config as CSS custom
properties, so every surface — DOM and canvas alike — reads the same tokens.

To add or tweak a theme, edit the config table in `themes.js`; there is no
build step, so a reload shows it. Keep the shape identical to the existing
entries (each theme needs both a `dark` and a `light` config) and the whole
app, including diagrams and charts, follows automatically.
