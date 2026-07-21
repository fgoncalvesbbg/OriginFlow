---
name: OriginFlow PLM
description: Internal product-launch (PLM) platform — calm, precise, status-legible operational UI.
colors:
  primary: "#1a1f35"
  accent: "#3f5b73"
  accent-hover: "#324a5e"
  secondary: "#6b7280"
  muted: "#9ca3af"
  light: "#f9fafb"
  surface: "#ffffff"
  border: "#e5e7eb"
  success: "#047857"
  warning: "#b45309"
  danger: "#be123c"
  danger-solid: "#e11d48"
typography:
  headline:
    fontFamily: "Inter, system-ui, -apple-system, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Inter, system-ui, -apple-system, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.005em"
  body:
    fontFamily: "Inter, system-ui, -apple-system, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "Inter, system-ui, -apple-system, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "0.01em"
rounded:
  sm: "4px"
  md: "8px"
  lg: "12px"
  full: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.surface}"
    rounded: "{rounded.sm}"
    padding: "8px 16px"
    typography: "{typography.label}"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
    textColor: "{colors.surface}"
  button-danger:
    backgroundColor: "{colors.danger-solid}"
    textColor: "{colors.surface}"
    rounded: "{rounded.sm}"
    padding: "8px 16px"
  button-ghost:
    textColor: "{colors.secondary}"
    rounded: "{rounded.sm}"
    padding: "8px 16px"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.primary}"
    rounded: "{rounded.sm}"
    padding: "8px"
  card:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.lg}"
    padding: "24px"
  nav-item-active:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.surface}"
    rounded: "{rounded.lg}"
    padding: "12px 16px"
  status-badge:
    rounded: "{rounded.lg}"
    padding: "4px 10px"
    typography: "{typography.label}"
---

# Design System: OriginFlow PLM

## 1. Overview

**Creative North Star: "The Control Room"**

