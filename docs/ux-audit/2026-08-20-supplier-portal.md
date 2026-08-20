# OriginFlow audit — Supplier portal — 2026-08-20

**Scope chosen:** J13–J17 (the five supplier-facing token portals) — the user named "Supplier portal"; the module turned out to be five separate surfaces sharing one role, so the trace covers all five rather than picking one.
**Traced:** `/supplier-dashboard/:token` · `/supplier/:token` · `/attribute-request/:token` · `/compliance/supplier/:token` · `/sourcing/supplier/:token` → access-code gate → `portalDb.rpc` SECURITY DEFINER routines → submit paths → PM-side review in `ComplianceRequestDetail` / `RFQDetail` / `ProjectDetail`.
**Delta vs last report on this scope:** no prior report. (`docs/ux-audit/` holds only `2026-08-17-im-assembly.md`.)

**Volume caveat, stated up front.** I queried the live Supabase project (`ecueltibpmpnhnaxlskx`, read-only): **3 suppliers, 8 projects, 66 project documents, 1 attribute request, 0 RFQs, 0 RFQ entries, 0 compliance requests.** This module has never carried real traffic. So "cost per run × frequency" is not measurable here, and I have ranked by **what breaks on first real use** instead. Three of the six ladder-A findings are things a supplier would hit in the first ten minutes.

---

## 1. Verdict in three lines

