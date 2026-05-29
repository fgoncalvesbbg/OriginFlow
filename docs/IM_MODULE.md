# Instruction Manual (IM) Module

## Overview

The Instruction Manual module enables admins to build reusable multi-language content templates and allows project managers or suppliers to generate product-specific PDF manuals from those templates. It covers the full lifecycle: template authoring → conditional content configuration → per-project customization → PDF generation → document storage.

---

## Table of Contents

1. [Architecture](#architecture)
2. [Data Model & Types](#data-model--types)
3. [Database Schema](#database-schema)
4. [Services Layer](#services-layer)
5. [Pages & UI/UX](#pages--uiux)
   - [IM Dashboard](#im-dashboard)
   - [Template Editor](#template-editor)
   - [Project IM Generator](#project-im-generator)
6. [PDF Rendering Pipeline](#pdf-rendering-pipeline)
7. [Conditional Logic](#conditional-logic)
8. [Multi-Language Support](#multi-language-support)
9. [Placeholder System](#placeholder-system)
10. [Styling & Theming](#styling--theming)
11. [Storage & File Handling](#storage--file-handling)
12. [Routing](#routing)
13. [Environment Variables](#environment-variables)
14. [Key Workflows](#key-workflows)

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  ADMIN LAYER                                                    │
│  IMDashboard → IMTemplateEditor                                 │
│  (one template per product category)                            │
└────────────────────────┬────────────────────────────────────────┘
                         │ defines
┌────────────────────────▼────────────────────────────────────────┐
│  DATA LAYER (Supabase)                                          │
│  im_templates ──── im_sections (hierarchical, per-lang HTML)    │
│  project_ims (draft / generated, per-project instance)          │
└────────────────────────┬────────────────────────────────────────┘
                         │ consumed by
┌────────────────────────▼────────────────────────────────────────┐
│  PROJECT LAYER                                                  │
│  ProjectIMGenerator (form fill) → PDF → project_documents      │
└─────────────────────────────────────────────────────────────────┘
```

---

## Data Model & Types

**File:** [src/types/im.types.ts](../src/types/im.types.ts)

### `IMMasterLayoutName`

Union type controlling page-level layout in the document:

| Value | Description |
|-------|-------------|
| `cover` | Cover page layout |
| `chapter` | Chapter opener |
| `body` | Standard content page |
| `appendix` | Appendix layout |
| `end` | Back/end page |

### `IMMasterPageOverride`

Per-layout visual overrides stored inside `IMTemplateMetadata.masterPages`:

```typescript
interface IMMasterPageOverride {
  background?: string;           // URL, CSS gradient, or hex color
  iconStrip?: string;            // HTML string rendered as icon strip
  footerVariant?: 'default' | 'minimal' | 'none' | string;
}
```

### `IMTemplateMetadata`

All branding and document settings for a template, stored as JSONB in `im_templates.metadata`:

```typescript
interface IMTemplateMetadata {
  pageSize: 'a4' | 'letter' | 'a5';
  primaryColor: string;               // Hex, e.g. "#0f172a"
  coverImageUrl?: string;             // Background image for cover page
  companyLogoUrl?: string;            // Logo shown on cover
  companyName?: string;               // Used in copyright and cover footer
  backPageContent?: string;           // Free HTML for the end page
  footerText?: string;                // Default running footer
  fontFamily?: string;                // e.g. "Roboto", "Inter"
  masterPages?: Partial<Record<IMMasterLayoutName, IMMasterPageOverride>>;
  sectionLayoutMap?: Record<string, IMMasterLayoutName>;
}
```

The `sectionLayoutMap` maps section IDs (or type aliases like `type:section`, `type:subsection`, `default`) to a `IMMasterLayoutName`.

### `IMTemplate`

A template is always tied to a single product category (`categoryId`):

```typescript
interface IMTemplate {
  id: string;                  // UUID
  categoryId: string;          // FK: categories_l3
  name: string;
  languages: string[];         // e.g. ['en', 'de', 'fr']
  isFinalized: boolean;
  finalizedAt?: string;        // ISO 8601
  metadata?: IMTemplateMetadata;
  updatedAt?: string;
  lastUpdatedBy?: string;      // User email
}
```

There is a **one-to-one relationship** between a category and a template.

### `IMSection`

A section is the atomic content unit. Sections form a tree via `parentId`. Each section stores its content per language code as raw HTML:

```typescript
interface IMSection {
  id: string;                         // UUID
  templateId: string;
  parentId?: string | null;           // null = top-level section
  title: string;
  order: number;                      // Sort order within the same parent
  isPlaceholder: boolean;             // True = stub, content filled by user at generation time
  content: Record<string, string>;    // { 'en': '<p>...</p>', 'de': '...' }
  conditionFeatureId?: string | null; // Attribute UUID, or 'manual' for checkbox toggle
  conditionLabel?: string | null;     // Expected attribute value, e.g. "Yes", "110V"
  isFinal?: boolean;
  completedLanguages?: string[];
}
```

### `ProjectIM`

One instance per project, persisting the user's form inputs and generation status:

```typescript
interface ProjectIM {
  id: string;                            // UUID
  templateId: string;
  placeholderData: Record<string, string>; // See Placeholder System section
  status: 'draft' | 'generated';
  updatedAt: string;
}
```

---

## Database Schema

**Migration file:** [db_migrations/46_add_im_module_tables.sql](../db_migrations/46_add_im_module_tables.sql)

### `public.im_templates`

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` | PK, auto-generated |
| `category_id` | `text` | FK → `categories_l3(id)` ON DELETE CASCADE |
| `name` | `text` | Template name |
| `languages` | `text[]` | Default: `'{en}'` |
| `is_finalized` | `boolean` | Default: `false` |
| `finalized_at` | `timestamptz` | Nullable |
| `metadata` | `jsonb` | `IMTemplateMetadata` shape, default `'{}'` |
| `last_updated_by` | `text` | User email |
| `updated_at` | `timestamptz` | Auto-set |

### `public.im_sections`

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` | PK |
| `template_id` | `uuid` | FK → `im_templates(id)` ON DELETE CASCADE |
| `parent_id` | `uuid` | FK → `im_sections(id)` ON DELETE CASCADE (self-referencing) |
| `title` | `text` | Section heading |
| `order` | `integer` | Sort order, default `0` |
| `is_placeholder` | `boolean` | Default `false` |
| `content` | `jsonb` | `{ langCode: htmlString }`, default `'{}'` |
| `condition_attribute_id` | `text` | Nullable; maps to `condition_feature_id` in TypeScript |
| `condition_value` | `text` | Nullable; maps to `condition_label` in TypeScript |
| `created_at` | `timestamptz` | Auto-set |

> **Note:** The DB column name is `condition_attribute_id` / `condition_value`, while the TypeScript type uses `conditionFeatureId` / `conditionLabel`. The service layer maps between these.

### `public.project_ims`

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` | PK |
| `project_id` | `uuid` | FK → `projects(id)` ON DELETE CASCADE |
| `template_id` | `uuid` | FK → `im_templates(id)` |
| `status` | `text` | `'draft'` or `'generated'` |
| `placeholder_data` | `jsonb` | All form inputs, conditions, visibility overrides |
| `updated_at` | `timestamptz` | Auto-set |

### Row-Level Security

All three tables have RLS enabled. Policies grant full access (`SELECT`, `INSERT`, `UPDATE`, `DELETE`) to any `auth.role() = 'authenticated'` user.

---

## Services Layer

**Location:** [src/services/im/](../src/services/im/)

All services use the Supabase client from `src/services/core/supabase.client` and are gated on `isLive` (returns empty data in dev/mock mode).

### `im-template.service.ts`

| Function | Description |
|----------|-------------|
| `getIMTemplates()` | Fetch all templates |
| `getIMTemplateById(id)` | Fetch single template by UUID |
| `getIMTemplateByCategoryId(categoryId)` | Fetch the template for a given category (one-to-one) |
| `createIMTemplate(categoryId, name)` | Insert new template (languages default to `['en']`) |
| `updateIMTemplate(id, updates)` | Patch any combination of fields; always updates `updated_at` |

### `im-section.service.ts`

| Function | Description |
|----------|-------------|
| `getIMSections(templateId)` | Fetch all sections for a template (unsorted; client sorts by `order`) |
| `saveIMSection(section)` | Upsert — auto-generates UUID if no `id` provided |
| `deleteIMSection(id)` | Hard delete; cascades to child sections via the DB FK |

### `project-im.service.ts`

(Accessed via the central `src/services/index.ts` re-export)

| Function | Description |
|----------|-------------|
| `getProjectIM(projectId)` | Fetch the saved instance for a project |
| `saveProjectIM(projectId, templateId, placeholderData, status)` | Upsert instance |
| `deleteProjectIM(projectId)` | Hard delete the instance |

### `im-print-renderer.ts`

Pure rendering logic — no Supabase calls.

| Export | Description |
|--------|-------------|
| `buildIMPrintDocument(params)` | Returns a complete `<!doctype html>` string ready for iframe injection or printing |
| `renderProjectIMPdf(params)` | Orchestrates iframe injection → html2canvas → jsPDF → `Blob` |

---

## Pages & UI/UX

### IM Dashboard

**Route:** `/im`  
**File:** [src/pages/im/IMDashboard.tsx](../src/pages/im/IMDashboard.tsx)  
**Access:** Admin only (protected route)

The dashboard presents a card grid — one card per product category. Each card displays:

- Category name
- Template status badge: **Active** (indigo) or **Finalized** (emerald)
- Finalization date (if finalized)
- **Edit Template** link → navigates to Template Editor
- **Mark Final / Reopen** toggle button
- **Create Template** button (shown when no template exists for the category)

Template creation immediately redirects to the editor. All data loads in parallel with a 10-second timeout guard.

---

### Template Editor

**Route:** `/im/template/:categoryId`  
**File:** [src/pages/im/IMTemplateEditor.tsx](../src/pages/im/IMTemplateEditor.tsx)  
**Access:** Admin only (protected route)

The most complex UI in the module. It is a three-panel layout:

#### Left Panel — Section Tree

- Lists all sections for the template in hierarchical order
- Each section has:
  - Title field (inline edit)
  - Up/Down reorder buttons
  - Layout selector (`chapter`, `body`, `appendix`, etc.)
  - Delete button (with confirmation modal)
  - **Placeholder** toggle (marks section as user-fill)
  - **Condition** toggle (makes chapter conditional on an attribute value)
- **+ Add Section** and **+ Add Subsection** buttons
- **Asset Upload** panel for uploading images to use in content

#### Main Panel — Rich Text Editor

The editor is a custom block-based system (`SimpleRichTextEditor`) that serializes to/from HTML. Each section's content is edited independently per language tab.

**Block Types:**

| Block | Description |
|-------|-------------|
| `paragraph` | Standard prose |
| `heading` | H1, H2, H3 with primary-color styling |
| `callout` | Warning / Caution / Electric / Info with ISO icons |
| `image` | Embedded image (base64 or URL) |
| `table` | Editable rows/columns |
| `conditional` | Inline conditional text block |
| `legacy_html` | Pass-through for pre-existing raw HTML |

**Toolbar Actions:**

- Bold / Italic / Underline (via `document.execCommand`)
- Insert Placeholder (text or image type)
- Insert Condition block
- Insert Callout block (warning, caution, electric, info)
- Insert Table
- AI Translate (via Google Gemini)

**Language Tabs:** en · de · fr · es · it · pt · nl · pl · zh · ja · tr · ru  
Only languages enabled on the template are shown. New languages can be added from the Settings modal.

**AI Translation:** The "Translate with AI" button sends the English HTML content to `gemini-3-flash-preview` with instructions to translate while preserving all HTML tags, placeholder chips, and condition elements. Requires `VITE_GEMINI_API_KEY`.

#### Settings Modal

Opened via the gear icon. Fields:

| Section | Fields |
|---------|--------|
| Branding | Company name, company logo URL, cover image URL |
| Appearance | Primary color (color picker), font family dropdown, page size |
| Document | Footer text, back page HTML content |
| Languages | Multi-select checkbox list for all 12 supported languages |

Settings are saved by calling `updateIMTemplate`.

#### Conditional Chapters UI

When a section has the **Conditional** flag set, an additional configuration row appears:

- **Feature selector**: dropdown of all category attributes
- **Condition value**: input for the expected value (supports exact match, boolean, or range strings like `"10-50"`)
- Special value `manual` can be set to make the condition a manual checkbox toggle in the generator (not tied to any attribute).

---

### Project IM Generator

**Route:** `/project/:projectId/im-generator`  
**File:** [src/pages/im/ProjectIMGenerator.tsx](../src/pages/im/ProjectIMGenerator.tsx)  
**Access:** Authenticated users (project managers, suppliers)

Two-column layout: configuration on the left, live A4 preview on the right.

#### Left Panel — Configuration

**Template Selection** (only shown when no draft exists):
- Dropdown of all available finalized templates
- On selection, loads sections and auto-matches attribute conditions from submitted project data

**Cover Page Customization:**
- Manual title override (defaults to project name)
- Subtitle override (defaults to "INSTRUCTION MANUAL")
- Custom logo image upload
- Custom cover image upload
- Custom footer text

**Section Visibility:**
- Each top-level section with a condition shows a toggle:
  - **Attribute conditions**: pre-matched from project's submitted attribute values; user can override
  - **Manual conditions**: unchecked by default; user must enable
- Visibility override keys stored as `secvis_<sectionId>` in `placeholderData`

**Placeholder Inputs:**
- Text placeholders → textarea
- Image placeholders → file upload (stored as base64 data URL)
- Shows a completion counter `X / Y filled`

#### Right Panel — Live Preview

- Real-time A4-proportioned preview container
- Language selector (tabs for enabled languages)
- Status badge: **Ready to Generate** / **Incomplete** (based on whether required placeholders are filled)
- Interactive overlay:
  - Click a text placeholder → opens inline text edit modal
  - Click an image placeholder → opens file upload modal
- Conditional sections shown with an exclusion badge when toggled off

#### Actions

| Action | Behaviour |
|--------|-----------|
| **Save Draft** | Calls `saveProjectIM` with `status: 'draft'`; persists all form data |
| **Delete Draft** | Confirmation modal → `deleteProjectIM`; resets all state |
| **Generate PDF** | Calls `renderProjectIMPdf`, uploads blob to Supabase storage, creates project document record with `status: APPROVED` |
| **Export Data → JSON** | Downloads `placeholder_data` as formatted JSON |
| **Export Data → XML** | Serializes placeholder data to XML and triggers download |

---

## PDF Rendering Pipeline

**File:** [src/services/im/im-print-renderer.ts](../src/services/im/im-print-renderer.ts)

### Standard Renderer (default)

1. **`buildIMPrintDocument`** produces a complete HTML document with:
   - Google Fonts `@import` for the selected font family
   - CSS `@page` rules for A4 (210mm × 297mm) with running headers/footers
   - Cover page (image + logo + title + subtitle + footer bar)
   - Table of Contents page (auto-generated from section order; pages numbered from 3)
   - One `<section class="im-page-section">` per content section
   - Optional end/back page from `metadata.backPageContent`

2. **`renderProjectIMPdf`** injects the HTML into a hidden off-screen `<iframe>` (`left: -10000px`), then:
   - Waits for the iframe to load
   - Waits for all `<img>` elements to complete loading
   - Waits for `document.fonts.ready`
   - Adds 500ms stabilization delay
   - Iterates each `.im-page-section` element and captures it with `html2canvas` (scale: 2, JPEG 96%)
   - Inserts each canvas as a page in `jsPDF` (`A4`, portrait)
   - Returns `pdf.output('blob')`

### Legacy Renderer (`VITE_IM_PDF_LEGACY_HTML2CANVAS=true`)

Captures the live DOM preview element directly rather than building a separate print document. Renders the full scrollable height as a single canvas then slices it into A4 pages. Enabled via env var, used as a fallback for environments where iframe injection is problematic.

### HTML Pre-Processing (`processSectionHtml`)

Before rendering, section HTML is pre-processed:

- **Condition nodes** (`.im-condition`): if the condition is active (truthy in `conditions` map), the node is replaced with its decoded `data-content` text; otherwise the node is removed entirely.
- **Text placeholder nodes** (`.im-placeholder[data-type=text]`): replaced with a plain `<span>` containing the submitted value, or empty string.
- **Image placeholder nodes** (`.im-placeholder[data-type=image]`): replaced with an `<img>` tag using the base64 data URL, or removed if no value.

---

## Conditional Logic

Sections can be conditionally included in the generated PDF based on attribute values from the project:

### Attribute Conditions

- `conditionFeatureId` = a `CategoryAttribute` UUID
- `conditionLabel` = the expected string value (case-sensitive exact match, or numeric range like `"10-50"`)
- At generation time, `ProjectIMGenerator` fetches `getAttributeRequestsByProject(projectId)` to collect submitted attribute values
- Auto-matching sets `conditions[sectionId] = true` if the submitted value equals `conditionLabel`
- The user can manually override any auto-matched condition

### Manual Conditions

- `conditionFeatureId = 'manual'`
- Not tied to any attribute — defaults to `false` (section excluded)
- User explicitly enables via a checkbox toggle in the generator

### Inline Condition Blocks

Separate from section-level visibility, individual paragraphs can contain inline condition spans:

```html
<span class="im-condition"
  data-id="cond-uuid"
  data-feature-id="attr-uuid"
  data-content="URI-encoded%20text"
  data-condition-value="Yes">
  [Condition: attr name = Yes]
</span>
```

These are resolved at render time using the same `conditions` map.

---

## Multi-Language Support

Languages are stored per section in the `content` JSONB field as `{ langCode: htmlString }`.

**Supported languages:**

| Code | Language |
|------|----------|
| `en` | English (default) |
| `de` | German |
| `fr` | French |
| `es` | Spanish |
| `it` | Italian |
| `pt` | Portuguese |
| `nl` | Dutch |
| `pl` | Polish |
| `zh` | Chinese (Simplified) |
| `ja` | Japanese |
| `tr` | Turkish |
| `ru` | Russian |

A template declares which languages it supports via the `languages: string[]` field. Only enabled languages are shown in the editor and generator.

**AI Translation:** The editor calls Google Gemini (`gemini-3-flash-preview`) with the English HTML content, instructing the model to translate while preserving all HTML structure, `data-*` attributes, class names, and placeholder/condition elements.

---

## Placeholder System

Placeholders are the mechanism by which template authors define fields that project users must fill in.

### In HTML Content

Placeholders are serialized as non-editable chip spans:

```html
<!-- Text placeholder -->
<span class="im-placeholder"
  data-id="uuid"
  data-type="text"
  data-label="Product Model Number">
  [Product Model Number]
</span>

<!-- Image placeholder -->
<span class="im-placeholder"
  data-id="uuid"
  data-type="image"
  data-label="Product Photo">
  [Image: Product Photo]
</span>
```

### In `placeholderData` (stored in `project_ims`)

The entire form state for a project instance is stored as a flat key-value map:

| Key Pattern | Value | Description |
|-------------|-------|-------------|
| `__cover_title` | string | Cover page title override |
| `__cover_subtitle` | string | Cover page subtitle override |
| `__custom_logo` | `data:image/...` | Base64 logo image |
| `__custom_cover_image` | `data:image/...` | Base64 cover image |
| `__custom_footer` | string | Footer text override |
| `__meta_language` | `en` / `de` / … | Selected output language |
| `<placeholder-uuid>` | string | User-entered text value |
| `<image-placeholder-uuid>` | `data:image/...` | Base64 image upload |
| `cond_<condition-uuid>` | `"true"` / `"false"` | Inline condition state |
| `secvis_<section-uuid>` | `"true"` / `"false"` | Section visibility override |

---

## Styling & Theming

### Theme Variables

**File:** [src/pages/im/styles/im-theme.ts](../src/pages/im/styles/im-theme.ts)

`getIMThemeVariables(metadata?)` returns a `CSSProperties` object with two CSS custom properties:

```css
--im-primary-color: #0f172a   /* default */
--im-font-family: Inter, Arial, sans-serif  /* default */
```

These are applied as inline `style` props on the preview container in both `IMTemplateEditor` and `ProjectIMGenerator`.

### Editor Content Styles

**File:** [src/pages/im/styles/im-content.css](../src/pages/im/styles/im-content.css)

Key classes used in section HTML:

| Class | Purpose |
|-------|---------|
| `.im-content` | Base content container |
| `.im-placeholder` | Non-editable chip for text/image fields |
| `.im-condition` | Non-editable dashed box for inline conditions |
| `.im-block-wrapper` | Outer container for callout blocks |
| `.im-block-warning` | Warning callout (orange) |
| `.im-block-caution` | Caution callout (yellow) |
| `.im-block-electric` | Electrical hazard callout (red) |
| `.im-block-info` | Info callout (blue) |
| `.im-block-icon` | ISO icon column inside callout |
| `.im-block-content` | Content column inside callout |
| `.im-table` | Styled table |
| `.im-inline-image` | Image injected at PDF render time |

### Print Document Styles

Styles are inlined in the HTML document built by `buildIMPrintDocument`. Key values:

- Page: A4 (210mm × 297mm), margins: top 18mm, right 15mm, bottom 20mm, left 15mm
- Cover: full-bleed image, flex column, zero margin
- Section title: bottom border in `primaryColor`, `font-size: 6.2mm`
- Body text: `font-size: 3.8mm`, `line-height: 1.6`, color `#1f2937`
- Running header: `font-size: 10px`, slate border bottom
- Page number: bottom-right, `font-size: 10px`
- TOC: dotted leader line between title and page number

---

## Storage & File Handling

### Images in Content

Images in section HTML are either:
- External URLs (referenced by `src`)
- Base64 data URLs (from the asset upload panel in the editor)

Base64 images are embedded directly in the HTML and survive as-is into the PDF.

### Project Instance Images

When a user uploads a logo, cover image, or image placeholder fill in `ProjectIMGenerator`, the file is read as a base64 data URL via `FileReader` and stored directly in `placeholderData` in Supabase (`project_ims.placeholder_data`). There is no separate storage bucket for these images — they live inside the JSONB column.

### Generated PDF

After PDF generation:

1. `renderProjectIMPdf` returns a `Blob` of the PDF
2. `uploadFile(projectId, file, fileName)` uploads it to the Supabase `documents` storage bucket under the project's folder
3. `addDocument(projectId, { url, name, status: DocStatus.APPROVED, ... })` creates a record in `project_documents`
4. The `ProjectIM` instance status is updated to `'generated'`

The uploaded PDF then appears in the project's document list like any other project document.

---

## Routing

| Path | Component | Guard |
|------|-----------|-------|
| `/im` | `IMDashboard` | Protected (admin) |
| `/im/template/:categoryId` | `IMTemplateEditor` | Protected (admin) |
| `/im/preview/:templateId` | `IMPreview` | Public |
| `/project/:projectId/im-generator` | `ProjectIMGenerator` | Protected |

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_GEMINI_API_KEY` | Optional | Google Gemini API key for AI translation in the template editor |
| `VITE_IM_PDF_LEGACY_HTML2CANVAS` | Optional | Set to `"true"` to use the legacy html2canvas renderer instead of the iframe-based pipeline |

---

## Key Workflows

### 1. Creating a Template

```
Admin → /im dashboard
  → "Create Template" on a category card
  → createIMTemplate(categoryId, name) [DB insert]
  → redirect to /im/template/:categoryId
  → Add sections, fill content per language
  → Configure metadata (Settings modal)
  → Set conditional sections if needed
  → "Mark Final" → updateIMTemplate({ isFinalized: true })
```

### 2. Generating a Manual

```
PM/Supplier → /project/:projectId/im-generator
  → getProjectIM(projectId) — loads existing draft or empty state
  → Select template from dropdown
  → getIMSections(templateId) — loads all sections
  → getAttributeRequestsByProject(projectId) — auto-match conditions
  → Fill form (text fields, image uploads, section toggles)
  → "Save Draft" → saveProjectIM(status: 'draft') [DB upsert]
  → "Generate PDF"
      → renderProjectIMPdf() — builds HTML doc, iframe → html2canvas → jsPDF → Blob
      → uploadFile() — upload Blob to Supabase Storage
      → addDocument() — create project_documents record
      → saveProjectIM(status: 'generated')
```

### 3. Translating Content

```
Admin (in Template Editor)
  → Select target language tab
  → Click "Translate with AI"
  → Google Gemini receives English HTML
  → Translated HTML returned, preserving placeholders/conditions/tags
  → Content saved on next section save (saveIMSection)
```

### 4. Section Condition Resolution (at PDF time)

```
For each section with conditionFeatureId:
  if conditionFeatureId === 'manual':
    include = conditions[sectionId] (user toggled)
  else:
    submittedValue = submittedAttrValues[conditionFeatureId]
    autoMatch = submittedValue === conditionLabel
    include = sectionVisibility[sectionId] ?? autoMatch
```

---

## Dependencies

| Library | Purpose |
|---------|---------|
| `html2canvas` | Rasterize DOM sections for PDF embedding |
| `jspdf` | Assemble rasterized pages into a PDF file |
| `@google/genai` | Gemini API for AI translation |
| `react-router-dom` | Navigation and route params |
| `lucide-react` | UI icons throughout |
| Supabase JS client | Database and storage operations |
