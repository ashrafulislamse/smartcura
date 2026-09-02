# SmartCura Brand Kit

Hand-built vector source of truth for every SmartCura logo and app icon. All geometry is
authored by hand on a 1024×1024 grid with pure Bézier/arc math — no AI raster generation —
so every asset is infinitely scalable, recolorable and print-ready. Open
[`preview.html`](preview.html) in a browser to see the whole kit rendered at multiple sizes
on light and dark surfaces.

## The idea

**Care, watched over by intelligence.** The master mark is an open heart (cura = care)
whose outline pauses while a live ECG pulse (smart = connected monitoring) passes through
it — monitoring that never interrupts care. Each product keeps the family language
(round-capped strokes, one accent pulse element, deep gradient tile) but carries its own
meaning:

| Product | Glyph | Meaning | Tile |
|---|---|---|---|
| Patient app | Heart + ECG | Your health, live and cared for | Medical blue `#2563EB` |
| Doctor app | Stethoscope + mint cross | Clinical authority at the bedside | Doctor teal `#0F766E` |
| Driver app | Medical pin + dotted route + origin dot | Urgent transport, dispatched end-to-end | Emergency red `#DC2626` |
| Admin portal | Shield + pulse + analytics bars | Secure oversight of the whole platform | Command blue `#1E40AF` |
| Monogram badge | Geometric `S` + `C` + pulse tick | Avatars, social, splash, merch | Navy `#1E40AF → #172554` |

## Assets

| File | Use |
|---|---|
| `logos/smartcura-mark.svg` | Master mark, brand colors, transparent background |
| `logos/smartcura-mark-white.svg` | Master mark, white monochrome (dark surfaces, overlays) |
| `logos/smartcura-mark-black.svg` | Master mark, ink monochrome (print, single-color) |
| `logos/smartcura-logo-horizontal.svg` | Horizontal lockup, light surfaces (headers, README) |
| `logos/smartcura-logo-horizontal-white.svg` | Horizontal lockup, dark surfaces |
| `logos/smartcura-logo-stacked.svg` | Stacked lockup + tagline (splash, decks, store banners) |
| `logos/sc-monogram.svg` | SC monogram badge (avatars, social, loading) |
| `icons/patient-app.svg` | Patient app icon (full-bleed tile) |
| `icons/doctor-app.svg` | Doctor app icon (full-bleed tile) |
| `icons/driver-app.svg` | Driver app icon (full-bleed tile) |
| `icons/portal-app.svg` | Admin portal icon (full-bleed tile) |
| `icons/favicon.svg` | Favicon / small-size mark (rounded tile, thicker strokes) |

App-icon tiles are shipped as **full-bleed squares**: iOS and Android apply their own
masks, and `preview.html` shows them with the iOS squircle radius. Glyphs sit inside the
Android adaptive-icon safe zone (~66% of canvas), so no OS mask crops them.

## Color system

| Role | Value |
|---|---|
| Medical Blue (brand primary) | `#2563EB` |
| Pulse cyan on light surfaces | `#06B6D4` |
| Pulse cyan on dark tiles | `#67E8F9` |
| Doctor teal (platform) | `#0F766E`, accent cross `#99F6E4` |
| Driver red (platform) | `#DC2626`, origin dot `#FBBF24` |
| Portal / monogram navy | `#1E40AF → #172554` gradient |
| Ink (text, mono logo) | `#0F172A` |

Tiles use a 135° linear gradient (light top-left → deep bottom-right) plus a soft radial
highlight for depth. Never add drop shadows, bevels or texture to the glyphs.

## Construction rules (keep these when editing)

- Canvas 1024×1024; stroke weights 54–62 for marks, 92 for the monogram, `round` caps/joins.
- The ECG always passes through the heart's open band (y = 540) without touching strokes.
- One accent element per icon (pulse, cross, route, bars). Everything else is white.
- Wordmarks are live text (`Inter, Poppins, 'Segoe UI', system-ui`) — convert to outlines
  before print/merch export.

## Do / don't

- ✅ Use on brand tiles or plain surfaces with ≥ 1 glyph-stroke of clear space.
- ✅ Mono versions for single-color contexts (engraving, fax, one-color print).
- ❌ Don't recolor the pulse to red, don't rotate the mark, don't outline or shadow glyphs.
- ❌ Don't place the brand-color mark on mid-blue backgrounds (use the white mono there).

## Exporting rasters (when a platform needs PNG)

The SVGs are the source; `tools/brand/export-icons.mjs` rasterizes them into every
platform target of the three Flutter apps (Android mipmaps + splash glyph, iOS app icon
and LaunchImage sets, web PWA icons + favicon, macOS icons, Windows `.ico`). Run:

```text
npm install --prefix tools/brand     # once; installs sharp
node tools/brand/export-icons.mjs    # rewrites all 111 rasters
```

Rerun after any change to an SVG in this folder. Portal surfaces consume the SVGs
directly: `apps/web-portal/public/{favicon.svg, logo-mark.svg, logo-mark-white.svg}`
plus `icons` metadata in `src/app/layout.tsx`.