A supplier who is handed a portal link today can: read their document list, fill an attribute form, and submit a TCF declaration — but **cannot confirm an ETD (throws every time), cannot actually upload a document from the dashboard (the upload is a simulation), and cannot recover a rejected declaration or a half-finished one**. The first thing to fix is [A1](#a1-supplier-etd-confirmation-and-delay-reporting-cannot-write-at-all) and [A2](#a2-the-dashboard-document-upload-stores-nothing): both are silent-or-misleading write failures on compliance-adjacent data, and both are S-sized. What is already working and should not be touched: the server-side security model — the SECURITY DEFINER routines, the `portal_rl_guard` brute-force lockout, the self-approval block in `submit_compliance_response_secure`, and the private-bucket signed-URL path in `SupplierPortal.openDoc` are all sound, and the live definitions match the repo migrations.

---

## 2. Ladder A — defects visible in code

### A1. Supplier ETD confirmation and delay reporting cannot write at all
- **Role / job / frequency:** Supplier · J17 · prompted at ETD−45 / −30 / −16 days
- **Evidence:** [SupplierDashboard.tsx:459-466](src/pages/SupplierDashboard.tsx#L459-L466) and [SupplierDashboard.tsx:481-490](src/pages/SupplierDashboard.tsx#L481-L490) call `saveProductionUpdate({ …, isSupplierUpdate: true })` with **one argument**. [production.service.ts:68-73](src/services/manufacturing/production.service.ts#L68-L73) throws `"Supplier production updates require portal authorization."` whenever `isSupplierUpdate` is true and the second `portalAuth` argument is absent. Both call sites omit it, so both throw unconditionally. The PM-side call at [ProjectDetail.tsx:506](src/pages/ProjectDetail.tsx#L506) takes the authenticated branch and is unaffected.
- **Also in the same widget:** the Report Delay form has no required-field validation — neither the date input nor the reason select carries `required`, and `handleReportDelay` has no guard ([SupplierDashboard.tsx:1656-1704](src/pages/SupplierDashboard.tsx#L1656-L1704)). With an empty date the first error raised is `"New ETD date is required"` from [production.service.ts:62-64](src/services/manufacturing/production.service.ts#L62-L64), which the catch block replaces with the generic `"Failed to report delay. Please try again."` — the supplier is never told which field is wrong.
- **Consequence:** The supplier clicks "Confirm On Time", gets a red toast, retries, gets the same toast. There is no path to success. The PM's ETD-drift signal — the entire point of the −45/−30/−16 day check at [SupplierDashboard.tsx:285-291](src/pages/SupplierDashboard.tsx#L285-L291) — never arrives, and the PM has no way to distinguish "supplier ignored us" from "the button is broken".
- **Blast radius:** Every in-progress project inside an ETD checkpoint window. Silent on the PM side: the absence of an update looks identical to supplier non-response.
- **Smallest viable change (S):** Pass `{ token, code: enteredAccessCode }` as the second argument at both call sites, and mark the date and reason inputs `required`.

### A2. The dashboard document upload stores nothing
- **Role / job / frequency:** Supplier · J13 · every document round
- **Evidence:** [SupplierDashboard.tsx:549-579](src/pages/SupplierDashboard.tsx#L549-L579) — `handleDocumentUpload` runs a 600 ms progress-bar loop (`// Simulate upload with progress (in real implementation, this would be actual file upload)`), then removes the row from `missingDocs` and fires `` `${file.name} uploaded successfully!` ``. No storage call, no service call, no server write. The selected `File` object is discarded. `grep uploadFile src/pages/SupplierDashboard.tsx` returns nothing.
- **Consequence:** The supplier watches a progress bar complete, reads "uploaded successfully", sees the document leave their to-do list — and nothing exists. On refresh the document returns to the list with no explanation, or worse, they never refresh and consider the obligation discharged. The PM sees no document and chases; the supplier insists they uploaded it. This is the failure mode that costs a supplier relationship, not just a day.
- **Note:** the *working* upload lives in a different surface — [SupplierPortal.tsx:107-131](src/pages/SupplierPortal.tsx#L107-L131) calls the real `uploadFile` / `uploadAdHocFile`. The dashboard has a broken copy of a feature that already works 400 lines away. See [B5](#b5-the-dashboard-never-links-to-the-one-surface-where-uploads-work).
- **Blast radius:** Every supplier-responsible document on every active project — 66 rows in `project_documents` today.
- **Smallest viable change (S):** Delete `handleDocumentUpload` and the Select/Upload controls; replace the row action with a link to `/supplier/:projectToken`, which already works. **(M)** if you instead wire `uploadFile(docId, file, true, projectToken)` in place of the simulation — needs the project token threaded into `missingDocs`.

### A3. A rejected TCF declaration tells the supplier it was "Successfully Submitted"
- **Role / job / frequency:** Supplier · J15 · every declaration a PM does not fully accept
- **Evidence:** [ComplianceRequestDetail.tsx:198-209](src/pages/compliance/ComplianceRequestDetail.tsx#L198-L209) — the PM's `handleSave` sets `status = REJECTED` automatically whenever **any** requirement carries `CANNOT_COMPLY`, which is the supplier's own honest answer, not a PM judgement. [SupplierCompliancePortal.tsx:53-55](src/pages/compliance/SupplierCompliancePortal.tsx#L53-L55) then treats `'rejected'` exactly like `'submitted'`: `setSubmitted(true)`. The supplier reopens the portal and sees the green panel at [SupplierCompliancePortal.tsx:320-327](src/pages/compliance/SupplierCompliancePortal.tsx#L320-L327) — *"Form Successfully Submitted … Our team will review the declaration"* — over a `pointer-events-none` form. There is no rejection reason field anywhere: I checked `information_schema.columns` for `compliance_requests` in the live DB — no `rejection_reason`, no `review_comment`.
- **The gap is server-side capability that the client ignores:** the live `submit_compliance_response_secure` locks only `'approved'` and `'completed'`. A `'rejected'` request is still writable. The database is ready for a correction round; the UI presents a dead end.
- **Consequence:** A supplier who answered one item honestly is silently marked rejected, is shown a success message, and has no field to read why and no control to respond. The correction round happens in email, or not at all — and the TCF that reaches the file is the rejected one.
- **Blast radius:** Any declaration containing a single "Cannot Confirm" — by design the common case, since the form makes "Cannot Confirm" a first-class answer with a mandatory explanation.
- **Smallest viable change (S):** Stop treating `'rejected'` as terminal in [SupplierCompliancePortal.tsx:53-55](src/pages/compliance/SupplierCompliancePortal.tsx#L53-L55) — keep the form editable, swap the green panel for a "Returned for correction" banner. **(M)** to add a `rejection_reason` column and surface the PM's per-requirement comments, which is what actually makes the round trip useful.

### A4. The TCF declaration has no draft save — even though the server already supports one
- **Role / job / frequency:** Supplier · J15 · every declaration
- **Evidence:** all answers live in React state only ([SupplierCompliancePortal.tsx:31-34](src/pages/compliance/SupplierCompliancePortal.tsx#L31-L34)); the single write is `submitComplianceResponseSecure(…, ComplianceRequestStatus.SUBMITTED, …)` at [SupplierCompliancePortal.tsx:145-158](src/pages/compliance/SupplierCompliancePortal.tsx#L145-L158). No autosave, no `beforeunload` guard, no localStorage. Meanwhile the **live** `submit_compliance_response_secure` explicitly accepts `p_status = 'pending_supplier'` with the comment *"A supplier may only submit or save a draft"* and only stamps `submitted_at` when the status is `'submitted'`. The draft path was built and never called.
- **Consequence:** 57 requirements in the live library, filtered per category, each needing a Confirm/Cannot-Confirm decision and sometimes a written justification — a session long enough that a closed tab, a dropped VPN, or the sticky-footer submit button being disabled until the last item is answered all cost the whole thing. Re-entry is total: there is no partial state to come back to.
- **Blast radius:** One declaration per re-entry, but the supplier's second attempt is rushed, which is exactly how "Confirm" gets clicked on something that should have been "Cannot Confirm".
- **Smallest viable change (S):** Add a "Save draft" button that calls the same RPC with `ComplianceRequestStatus.PENDING_SUPPLIER`; the reload path at [SupplierCompliancePortal.tsx:102-108](src/pages/compliance/SupplierCompliancePortal.tsx#L102-L108) already rehydrates `answers` and `comments` from `requestData.responses`, so the round trip works today with no other change.

### A5. Attribute-form validation fails silently
- **Role / job / frequency:** Supplier · J14 · every SKU, twice (step 2 and step 3)
- **Evidence:** [SupplierAttributePortal.tsx:82-89](src/pages/SupplierAttributePortal.tsx#L82-L89) — on submit, `validateAttributeValue` runs over every attribute, `setErrors(newErrors); return;`. No scroll-to-first-error, no error summary, no count. Errors render only inline next to the offending field ([AttributeInput.tsx:298](src/components/common/AttributeInput.tsx#L298)), and the fields are spread across collapsible-height groups ([SupplierAttributePortal.tsx:200-233](src/pages/SupplierAttributePortal.tsx#L200-L233)) under a `sticky bottom-4` submit button.
- **Consequence:** The supplier clicks Submit with a required field empty three groups up, and the page does nothing at all — no toast, no scroll, no change near the button they just pressed. The rational reading is "the site is broken", and the next move is an email with the spec sheet attached, which is the behaviour the portal exists to replace.
- **Blast radius:** One form per occurrence, but it is the supplier's first impression of the tool.
- **Smallest viable change (S):** After `setErrors`, scroll the first errored field into view and show a count banner (`"3 fields need attention"`) above the submit button.

### A6. "Replace File" makes the supplier choose the file twice
- **Role / job / frequency:** Supplier · J13 · every rejected or superseded document
- **Evidence:** [SupplierPortal.tsx:245-252](src/pages/SupplierPortal.tsx#L245-L252) — the Replace label wraps its own hidden `<input type="file">` whose `onChange` is `(e) => e.target.files?.[0] && triggerUpload(doc.id)`. `triggerUpload` ([SupplierPortal.tsx:96-104](src/pages/SupplierPortal.tsx#L96-L104)) ignores that file entirely, clears the *component-level* `fileInputRef`, and `.click()`s it — reopening the OS file dialog. The first selection is discarded.
- **Consequence:** Two file dialogs per replacement, with no explanation for the second. A supplier who picks a different file the second time silently uploads the wrong one.
- **Blast radius:** One document per occurrence; the rejected-document path is by definition the one already under time pressure.
- **Smallest viable change (S):** Drop the nested input and make Replace a plain `<button onClick={() => triggerUpload(doc.id)}>`.

---

## 3. Ladder B — workflow gaps traced through code

### B1. The TCF portal has no way to attach the evidence it demands
- **Role / job / frequency:** Supplier · J15 · every declaration; PM/compliance on every review
- **What the job needs:** the declaration is a compliance artefact whose value is the evidence behind it. The form itself says so: it renders a per-requirement badge reading **"Lab Report Req"** vs "Self-Decl OK" ([SupplierCompliancePortal.tsx:626-644](src/pages/compliance/SupplierCompliancePortal.tsx#L626-L644)) and an intro paragraph telling the supplier a *"qualified laboratory"* report is required as evidence ([SupplierCompliancePortal.tsx:357-361](src/pages/compliance/SupplierCompliancePortal.tsx#L357-L361)).
- **What the code supports:** nothing. There is not one `<input type="file">`, attachment array, or upload call in all 730 lines of the file — verified by grep. The only free-text field is the "Explanation Required" box, and it only appears on **Cannot Confirm** ([SupplierCompliancePortal.tsx:645-673](src/pages/compliance/SupplierCompliancePortal.tsx#L645-L673)). A supplier confirming a lab-report-required item has nowhere to put the report and nowhere to name the lab or the report number.
- **What they do today instead:** `[Guessing]` emails the test reports separately — the portal gives them no other option.
- **Heuristic:** H3 (provenance at the point of decision) — the reviewer sees a green tick with no trace back to the report that justifies it. Also H4: the evidence gap surfaces at file-assembly time, weeks after the declaration.
- **Cost / risk:** Regulatory. A TCF whose "Confirm" ticks are unbacked is a compliance record that cannot be defended, and the reviewer cannot tell a well-evidenced Confirm from a hopeful one.
- **Smallest viable change (S):** Add an optional comment box to **Confirm** answers too, labelled "Lab / report reference" and made mandatory when `selfDeclarationAccepted === false` — the `comments` state and the `ComplianceResponseItem.comment` field already carry it end to end, so this is a render-condition change plus one validation clause. **(M)** for real per-requirement file attachments reusing the `rfq-quotes` bucket pattern from [SupplierRFQPortal.tsx:96-113](src/pages/sourcing/SupplierRFQPortal.tsx#L96-L113).

### B2. RFQs and attribute requests carry no deadline
- **Role / job / frequency:** Supplier · J14, J16 · every request
- **What the job needs:** the supplier is juggling requests from several customers and needs to know what is due when.
- **What the code supports:** the `RFQ` interface has no deadline field at all ([sourcing.types.ts:59-73](src/types/sourcing.types.ts#L59-L73)) and neither does `ProjectAttributeRequest` ([project.types.ts:89-105](src/types/project.types.ts#L89-L105)). The RFQ portal header shows only `Created {date}` ([SupplierRFQPortal.tsx:220-222](src/pages/sourcing/SupplierRFQPortal.tsx#L220-L222)). Compliance requests *do* have `deadline`, and the dashboard renders overdue/soon colouring for them ([SupplierCompliancePortalList.tsx:87-100](src/pages/compliance/SupplierCompliancePortalList.tsx#L87-L100)) — so the pattern exists and two of the four request types simply don't participate. The dashboard's own `summaryStats.upcomingDeadlines` ([SupplierDashboard.tsx:689-707](src/pages/SupplierDashboard.tsx#L689-L707)) can only count projects and compliance requests for the same reason.
- **What they do today instead:** `[Guessing]` the PM states the date in the email carrying the link, and chases by email afterwards.
- **Heuristic:** H11 — handoff needs an explicit state, and a due date is the cheapest half of one.
- **Cost / risk:** Commercial, and it lands on the PM: every undated request converts into a chase cycle.
- **Smallest viable change (M):** Add a nullable `deadline` to `rfqs` and `project_attribute_requests`, set it in `CreateRFQ` and the attribute-request modal, render it on the portal cards, and include it in the existing `getDaysUntil` colouring.

### B3. A submitted quote can never be corrected
- **Role / job / frequency:** Supplier · J16 · any mistyped price, currency, or MOQ
- **What the job needs:** quotes get revised. A supplier who fat-fingers `12.50` as `1250` needs to fix it before the PM compares.
- **What the code supports:** on load, a `SUBMITTED` or `AWARDED` entry short-circuits straight to the success screen ([SupplierRFQPortal.tsx:57-60](src/pages/sourcing/SupplierRFQPortal.tsx#L57-L60)), which shows only *"We will notify you if your quote is selected"* ([SupplierRFQPortal.tsx:181-195](src/pages/sourcing/SupplierRFQPortal.tsx#L181-L195)) — the form is never rendered, and the supplier cannot even re-read what they submitted. On the PM side there is no reopen: grepping `RFQDetail.tsx` and `SourcingDashboard.tsx` for reopen/resubmit turns up only two read-only `status === PENDING` checks. Ironically the live `submit_rfq_entry_secure` would happily accept the correction — it is an unconditional `UPDATE … WHERE token = p_token` with no status guard.
- **What they do today instead:** `[Guessing]` emails the PM a corrected price, which then lives outside the comparison table the PM actually reads.
- **Heuristic:** H12 — the exit door. The supplier cannot even see their own submitted figures.
- **Cost / risk:** Commercial. An award decision made against a comparison table that a corrected quote never reached.
- **Smallest viable change (S):** Render the submitted values read-only on the success screen, plus a PM-side "Reopen entry" that flips `rfq_entries.status` back to `pending`. **(M)** to let the supplier self-revise while the parent RFQ is still `open`.

### B4. The RFQ portal accepts quotes into closed and awarded RFQs
- **Role / job / frequency:** Supplier · J16 · any link opened after the sourcing round ends
- **What the job needs:** a closed RFQ should say it is closed.
- **What the code supports:** `get_rfq_by_entry_token` (verified in the live DB, matching [73_supplier_portal_phase3a_rpcs.sql:22-28](db_migrations/73_supplier_portal_phase3a_rpcs.sql#L22-L28)) joins on the entry token with **no filter on `rfqs.status`**, and `submit_rfq_entry_secure` (also verified live) has no status guard. `SupplierRFQPortal` never reads `rfq.status` — the enum defines `OPEN`/`CLOSED`/`AWARDED` ([sourcing.types.ts:5-9](src/types/sourcing.types.ts#L5-L9)) and the portal renders none of it. The dashboard's list is correctly filtered (`get_rfqs_for_supplier` requires `r.status = 'open'`), so the hole is only on the direct link — which is the link suppliers actually keep.
- **What they do today instead:** nothing — they have no way to know.
- **Heuristic:** H13 — the state that is never designed is the one that costs.
- **Cost / risk:** Wasted supplier effort quoting a dead RFQ, and a late `submitted` row landing after an award decision with nothing flagging it as late.
- **Smallest viable change (S):** Render a "This RFQ is closed" state when `rfq.status !== 'open'` and skip the form; add `AND r.status = 'open'` to the guard inside `submit_rfq_entry_secure`.

### B5. The dashboard never links to the one surface where uploads work
- **Role / job / frequency:** Supplier · J13 · every document round
- **What the job needs:** one entry point that reaches every outstanding task.
- **What the code supports:** the dashboard navigates to `/compliance/supplier/:token` ([SupplierDashboard.tsx:1281](src/pages/SupplierDashboard.tsx#L1281)), `/sourcing/supplier/:token` ([SupplierDashboard.tsx:1396](src/pages/SupplierDashboard.tsx#L1396)) and `/attribute-request/:token` ([SupplierDashboard.tsx:1487](src/pages/SupplierDashboard.tsx#L1487)) — but never to `/supplier/:projectToken`, the project document portal that holds the working upload, the per-document rejection comments, and the "Others / Additional Files" path. Grepping `'/supplier/'` in the dashboard returns nothing. The supplier reaches it only if the PM separately sends that second link.
- **What they do today instead:** uses the fake dashboard uploader ([A2](#a2-the-dashboard-document-upload-stores-nothing)), or emails the file.
- **Heuristic:** H11 / H12 — two disconnected surfaces for one role, joined by the PM remembering to paste a second URL.
- **Cost / risk:** It is the direct cause of A2 mattering: with the link present, the fake uploader could simply be deleted.
- **Smallest viable change (S):** Add the project portal link to each project group header in the dashboard. `getProjectsBySupplierToken` already returns the projects; expose `projects.portal_token` in that RPC's column list if it is not already there.

### B6. One form per SKU, with no way to carry anything across
- **Role / job / frequency:** Supplier · J14 · once per SKU per stage, and regional variants multiply it
- **What the job needs:** per `users-and-jobs.md`, the same physical product ships as several SKUs (10XXXXX EU / 12XXXXX UK / 13XXXXX AU) that share nearly all technical attributes. A launch is a handful of products and a multiple of that in SKUs.
- **What the code supports:** `ProjectAttributeRequest` is keyed to a single `skuNumber` ([project.types.ts:89-105](src/types/project.types.ts#L89-L105)); each one renders its own standalone form over the full category attribute set ([SupplierAttributePortal.tsx:74-80](src/pages/SupplierAttributePortal.tsx#L74-L80)), and the dashboard lists them as N independent cards ([SupplierDashboard.tsx:1479-1526](src/pages/SupplierDashboard.tsx#L1479-L1526)). There is no multi-select, no "copy from another SKU", no CSV or paste-in, and no export out. The one prefill that exists is the step-3 carry-forward of that *same* SKU's step-2 answers ([SupplierAttributePortal.tsx:50-60](src/pages/SupplierAttributePortal.tsx#L50-L60)) — so the mechanism for prefilling a form already exists and simply isn't reachable across SKUs.
- **What they do today instead:** `[Guessing]` fills one Excel sheet covering all variants and emails it, because that is the only shape that matches the work.
- **Heuristic:** H2 (bulk is the unit of work) and H8 (SKU ≠ product).
- **Cost / risk:** Retyping identical values across regional variants is exactly where a UK-only value ends up on the EU SKU — a divergence nobody re-checks, feeding regulatory data downstream.
- **Smallest viable change (L — needs a spec):** a multi-SKU grid, one column per SKU, with paste-from-Excel. **S mitigation that buys most of it:** on load, prefill from the most recent *submitted* request in the same project whose `skuNumber` shares the trailing digits, and mark those fields "copied from {SKU} — please check". This reuses the existing `submittedData` prefill path and turns N full forms into one form plus N reviews.

---

## 4. Ladder C — heuristic violations, cost unobserved

### C1. Two gates, two different six-digit codes — H1
- **Evidence:** the supplier enters their supplier access code at [SupplierDashboard.tsx:346-393](src/pages/SupplierDashboard.tsx#L346-L393), then opening a TCF request navigates to `/compliance/supplier/:token` ([SupplierDashboard.tsx:1281](src/pages/SupplierDashboard.tsx#L1281)), which presents a *second* code gate ([SupplierCompliancePortal.tsx:163-200](src/pages/compliance/SupplierCompliancePortal.tsx#L163-L200)). The codes are genuinely different values — `suppliers.access_code` versus a per-request `generateNumericCode(6)` written at [compliance.service.ts:90](src/services/compliance/compliance.service.ts#L90). The dashboard papers over it with a "Copy Code" button ([SupplierDashboard.tsx:1294-1303](src/pages/SupplierDashboard.tsx#L1294-L1303)) — so the flow is: authenticate, copy a code, get bounced to a login, paste it. The same happens from the standalone list at [SupplierCompliancePortalList.tsx:71-73](src/pages/compliance/SupplierCompliancePortalList.tsx#L71-L73), where the supplier has *just typed* an access code.
- **Why it probably costs something:** a login screen appearing immediately after a successful login reads as a failure, not a step. The 60-minute session timeout at [SupplierDashboard.tsx:144-158](src/pages/SupplierDashboard.tsx#L144-L158) means a long declaration can also strand them behind the first gate on the way back.
- **What would confirm it:** watch one supplier get from the dashboard into a TCF form without asking a question.
- **Smallest viable change (S):** pass the request's `accessCode` through router state when navigating from a surface that already holds it, and auto-verify — keeping the gate intact for anyone arriving cold on the direct link.

### C2. No supplier-side export of anything they submitted — H12
- **Evidence:** the TCF portal has no download or print path (no `jsPDF`, no export button anywhere in the file) though the PM side has one at [ComplianceRequestDetail.tsx:226-240](src/pages/compliance/ComplianceRequestDetail.tsx#L226-L240); the attribute portal's success screen shows only a thank-you ([SupplierAttributePortal.tsx:127-136](src/pages/SupplierAttributePortal.tsx#L127-L136)) while the PM gets "Export to Excel" ([ProjectDetail.tsx:1468-1471](src/pages/ProjectDetail.tsx#L1468-L1471)); the RFQ success screen doesn't echo the submitted figures. Every export in the codebase points inward.
- **Why it probably costs something:** the supplier signed a declaration with a liability clause ([SupplierCompliancePortal.tsx:698-706](src/pages/compliance/SupplierCompliancePortal.tsx#L698-L706)) and keeps no copy of what they signed. The predictable response is to fill the Excel sheet first and the portal second — at which point the Excel sheet is the real record and the portal is transcription.
- **What would confirm it:** ask whether any supplier has requested a copy of their own submission.
- **Smallest viable change (S):** render the submitted answers read-only on each success screen (the data is already in state) and add a browser-print stylesheet. The PM-side `handleExportPDF` is reusable for the TCF case.

---

## 5. Ladder D — speculative (max 3)

### D1. The portal may be bypassed entirely rather than merely unlaunched
- **Claim:** `[Guessing]` the zero-row counts mean suppliers are working over email/WeChat and no one has sent a portal link, in which case A1–A6 have cost nothing yet and the real question is why the links aren't going out — not which defect to fix first.
- **Who it would serve and how often:** all five surfaces; determines whether this whole report is urgent or archival.
- **What would promote or kill it:** ask Nicolas or Anabelle one question — *has any supplier ever been sent a portal link, and what happened?* If yes and it failed, A1/A2 are almost certainly why. If no, fix A1–A4 before the first link goes out.
- **If admitted despite the banned list:** not a banned proposal; it is the single measurement that reranks everything above.

### D2. The locked-image rule will block a legitimate correction at production validation
- **Claim:** `[Guessing]` [SupplierAttributePortal.tsx:23-25](src/pages/SupplierAttributePortal.tsx#L23-L25) and [SupplierAttributePortal.tsx:55-58](src/pages/SupplierAttributePortal.tsx#L55-L58) permanently lock any image attribute carrying a value from a previous stage — so at step 3 (production validation), where the whole instruction is *"update anything that has changed"* ([SupplierAttributePortal.tsx:191-199](src/pages/SupplierAttributePortal.tsx#L191-L199)), the one field that most often changes between development and production — the product photo — is the one field the supplier cannot touch. The lock is disabled-with-no-explanation: no tooltip, no "ask your PM".
- **Who it would serve and how often:** Supplier at J14 step 3; `[Guessing]` once per SKU per launch.
- **What would promote or kill it:** ask whoever set the rule whether it was meant to cover step 3 as well as step 2. If the answer is "step 2 only", it is an S fix; if the lock is deliberate, it still needs a visible reason and a request-change control.

---

## 6. Ranked shortlist

| # | Finding | Ladder | Role | Freq | Risk | Fix | Why this order |
|---|---|---|---|---|---|---|---|
| 1 | A1 ETD confirm / delay cannot write | A | Supplier | ETD−45/−30/−16 | commercial, silent to PM | S | Guaranteed failure on a timed prompt; two-line fix |
| 2 | A2 Dashboard upload stores nothing | A | Supplier | every doc round | regulatory, false success | S | Tells the supplier a compliance doc landed when it didn't |
| 3 | A3 Rejected TCF shows "Successfully Submitted" | A | Supplier | every partial declaration | regulatory | S | Misleading terminal state on a legal artefact; DB already allows the fix |
| 4 | A4 No TCF draft save | A | Supplier | every declaration | regulatory (rushed retry) | S | Server-side draft path already exists and is simply not called |
| 5 | B1 No evidence attachment in TCF | B | Supplier + reviewer | every declaration | regulatory | S→M | Unbacked "Confirm" ticks are indefensible in a compliance file |
| 6 | A5 Silent attribute-form validation failure | A | Supplier | every SKU × 2 | internal-time, abandonment | S | Reads as a broken site; pushes the work back to Excel |
| 7 | B5 Dashboard omits the working document portal | B | Supplier | every doc round | internal-time | S | Prerequisite for deleting A2 rather than rebuilding it |
| 8 | B3 Quote cannot be corrected or re-read | B | Supplier | any quote error | commercial | S | Award decided on figures the supplier couldn't fix |
| 9 | B6 One form per SKU, no bulk or carry-across | B | Supplier | per SKU per stage | regulatory (variant drift) | L (S mitigation) | Highest steady-state cost, but the fix needs a spec |
| 10 | B2 No deadline on RFQ / attribute requests | B | Supplier + PM | every request | commercial | M | Converts every request into a PM chase cycle |
| 11 | B4 Quotes accepted on closed / awarded RFQs | B | Supplier | stale links | commercial | S | Cheap guard; low frequency today |
| 12 | A6 "Replace File" double picker | A | Supplier | every replacement | internal-time | S | Real and trivial, but the smallest consequence here |

---

## 7. Coverage

**Examined:** `src/app/App.tsx:75-79`, `src/config/routes.config.ts`, `SupplierDashboard.tsx` (all 1752 lines), `SupplierPortal.tsx`, `SupplierAttributePortal.tsx`, `SupplierRFQPortal.tsx`, `SupplierCompliancePortal.tsx`, `SupplierCompliancePortalList.tsx`, `AttributeInput.tsx`, `attribute-validation.utils.ts`, `portal-lockout.utils.ts`, `mappers.utils.ts` (compliance mapper), `services/compliance/compliance.service.ts`, `services/compliance/compliance-requirement.service.ts`, `services/sourcing/rfq.service.ts`, `services/sourcing/rfq-entry.service.ts`, `services/manufacturing/production.service.ts`, `services/project/project-document.service.ts`, `services/supplier/supplier.service.ts`, `types/sourcing.types.ts`, `types/project.types.ts`, `types/compliance.types.ts`, `db_migrations/73_*.sql`, and PM-side counterparts `ComplianceRequestDetail.tsx` (review/reject path), `ProjectDetail.tsx` (attribute-request controls), `RFQDetail.tsx` (entry states).

**Verified against the live database** (read-only, project `ecueltibpmpnhnaxlskx`, 2026-08-20): row counts for nine tables; `information_schema.columns` for `compliance_requests`; live definitions of `submit_rfq_entry_secure`, `get_rfq_by_entry_token`, `submit_compliance_response_secure`, `get_attribute_request_by_token`, `get_compliance_requests_by_supplier`, `get_compliance_requests_by_supplier_code`. All matched the repo migrations — no drift found on the supplier-portal surface. This check also killed a finding I had drafted: `getCategoryAttributes` fetches the whole `category_attributes` table unfiltered on an anonymous portal load, which looked like a latency defect until the table turned out to hold 137 rows.

**Not examined:** `SubmitProposalModal.tsx` and the supplier-proposal submission flow; `ConvertProposalModal.tsx`; `RFQAttributeComparison.tsx` internals; the dashboard's TCF tab render and notifications drawer; `netlify/functions/supplier-file-url.ts` and the signed-URL edge path; `SuppliersList.tsx` PM-side link/code distribution beyond the copy handlers; the Resend/edge-function invitation email templates; RLS policies on the underlying tables (I checked the RPCs, not `pg_policies`); `ProjectSupplierDiffImportDialog.tsx` (supplier IM draft intake — a different job, J5); mobile/narrow-viewport rendering.

**Blocked / could not verify:** everything about real supplier behaviour. With 0 RFQs and 0 compliance requests in production there is no usage data, no error telemetry, and no way to distinguish a defect that has bitten someone from one that is merely waiting. The frequency column in every finding above is inferred from the code's own cadence (ETD checkpoints, per-SKU requests, per-launch declarations), not observed.

**Corrections needed in `users-and-jobs.md`:** I edited the file. The Supplier role row said intake "may be file-based, not in-app" — corrected: five in-app token portals exist. I added **J13–J17** covering supplier document submission, attribute data entry, TCF declaration, quoting, and ETD confirmation; every frequency and every "what they do today instead" in those five rows is `[Guessing]` and needs a product owner to correct it. I also recorded the live volume counts as a caveat above the jobs table. The one field whose correction would change this report's ranking most is J13–J17 frequency — see D1.
