# Product

## Register

product

## Users

**Primary: internal product managers and admins** (Klarstein staff) who run many concurrent
product launches day in, day out. Their context is operational and high-frequency: they live in
dashboards, jump between projects, track steps/documents/milestones, assign suppliers, and chase
compliance. They are power users who value density, speed, and knowing exactly where every launch
stands.

**Secondary: external suppliers** (factories/vendors) who enter through token-based portals to
submit quotes, compliance responses, product attributes, and documents. They are occasional users
in unfamiliar territory and need clarity and light guidance rather than density.

## Product Purpose

OriginFlow is an internal PLM (product launch / lifecycle) platform. It coordinates a product from
RFQ through development to production: projects and steps, documents, supplier sourcing and RFQs,
compliance requirements and responses, product attributes/SKUs, and the generation of publish-ready
Information Memoranda (instruction manuals).

Success is a PM running many launches without losing the thread: status is legible at a glance,
navigation is fast, the next action is obvious, and nothing fails silently. The interface should
optimize for **speed and clarity at scale**.

## Brand Personality

Calm, precise, trustworthy. The tool should feel quiet and dependable: structured information,
restrained color, confidence through clarity rather than flourish. Voice is plain and direct;
labels say exactly what will happen. It earns trust the way good operational software does, by
being predictable and honest about state, not by impressing.

## Anti-references

- **Generic SaaS template.** No identical icon-heading-text card grids, no gradient hero-metric
  blocks, no tracked uppercase eyebrows above every section, no Bootstrap/AI-default scaffolding.
- **Consumer-flashy / marketing-y.** No big decorative gradients, no animation for its own sake, no
  playful illustration. This is an operational tool, not a campaign.
- (Implied) Not legacy-enterprise clutter either: density is welcome, but it must always be ranked
  by hierarchy, never a gray wall of undifferentiated controls.

## Design Principles

1. **The tool disappears into the task.** Earned familiarity over novelty; standard affordances for
   standard jobs. A user fluent in Linear/Notion/Stripe should trust it on sight.
2. **Status at a glance.** A PM should know where a launch stands, and what to do next, without
   digging. Hierarchy and state carry the load.
3. **Trust through precision.** Honest, explicit feedback for every action; clear loading/empty/
   error states; never a silent failure. (The service layer now surfaces errors rather than
   swallowing them; the UI should match that honesty.)
4. **Density with hierarchy.** Show a lot when power users need it, but always rank it so the eye
   lands on what matters first. Density is not the same as clutter.
5. **Guide the occasional user.** External suppliers in portals get the clarity, defaults, and
   guidance that internal power users don't need, without dumbing down the internal surfaces.

## Accessibility & Inclusion

Target **WCAG 2.1 AA**. Body text ≥4.5:1 contrast, large/bold text ≥3:1, including placeholders.
Honor `prefers-reduced-motion` with a non-animated alternative for every transition. Never convey
status by color alone: pair it with an icon, label, or shape (important for the many
status/compliance states across the app). Full keyboard operability for all interactive controls.