OriginFlow is the room a product manager runs many launches from: a calm, fixed dark navigation
rail framing a bright, uncluttered work canvas, where the status of every project, document, and
compliance request is legible at a glance. Nothing on the canvas competes for attention except the
thing that needs a decision. Color is spent almost entirely on *state* (what's done, what's blocked,
what's waiting) and on the single Steel Slate accent that marks the current selection or the primary
action. The personality is calm, precise, and trustworthy: the interface earns confidence by being
predictable and honest about state, not by impressing.

> **Accent note:** the shipped accent is **Steel Slate `#3f5b73`** (hover `#324a5e`), a muted
> corporate blue-gray chosen over a saturated indigo for a calmer, more professional feel. The
> Tailwind `indigo-*` and `blue-*` scales are deliberately remapped onto this steel ramp
> (`index.html`), so existing `indigo-*` / `blue-*` utility classes render as the steel accent.
> Where this doc says "indigo" as a *status* tone (in-progress / active), it now renders steel.

This system is built for internal power users who live here all day, so it favors **density with
hierarchy**: it will show a lot, but always ranked, so the eye lands on what matters first. Familiar
affordances are a feature, not a failure of imagination; a user fluent in Linear, Notion, or Stripe
should trust it on sight. The same vocabulary repeats screen to screen so the tool disappears into
the task.

It explicitly rejects two things. It is **not a generic SaaS template**: no identical
icon-heading-text card grids, no gradient hero-metric blocks, no tracked uppercase eyebrow above
every section. And it is **not consumer-flashy**: no decorative gradients, no animation for its own
sake, no playful illustration. This is operational software, not a campaign.

**Key Characteristics:**
- Dark fixed rail + bright canvas; a two-layer neutral system, not a flat single surface.
- Steel Slate accent reserved for action, selection, and active state, never decoration.
- A consistent four-hue status vocabulary (steel / emerald / rose / gray) used everywhere.
- Dense but ranked: small type, tight spacing, clear hierarchy.
- Inter only. No display face, no second family.

## 2. Colors

A restrained, near-neutral palette where saturated color almost always means *state* or *action*.

### Primary
- **Control-Room Ink** (#1a1f35): the deep charcoal-navy that anchors the system. It is the
  fixed sidebar background *and* the default body text color on the light canvas. Its weight is what
  makes the bright canvas read as calm rather than empty.

### Secondary
- **Action Steel** (#3f5b73, "Steel Slate"): the one accent. Primary buttons, the active nav item,
  current selection, focus rings, unread/active indicators. **Hover** deepens to Steel-Deep (#324a5e).
  Spend it sparingly; its rarity is what makes it read as "this is the action." (Exposed as the
  `accent` token and via the remapped `indigo-*` / `blue-*` scales.)

### Tertiary
The semantic state hues. Each appears as a tinted pill (`-50` background, `-700` text, `-200`
border), never as large fills:
- **Progress Emerald** (#047857): completed, approved, uploaded, success.
- **Blocked Rose** (#be123c, solid #e11d48): blocked, rejected, cancelled, destructive actions, overdue.
- **Pending Amber** (#b45309): warnings, "needs value", awaiting input.

### Neutral
- **Canvas** (#f9fafb): the light app background behind all content.
- **Surface** (#ffffff): cards, top bar, panels, dropdowns; the raised reading surfaces.
- **Border** (#e5e7eb): hairline dividers and container edges.
- **Refined Gray** (#6b7280) / **Soft Gray** (#9ca3af): secondary and muted text, icon defaults,
  inactive nav labels (on the dark rail these sit at gray-400 and brighten to white on hover).

### Named Rules
**The State-Not-Decoration Rule.** Saturated color is earned by meaning. If a color isn't carrying a
status (emerald/rose/amber) or marking action/selection (indigo), it is gray. No color is placed for
flavor.

**The Color-Plus-Shape Rule.** Status is *never* conveyed by color alone. Every status pill pairs its
hue with a text label (and, where space allows, an icon), so the four states are distinguishable
without color vision.

## 3. Typography

**Body & Display Font:** Inter (with system-ui, -apple-system, sans-serif fallbacks).
**Label/Mono Font:** none distinct — Inter at small sizes and heavier weights carries labels.

**Character:** One well-tuned grotesque doing everything. Hierarchy comes from weight and size
contrast, not from a second face. This is deliberate: a product UI with this many labels, values,
and table cells reads as calmer with one voice.

### Hierarchy
- **Headline** (700, 1.5rem / `text-2xl`, line-height 1.2): page titles and primary section headers.
- **Title** (600, 1.125rem / `text-lg`, line-height 1.3): card headers, modal titles, panel headings.
- **Body** (400, 0.875rem / `text-sm`, line-height 1.5): the default for nearly all content and form
  fields. Cap running prose at 65–75ch; tables and dense panels may run wider.
- **Label** (600, 0.75rem / `text-xs`, line-height 1.4): badges, metadata, table column headers,
  button text, supporting captions.

### Named Rules
**The One-Voice Rule.** Inter only. No display serif, no second sans, no mono affectation. If a screen
feels like it needs a second typeface, it needs better weight/size hierarchy instead.

**The Sentence-Case Rule.** Headings and buttons are sentence case. Uppercase is reserved for short
≤4-word labels and never used for sentences.

## 4. Elevation

The system is **layered, not flat**: depth separates the fixed rail, the canvas, raised surfaces, and
floating overlays. Shadows are structural (they signal "this floats above that"), paired with hairline
borders for definition rather than used as ambient decoration. Radii stay modest: cards and panels at
12px, controls at 4–8px, pills/avatars fully round. Cards never exceed 16px corners.

### Shadow Vocabulary
- **Resting card** (`box-shadow: 0 1px 2px rgba(16,24,40,0.05)`, often just a `border`): cards and panels at rest.
- **Sticky bar** (`shadow` ≈ `0 1px 3px rgba(16,24,40,0.1)`): the top bar pinned over scrolling content.
- **Rail** (`shadow-lg`): the fixed sidebar's separation from the canvas.
- **Floating overlay** (`shadow-xl`): dropdowns, popovers, and modals lifting above everything.

### Named Rules
**The One-Border-Or-One-Shadow Rule.** A surface gets a hairline border *or* a soft shadow to define
it, not a 1px border *and* a wide blurred shadow on the same element. Pick the one that fits the layer.

**The Lift-On-Float Rule.** Elevation grows only as an element leaves the page plane (rest → sticky →
rail → overlay). Resting content stays low; don't shadow things that aren't floating.

## 5. Components

### Buttons
- **Shape:** gently rounded (4px); compact padding (8px 16px), `text-sm`/`text-xs` weight 500–600.
- **Primary:** Action Steel (#3f5b73) on white text; hover deepens to #324a5e.
- **Danger:** Blocked Rose solid (#e11d48) on white; hover #be123c. For destructive confirmations.
- **Ghost / Cancel:** no fill, Refined Gray (#6b7280) text, hover `background #f3f4f6`.
- **Focus:** visible focus ring in Action Steel; never remove the outline without replacing it.

### Status Badges (signature)
- **Style:** pill (12px radius), `text-xs` weight 500, tinted `-50` background + `-700` text + `-200`
  border. Four families: indigo (in-progress / under-review / active), emerald (completed / approved),
  rose (blocked / rejected / cancelled), gray (not-started / archived / neutral).
- **Rule:** always pair the hue with the text label (see The Color-Plus-Shape Rule).

### Cards / Containers
- **Corner Style:** 12px (`rounded-xl`). Never above 16px.
- **Background:** Surface white on the Canvas; padding 16–24px.
- **Definition:** a hairline Border (#e5e7eb) or a resting shadow, not both. No nested cards.

### Inputs / Fields
- **Style:** white background, 4px radius, 1px border. Default border `#d1d5db`; an unfilled/required
  field may use an amber border to signal "needs value".
- **Focus:** `ring-2` in Action Steel, border shifts to indigo. Always visible.
- **Error / Warning:** rose border + helper text for errors; amber for "needs value".

### Navigation (signature: the rail)
- **Style:** fixed 16rem dark rail (Control-Room Ink, #1a1f35), white wordmark, item rows at 12px
  radius, `text-sm` weight 500.
- **States:** active = Action Steel fill + white text + subtle shadow; inactive = Soft Gray text;
  hover = `background gray-800` + white text.
- **Mobile:** the rail is hidden below `md`; navigation collapses to a top-bar affordance.

## 6. Do's and Don'ts

### Do:
- **Do** reserve Action Steel (#3f5b73) for primary action, current selection, and active state.
  Everything non-active is gray.
- **Do** convey every status with hue **and** a text label (and icon where space allows), never color
  alone.
- **Do** keep card corners at 12px (`rounded-xl`) and control corners at 4–8px.
- **Do** define a surface with either a hairline border or a soft shadow, and pick elevation by layer
  (rest → sticky → rail → overlay).
- **Do** use Inter at heavier weights and larger sizes for hierarchy; sentence case for headings and
  buttons.
- **Do** give every interactive control all its states: default, hover, focus-visible, active,
  disabled, loading (shimmer skeletons), and error.
- **Do** keep motion to 150–250ms ease-out, used for state and feedback (toasts slide, menus scale,
  skeletons shimmer); honor `prefers-reduced-motion`.

### Don't:
- **Don't** ship the **generic SaaS template**: no identical icon-heading-text card grids, no gradient
  hero-metric blocks, no tracked uppercase eyebrow above every section.
- **Don't** go **consumer-flashy**: no decorative gradients, no gradient text, no animation for its own
  sake, no playful/sketchy illustration.
- **Don't** pair a 1px border with a wide (≥16px blur) drop shadow on the same element.
- **Don't** round cards/sections past 16px, and don't nest cards inside cards.
- **Don't** use a `border-left`/`border-right` color stripe as an accent on cards, list items, or
  alerts; use a full border, a tint, or a leading icon instead.
- **Don't** introduce a second typeface or a display font for UI labels, buttons, or data.
- **Don't** let muted gray text fall below 4.5:1 on its background (the most likely contrast failure
  here); bump toward Control-Room Ink before reaching for lighter gray.
- **Don't** reach for a modal as the first thought; exhaust inline and progressive disclosure first.
