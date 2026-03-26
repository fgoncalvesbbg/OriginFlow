# OriginFlow Full Application Documentation (Static Code Review)

## 1) Executive Summary

OriginFlow is a React + TypeScript + Supabase web platform designed for product launch operations. It combines project lifecycle tracking, supplier collaboration, compliance workflows, RFQ sourcing, and instruction-manual generation into one application.

Primary user groups:
- PM/Admin internal users (authenticated)
- External supplier users (token-based portal access)

Core architectural theme:
- Frontend is modularized by page + service domains
- Backend access is via Supabase tables + RPC functions
- Security is enforced primarily by RLS and tokenized portal flows

---

## 2) Product Scope and Use Cases

### Internal PM/Admin Use Cases
1. Create and manage projects.
2. Assign suppliers and track launch phases.
3. Manage document checklists and approvals.
4. Create and review compliance requests (TCF).
5. Create RFQs, collect supplier entries, award supplier quotes.
6. Build and maintain IM templates and generate project IM records.
7. Monitor deadlines, overdue items, and notifications.

### External Supplier Use Cases
1. Access project portals with secure token links.
2. Upload required launch documentation.
3. Access compliance portal and submit requirement responses using token + access code.
4. Access RFQ portal and submit quote entries.

---

## 3) Application Modules

## 3.1 Routing and App Shell
The app uses `HashRouter` and defines:
- Public routes (login + supplier portals + IM preview)
- Protected PM routes
- Admin routes wrapped with role checks
- Global providers for auth, toast, modal, and error boundary

It also triggers a compliance deadline check on app mount.

## 3.2 Auth and Access Control
- Auth context fetches Supabase session and profile.
- Portal route detection bypasses PM profile bootstrap to avoid auth-lock collisions.
- `ProtectedRoute` blocks unauthenticated access.
- `AdminRoute` restricts admin pages to role `ADMIN`.

## 3.3 Project Lifecycle Module
- Project CRUD operations
- Auto-seeding of launch steps and document templates at project creation
- Milestone persistence
- Supplier token access to project data through RPC

## 3.4 Supplier Module
- Supplier CRUD operations
- Supplier portal token retrieval
- Access code regeneration utility
- PM-supplier assignment model introduced in DB migrations

## 3.5 Compliance (TCF) Module
- Category/feature/requirement library
- Compliance request creation and status workflow
- Supplier secure verification via RPC (`get_compliance_request_secure`)
- Secure response submission via RPC (`submit_compliance_response_secure`)

## 3.6 Sourcing / RFQ Module
- RFQ creation and retrieval
- Supplier invite entries via per-entry token
- Supplier quote submission and award flow
- Supplier proposals enhancement and conversion support in schema/migrations

## 3.7 Instruction Manual (IM) Module
- IM templates by product category
- Hierarchical section model
- Multi-language content payloads
- Project IM instances with placeholder data and generation status

## 3.8 Shared Infrastructure and UX
- Notification center and polling
- Dashboard statistics service
- Error handling utilities
- Reusable hooks (`useAsync`, `useForm`, `useDebounce`, etc.)
- Toasts, modal stack, and error boundary

---

## 4) Technical Architecture

### Frontend Stack
- React 18
- TypeScript
- Vite
- React Router (HashRouter)
- Tailwind utility classes

### Backend Stack
- Supabase Postgres + Auth + RLS
- Supabase JS client with two clients:
  - `supabase` for authenticated PM/Admin sessions
  - `portalClient` for public/tokenized supplier flows

### Service Layer Structure
- Domain service folders exist (`project`, `supplier`, `compliance`, `sourcing`, `im`, etc.)
- A monolithic legacy `apiService.ts` still exists and is used heavily by pages

### Data Mapping Strategy
- Mapper utilities translate snake_case DB rows into frontend domain models

---

## 5) Database Structure

The database model spans several domains.

## 5.1 Core PLM Tables
- `profiles`
- `suppliers`
- `projects`
- `project_steps`
- `project_documents`
- `document_versions`
- `document_comments`
- `notifications`

## 5.2 Compliance Tables
- `categories_l3`
- `product_features`
- `compliance_requirements`
- `compliance_requests`

## 5.3 Instruction Manual Tables
- `im_templates`
- `im_sections`
- `project_ims`

## 5.4 Additional Tables Referenced in Services/Migrations
- `production_updates`
- `supplier_pm_assignments`
- `rfqs`
- `rfq_entries`
- `supplier_proposals`
- `category_attributes`
- `supplier_access_logs`

## 5.5 RPC Functions Referenced
- `get_project_by_token_secure`
- `get_projects_by_supplier_token`
- `submit_production_update`
- `get_compliance_request_secure`
- `submit_compliance_response_secure`

---

## 6) Security and Access Model

### Authenticated Access
The app relies on Supabase Auth and RLS policies to scope PM/Admin access.

### Public/Portal Access
Supplier portal flows rely on token routes and RPC validation for sensitive actions.

### Migration-Driven RLS Hardening
Migrations show an evolution from broad authenticated policies toward PM-scoped project/supplier/compliance access and dedicated assignment tables.

---

## 7) Modularity Assessment

### Strengths
- Strong domain-type separation in `src/types/*`
- Clear module-focused service directories
- Shared utility/mapping layer
- Reusable hook/component infrastructure

### Weaknesses
- `apiService.ts` duplicates logic already present in modular service files
- Most pages still consume `apiService.ts`
- High risk of behavior drift between duplicated implementations

---

## 8) Functional Data Flows

### Project Creation Flow
1. PM creates project.
2. Project row inserted with identifiers and metadata.
3. Default project steps inserted.
4. Default project document checklist inserted.

### Supplier Project Portal Flow
1. Supplier opens tokenized route.
2. Project data is resolved via secure token RPC.
3. Supplier uploads docs/comments.

### Compliance Supplier Flow
1. Supplier enters access code.
2. RPC validates token + code.
3. App loads requirements + categories.
4. Supplier submits structured responses through secure RPC.

### RFQ Flow
1. PM creates RFQ and supplier entry tokens.
2. Supplier accesses RFQ entry via token.
3. Supplier submits pricing/quote data.
4. PM awards RFQ entry.

---

## 9) Observed Bugs and Technical Risks

## 9.1 Auth Subscription Cleanup Leak Risk
In auth context, a cleanup function is returned from an async initializer but not directly from `useEffect`, risking missed unsubscribe on unmount.

## 9.2 Incorrect Project IM Delete Filter
`deleteProjectIM(projectId)` deletes with `.eq('id', projectId)` instead of `.eq('project_id', projectId)`.

## 9.3 Unimplemented Deadline Check
`checkComplianceDeadlines()` is invoked on app mount but currently empty.

## 9.4 Public Policy Exposure Risk
Schema/migration artifacts include permissive public policies (including `FOR ALL USING (true)` patterns) on portal-accessed tables. This should be hardened to token-scoped read + RPC-based writes.

## 9.5 Service Drift / Inconsistent Behavior
Examples of logic mismatch exist between `apiService.ts` and modular services (e.g., project insert payload differences like `created_by` handling), which may cause RLS or behavior inconsistencies.

---

## 10) Suggested Refactor Roadmap

1. Consolidate all page imports to modular services exposed from `src/services/index.ts`.
2. Deprecate and eventually remove duplicated logic from `src/services/apiService.ts`.
3. Normalize create/update payloads for RLS compatibility (especially `created_by` assumptions).
4. Harden public policies and route all sensitive portal writes through audited security-definer RPCs.
5. Implement real compliance deadline processing and notification generation.
6. Add integration tests for token-based portal flows and PM-scoped visibility.

---

## 11) Developer Experience Notes

- Repo includes guides for advanced hooks and UX patterns.
- Clear typing improves readability and refactor safety.
- Migration files document significant security and data-model changes.

---

## 12) Final Assessment

OriginFlow is feature-rich and structurally promising, with clear domain boundaries and mature workflow coverage for launch operations. The main quality gap is not feature completeness, but consistency and hardening:

- unify service layer
- close security policy gaps
- resolve a few concrete logic bugs

Once those are addressed, the platform has a strong base for production-grade scaling.
