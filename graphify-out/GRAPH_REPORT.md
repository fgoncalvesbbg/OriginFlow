# Graph Report - /workspaces/OriginFlow  (2026-07-26)

## Corpus Check
- 384 files · ~461,645 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2902 nodes · 8750 edges · 111 communities (105 shown, 6 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 195 edges (avg confidence: 0.71)
- Token cost: 363,150 input · 0 output

## Community Hubs (Navigation)
- Live Browser Design Builder
- IM Print/PDF Rendering
- IM Viewer & HTML Sanitization
- Live Manual-Edit Commit
- Project IM Content Editor
- App Shell & Routing
- Status Badge System
- Admin & Compliance Library
- Live Svelte Insert Session
- Live Server Manual-Apply
- DB Schema & PM RLS Policies
- Visual Contrast Analysis
- Translation Service
- Layout/Border Checks
- Live Svelte Component Injection
- SKU Catalog
- Screenshot Library (vendor)
- IM Dashboard
- Live Page-Chat & Voice
- IM Block Library
- Live Svelte Component Build
- Attribute Inputs & Block Editor
- IM Shared UI & Languages
- Skill Docs: Caveman/Impeccable
- Live Design Panel UI
- Supplier RFQ Portal
- IM Viewer & Export Dialogs
- Live Insert CLI
- App Config & Supabase Client
- SKU/Proposal/Compliance Forms
- Live Event Validation
- Design Spec Parser
- CSS Cascade Engine
- Live Accept CLI
- Browser Antipattern Detector
- CSS/Text Detection
- Manual-Edit Context Restore
- Manual-Edit Evidence
- IM Template Translation Script
- Auth & Routing Config
- IM Publish Service
- Color Palette Checks
- Live Resume CLI
- TSConfig Lib Targets
- Antipattern Detector CLI
- Impeccable Path Resolver
- Manual-Apply Pending Dock
- Live Completion & Poll
- Live Inject CLI
- Live Agent Status Rows
- Build Dev Dependencies
- Supplier Compliance Portal
- Color/Glow Checks
- Chrome Node Capture
- Live Agent Session State
- Core App Dependencies
- Skill Update Directive
- Visual Contrast Helpers
- Typography Checks
- Annotation Pin Editing
- Screenshot Contrast Fallback
- Live Discard Manual-Edits
- SvelteKit Live Adapter
- Dev Context Signals
- Visual Contrast Overlays
- Browser Findings Checks
- Critique Snapshot Storage
- Live Event Broadcast Queue
- Category Import Script (Py)
- App Modules & Core Tables
- Knip Config
- IM Image Sweep Script
- Toast Notifications
- Design System Docs
- Skill Cleanup Script
- Static DOM Element Shim
- Attribute CSV Import
- CSP Detection
- Motion/Layout Checks
- OKLCH Palette Generator
- Skill Pin Generator
- Package Manifest
- Hero/Icon Component Checks
- Content Quality Checks
- Live UI Core Mount
- Button Component
- Project IM Service
- Edit Badge Proxy
- Connection Recovery
- Error Boundary
- IM Layout & Bindable Fields
- Impeccable Command Docs
- Static DOM Document Shim
- Live CLI Entry
- Project SKU Service
- Generated-File Detection
- Supplier File URL Function
- Translate Netlify Function
- Design Rules & Accessibility
- Category Import & IM Data
- Border Checks
- Brand & Creative North Star
- Security & Backend Model
- Detector Path Resolver
- Contrast Text Candidates
- MCP Chrome DevTools Config
- App Entry Point
- Karpathy Guidelines
- IM Multi-Language Support

## God Nodes (most connected - your core abstractions)
1. `ProjectIMGenerator()` - 53 edges
2. `runMutation()` - 51 edges
3. `handleError()` - 51 edges
4. `el()` - 49 edges
5. `ProjectDetail()` - 44 edges
6. `AdminDashboard()` - 40 edges
7. `createRequestHandler()` - 39 edges
8. `getCategories()` - 37 edges
9. `IMTemplateEditor()` - 36 edges
10. `supabase` - 36 edges

## Surprising Connections (you probably didn't know these)
- `AttributeViewer()` --indirect_call--> `flag()`  [INFERRED]
  src/pages/products/AttributeViewer.tsx → scripts/translate-im-template.mjs
- `Impeccable Product Register` --semantically_similar_to--> `OriginFlow Product Definition (PRODUCT.md)`  [INFERRED] [semantically similar]
  .agents/skills/impeccable/reference/product.md → PRODUCT.md
- `Impeccable Product Register` --semantically_similar_to--> `OriginFlow Design Principles`  [INFERRED] [semantically similar]
  .agents/skills/impeccable/reference/product.md → PRODUCT.md
- `Impeccable Harden Reference` --semantically_similar_to--> `Accessibility Target WCAG 2.1 AA`  [INFERRED] [semantically similar]
  .agents/skills/impeccable/reference/harden.md → PRODUCT.md
- `ViewerShell()` --indirect_call--> `el()`  [INFERRED]
  src/modules/im-viewer/ViewerShell.tsx → .agents/skills/impeccable/scripts/live-browser.js

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Impeccable Command Reference Suite** — _agents_skills_impeccable_skill_impeccable, _agents_skills_impeccable_reference_craft_craft, _agents_skills_impeccable_reference_audit_audit, _agents_skills_impeccable_reference_critique_critique, _agents_skills_impeccable_reference_colorize_colorize, _agents_skills_impeccable_reference_clarify_clarify [EXTRACTED 1.00]
- **Craft-Codex Pre-Code Gate Flow** — _agents_skills_impeccable_reference_craft_craft, _agents_skills_impeccable_reference_codex_codex, _agents_skills_impeccable_reference_codex_user_gates, _agents_skills_impeccable_reference_codex_asset_producer [EXTRACTED 0.90]
- **AI Slop Avoidance System** — _agents_skills_impeccable_skill_ai_slop_test, _agents_skills_impeccable_skill_absolute_bans, _agents_skills_impeccable_reference_brand_reflex_reject [INFERRED 0.85]
- **Tokenized Supplier Portal Flow** — full_app_documentation_portalclient, full_app_documentation_secure_rpcs, full_app_documentation_rls_security_model, product_external_suppliers [EXTRACTED 1.00]
- **Status-at-a-Glance Visual System** — design_control_room, design_status_badges, design_color_plus_shape_rule, product_design_principles [INFERRED 0.85]
- **Impeccable Sub-commands Handing Off to Polish** — _agents_skills_impeccable_reference_layout_layout, _agents_skills_impeccable_reference_typeset_typeset, _agents_skills_impeccable_reference_harden_harden, _agents_skills_impeccable_reference_polish_polish [EXTRACTED 1.00]
- **PM-scoped multi-tenant security (fields, RLS, backfill)** — db_migrations_35_add_pm_scoping_fields_supplier_pm_assignments, db_migrations_36_implement_pm_rls_policies_pm_rls_policy, db_migrations_38_backfill_pm_assignments_backfill [EXTRACTED 1.00]
- **IM PDF generation pipeline (generator, renderer, docs)** — docs_im_module_project_im_generator, docs_im_module_render_project_im_pdf, docs_im_module_build_im_print_document, schema_project_documents [EXTRACTED 1.00]
- **Supplier portal secure RPC + token RLS + email notify** — history_rpc_function_fix_submit_compliance_response_secure, schema_public_token_access_policy, supabase_function_template_send_tcf_notification, schema_compliance_requests [INFERRED 0.75]

## Communities (111 total, 6 thin omitted)

### Community 0 - "Live Browser Design Builder"
Cohesion: 0.04
Nodes (102): acceptedDomAlreadyClean(), applyPlaceholderSizingStyles(), bufferToBase64(), buildCollapsible(), buildColorModels(), buildDesignHeader(), buildListHtml(), buildRadiiModels() (+94 more)

### Community 1 - "IM Print/PDF Rendering"
Cohesion: 0.06
Nodes (79): AuthError, buildParts(), fetchJson(), fetchManifestAndManuals(), IM_MARGIN, isValidBase(), json(), LEAFLET_MARGIN (+71 more)

### Community 2 - "IM Viewer & HTML Sanitization"
Cohesion: 0.05
Nodes (64): dompurify, dompurify, AnnotatedImageSet(), APPLIES_TO_I18N, CALLOUT_TITLES_I18N, getAppliesToLabel(), getCalloutTitle(), NOTE: this is a standalone copy of `src/services/im/callout-titles.i18n.ts` so (+56 more)

### Community 3 - "Live Manual-Edit Commit"
Cohesion: 0.06
Nodes (81): allEntryIds(), argVal(), buildRepairBatch(), candidatesForEntry(), changedFilesSinceSnapshot(), clearAppliedEntries(), collectApplyOwnedFiles(), collectRollbackFiles() (+73 more)

### Community 4 - "Project IM Content Editor"
Cohesion: 0.09
Nodes (55): AddProjectSectionProps, escapeXml(), getTokensInFragment(), refHasCondition(), DraftState, calloutVariant(), ISO_ICONS, isSectionVisible() (+47 more)

### Community 5 - "App Shell & Routing"
Cohesion: 0.08
Nodes (43): AdminRoute(), Props, Breadcrumbs(), navigablePaths, routeLabels, Card(), CardProps, Layout() (+35 more)

### Community 6 - "Status Badge System"
Cohesion: 0.10
Nodes (53): Badge(), BadgeProps, BadgeTone, TONE_CLASSES, formatLabel(), Props, StatusBadge(), toneForStatus() (+45 more)

### Community 7 - "Admin & Compliance Library"
Cohesion: 0.12
Nodes (51): ATTRIBUTE_GROUPS, PREDEFINED_ATTRIBUTE_GROUPS, AdminDashboard(), ComplianceLibrary(), describeRequirementCondition(), generateUUID(), getAIPrompts(), mapRow() (+43 more)

### Community 8 - "Live Svelte Insert Session"
Cohesion: 0.08
Nodes (60): applyOriginalAttrsToSvelteAnchor(), applyParamDefaults(), applyPlaceholderDimensions(), applySavedSessionMeta(), clampVariantIndex(), clearHandled(), commitAcceptedSvelteComponentToDom(), connectSSE() (+52 more)

### Community 9 - "Live Server Manual-Apply"
Cohesion: 0.06
Nodes (57): activeSessionSummaries(), addOpToManualApplyChunk(), annotRoot, APPLY_EVENT_HARD_TIMEOUT_MS, APPLY_EVENT_SOFT_DEADLINE_MS, args, buildManualApplyAgentAction(), cancelPendingManualApplyEvents() (+49 more)

### Community 10 - "DB Schema & PM RLS Policies"
Cohesion: 0.05
Nodes (59): supplier_proposals table (RFQ-like enhancement), projects.created_by audit column, supplier_pm_assignments junction table, PM vs ADMIN role isolation, PM-scoped Row Level Security policies, PM assignment backfill migration, Callout variant taxonomy (ISO 7010), Supplier IM Claude Chat review prompt (+51 more)

### Community 11 - "Visual Contrast Analysis"
Cohesion: 0.08
Nodes (54): addBrowserFindings(), addVisualContrastFindings(), addVisualContrastResult(), analyzeVisualContrast(), analyzeVisualContrastCandidate(), blendRgba(), browserFindingsFromMap(), buildSelectorSegment() (+46 more)

### Community 12 - "Translation Service"
Cohesion: 0.07
Nodes (46): cache, callProxy(), getVerbatims(), isImplausibleLength(), sleep(), TRANSIENT_STATUSES, translateHtml(), verbatimEntriesFor() (+38 more)

### Community 13 - "Layout/Border Checks"
Cohesion: 0.07
Nodes (54): borderWidthsFromStyle(), checkBorders(), checkClippedOverflow(), checkElementBorders(), checkElementBordersDOM(), checkElementClippedOverflow(), checkElementClippedOverflowDOM(), checkElementGptBorderShadow() (+46 more)

### Community 14 - "Live Svelte Component Injection"
Cohesion: 0.11
Nodes (55): abortSvelteComponentInjection(), buildConfigureRow(), buildInsertPlaceholderSnapshotFromDom(), cancelEditing(), cancelEditingToPicking(), cancelInsertConfigure(), captureAndEmit(), checkpointPayload() (+47 more)

### Community 15 - "SKU Catalog"
Cohesion: 0.09
Nodes (45): RFQAttributeComparison(), attr(), SkuCatalog(), skuThumbnailUrl(), mapProjectSku(), bulkUpsertCatalogSkus(), BulkUpsertSkuResult, createCatalogSku() (+37 more)

### Community 16 - "Screenshot Library (vendor)"
Cohesion: 0.09
Nodes (51): ae(), be(), bt(), Ce(), Ct(), de(), dt(), _e() (+43 more)

### Community 17 - "IM Dashboard"
Cohesion: 0.07
Nodes (47): AllManualsTabProps, defaultTemplateName(), editorPath(), fmtDate(), IMDashboard(), STATUS_CONFIG, Tab, TEMPLATE_TYPE_ORDER (+39 more)

### Community 18 - "Live Page-Chat & Voice"
Cohesion: 0.09
Nodes (49): activeElementDeep(), attachSteerFocusDebug(), attachSteerFocusGuard(), buildSteerProcessingDots(), clearSteerAwaitTimer(), clearSteerFocusRecoverTimer(), collapsePageChat(), configureVoiceContext() (+41 more)

### Community 19 - "IM Block Library"
Cohesion: 0.10
Nodes (36): BLOCK_TYPES, BlockCard(), BlockCardProps, BlockLibraryContent(), BlockModal(), blockTypeColor(), blockTypeIcon(), blockTypeLabel() (+28 more)

### Community 20 - "Live Svelte Component Build"
Cohesion: 0.10
Nodes (44): applyLegacyDeferredAcceptsOnStartup(), appendCssToSvelteStyle(), appendSanitizedCssRule(), applyDeferredSvelteComponentAccepts(), bakeParamValuesInCss(), buildInsertVariantStub(), buildPropContract(), buildPropsScript() (+36 more)

### Community 21 - "Attribute Inputs & Block Editor"
Cohesion: 0.07
Nodes (39): AttributeInput(), AttributeInputProps, ACCENT, AttributePicker(), AttributePickerLeadingOption, AttributePickerProps, BlockInsertType, CALLOUT_DEFAULT_TEXT (+31 more)

### Community 22 - "IM Shared UI & Languages"
Cohesion: 0.10
Nodes (35): ConfirmationModal(), SaveProgressOverlay(), SaveProgressOverlayProps, skuSyntheticAttribute(), IM_LANGUAGE_NAMES, IM_LANGUAGE_TABS, IM_PREVIEW_LANGUAGE_OPTIONS, IM_TEMPLATE_LANGUAGE_OPTIONS (+27 more)

### Community 23 - "Skill Docs: Caveman/Impeccable"
Cohesion: 0.07
Nodes (42): Caveman Auto-Clarity Rule, Caveman Compression Mode, Caveman Intensity Levels, Caveman SKILL Instructions, Wenyan Classical Chinese Compression, Impeccable OpenAI Agent Interface, Adapt Command (Context Adaptation), Responsive Design Reference (+34 more)

### Community 24 - "Live Design Panel UI"
Cohesion: 0.11
Nodes (40): applyParamValue(), barPaletteForTheme(), brandMarkSvg(), buildParamsPanel(), cssId(), defangOutsideHandlers(), designPanelCss(), detectPageTheme() (+32 more)

### Community 25 - "Supplier RFQ Portal"
Cohesion: 0.12
Nodes (27): ConvertProposalModalProps, Props, RFQDetail(), SupplierRFQPortal(), runQuery(), SupabaseResult, addSupplierDocumentComment(), submitRFQEntry() (+19 more)

### Community 26 - "IM Viewer & Export Dialogs"
Cohesion: 0.11
Nodes (32): IMSharedManual(), IMViewerTab(), keyOf(), PrintExportDialog(), PrintExportDialogProps, Props, ImImportDoc, ImProjectImportResult (+24 more)

### Community 27 - "Live Insert CLI"
Cohesion: 0.13
Nodes (34): argVal(), buildInsertWrapperLines(), computeInsertLine(), INSERT_POSITIONS, insertCli(), isInsertPosition(), resolveElementMatch(), buildSvelteComponentCssAuthoring() (+26 more)

### Community 28 - "App Config & Supabase Client"
Cohesion: 0.11
Nodes (24): APP_CONFIG, AdminTestEmail(), SupplierDashboard(), portalClient, getAllProductionUpdates(), getProductionUpdates(), getProductionUpdatesForSupplier(), saveProductionUpdate() (+16 more)

### Community 29 - "SKU/Proposal/Compliance Forms"
Cohesion: 0.14
Nodes (29): v(), isNumeric(), Props, SkuAttributeCellDrawer(), SubmitProposalModal(), SubmitProposalModalProps, CreateComplianceRequest(), AttributeViewer() (+21 more)

### Community 30 - "Live Event Validation"
Cohesion: 0.09
Nodes (21): FORBIDDEN_MANUAL_EDIT_TEXT_CHARS, INSERT_POSITIONS, isValidId(), isValidVariantId(), validateAnnotationFields(), validateEvent(), validateInsertGenerate(), validateManualEditEvent() (+13 more)

### Community 31 - "Design Spec Parser"
Cohesion: 0.16
Nodes (32): buildColor(), CANONICAL_SECTIONS, collectBullets(), collectColorValues(), collectParagraphs(), detectFormat(), extractColors(), extractComponents() (+24 more)

### Community 32 - "CSS Cascade Engine"
Cohesion: 0.12
Nodes (31): applyStaticDeclaration(), buildBorderOverrideMap(), buildStaticStyleMap(), collectStaticCssRules(), collectStaticCssText(), compareStaticPriority(), cssPropToCamel(), expandStaticBoxValues() (+23 more)

### Community 33 - "Live Accept CLI"
Cohesion: 0.14
Nodes (32): acceptCli(), argVal(), buildCarbonizeReplacement(), decodeHtmlAttr(), deindentContent(), detectCommentSyntax(), escapeRegExp(), expandReplaceRange() (+24 more)

### Community 34 - "Browser Antipattern Detector"
Cohesion: 0.11
Nodes (27): borderWidthsFromStyle(), buildSelectorSegment(), checkElementGptBorderShadow(), checkElementGptBorderShadowDOM(), checkElementItalicSerif(), checkElementItalicSerifDOM(), checkElementOversizedH1(), checkElementOversizedH1DOM() (+19 more)

### Community 35 - "CSS/Text Detection"
Cohesion: 0.14
Nodes (20): CSS_IN_JS_EXTENSIONS, detectText(), extractCSSinJS(), extractStyleBlocks(), REGEX_ANALYZERS, REGEX_MATCHERS, runRegexMatchers(), runTextContentAnalyzers() (+12 more)

### Community 36 - "Manual-Edit Context Restore"
Cohesion: 0.10
Nodes (30): addManualContextText(), applyEditing(), buildLocatorForLeaf(), canRestoreManualEditElement(), collectManualContextPieces(), contextElementForManualEdit(), copyEditContainerContext(), copyEditLeafContext() (+22 more)

### Community 37 - "Manual-Edit Evidence"
Cohesion: 0.16
Nodes (26): analyzeSourceHint(), buildCandidatesForOp(), buildContextHintsByRef(), buildManualEditEvidence(), collectSearchFiles(), countOps(), decodeBasicHtml(), escapeRegExp() (+18 more)

### Community 38 - "IM Template Translation Script"
Cohesion: 0.11
Nodes (24): argv, cache, die(), DRY_RUN, fill(), fillTitle(), flag(), freeze() (+16 more)

### Community 39 - "Auth & Routing Config"
Cohesion: 0.16
Nodes (19): isPortalRoute(), PORTAL_ROUTE_PREFIXES, AuthContext, AuthContextType, AuthProvider(), CreateProject(), Login(), login() (+11 more)

### Community 40 - "IM Publish Service"
Cohesion: 0.18
Nodes (24): AllManualsTab(), getAttributesById(), getProjectRequiredLanguages(), normalizeResolverData(), PublishedLanguage, publishResolvedManuals(), PublishResult, resolveContentHash() (+16 more)

### Community 41 - "Color Palette Checks"
Cohesion: 0.17
Nodes (25): checkColors(), checkCreamPalette(), checkElementAIPaletteDOM(), checkElementColors(), checkElementColorsDOM(), checkElementGlow(), checkElementGlowDOM(), checkElementIconTileDOM() (+17 more)

### Community 42 - "Live Resume CLI"
Cohesion: 0.15
Nodes (21): getLegacyLiveSessionsDir(), collectManualApplyFiles(), manualApplyReplyCommand(), manualApplyResumeHint(), parseArgs(), resumeCli(), summarizeManualApplyEvent(), applyEvent() (+13 more)

### Community 43 - "TSConfig Lib Targets"
Cohesion: 0.08
Nodes (24): dist, DOM, DOM.Iterable, ES2022, netlify, node, node_modules, compilerOptions (+16 more)

### Community 44 - "Antipattern Detector CLI"
Cohesion: 0.21
Nodes (20): confirm(), detectCli(), formatFindings(), handleStdin(), printUsage(), createBrowserDetector(), buildImportGraph(), detectFrameworkConfig() (+12 more)

### Community 45 - "Impeccable Path Resolver"
Cohesion: 0.16
Nodes (21): firstExisting(), getDesignSidecarCandidates(), getDesignSidecarPath(), getImpeccableDir(), getLegacyLiveConfigPath(), getLegacyLiveServerPath(), getLiveAnnotationsDir(), getLiveConfigPath() (+13 more)

### Community 46 - "Manual-Apply Pending Dock"
Cohesion: 0.19
Nodes (24): clearStoredManualApplyState(), fetchPendingCount(), handleManualEditActivity(), hidePendingApplyDock(), manualApplyLoadingText(), manualApplyStateKey(), manualEditEventForCurrentPage(), numberOrNull() (+16 more)

### Community 47 - "Live Completion & Poll"
Cohesion: 0.18
Nodes (22): completionAckForAcceptResult(), completionTypeForAcceptResult(), augmentEventWithAcceptHandling(), buildAcceptScriptArgs(), buildPollReplyPayload(), EVENT_TYPES_NEEDING_AGENT_REPLY, fetchNextEvent(), fetchServerStatus() (+14 more)

### Community 48 - "Live Inject CLI"
Cohesion: 0.16
Nodes (23): buffer, appendOriginToDirective(), buildTagBlock(), commentClose(), commentOpen(), CONFIG_PATH, __dirname, ensureLiveGitIgnores() (+15 more)

### Community 49 - "Live Agent Status Rows"
Cohesion: 0.15
Nodes (23): actionLabel(), buildConfirmedRow(), buildCyclingRow(), buildDots(), buildGeneratingRow(), buildInsertConfigureRow(), buildPlaceholderResizeHandles(), buildSavingRow() (+15 more)

### Community 50 - "Build Dev Dependencies"
Cohesion: 0.09
Nodes (23): autoprefixer, devDependencies, autoprefixer, knip, postcss, tailwindcss, @types/dompurify, @types/react (+15 more)

### Community 51 - "Supplier Compliance Portal"
Cohesion: 0.16
Nodes (19): react, react, AppContent(), COMPLIANCE_SECTIONS, SupplierCompliancePortal(), SupplierCompliancePortalList(), checkComplianceDeadlines(), createComplianceRequest() (+11 more)

### Community 52 - "Color/Glow Checks"
Cohesion: 0.19
Nodes (21): checkColors(), checkElementAIPaletteDOM(), checkElementColors(), checkElementColorsDOM(), checkElementGlow(), checkElementGlowDOM(), checkGlow(), colorToHex() (+13 more)

### Community 53 - "Chrome Node Capture"
Cohesion: 0.13
Nodes (20): averageRgb01(), captureChromeNodes(), captureElementFromRenderedAncestor(), captureElementToBlob(), compileShader(), cssColorToRgb01(), dominantRgb01(), findBackdropAncestor() (+12 more)

### Community 54 - "Live Agent Session State"
Cohesion: 0.18
Nodes (19): agentPollingConnected(), chatAgentLikelyActive(), cleanupSvelteComponentSessionsBeforeExit(), clearManualApplyTransaction(), compactManualLogText(), createRequestHandler(), getManualEditStatus(), hasProjectContext() (+11 more)

### Community 55 - "Core App Dependencies"
Cohesion: 0.11
Nodes (19): @anthropic-ai/sdk, html2canvas, jspdf, lucide-react, dependencies, @anthropic-ai/sdk, html2canvas, jspdf (+11 more)

### Community 56 - "Skill Update Directive"
Cohesion: 0.19
Nodes (16): buildUpdateDirective(), cli(), compareSemver(), computeUpdateDirective(), DESIGN_NAMES, FALLBACK_DIRS, fetchLatestSkillVersion(), firstExisting() (+8 more)

### Community 57 - "Visual Contrast Helpers"
Cohesion: 0.18
Nodes (17): analyzeVisualContrastCandidate(), blendRgba(), clampByte(), firstCssUrl(), getLayerValue(), loadVisualContrastImage(), parseObjectPosition(), parsePositionPair() (+9 more)

### Community 58 - "Typography Checks"
Cohesion: 0.18
Nodes (15): checkPageTypography(), checkTypography(), isBrandFontOnOwnDomain(), resolveSerif(), checkPageTypography(), checkTypography(), resolveSerif(), BRAND_FONT_DOMAINS (+7 more)

### Community 59 - "Annotation Pin Editing"
Cohesion: 0.20
Nodes (16): beginEditPin(), buildAnnotationsForCapture(), buildPinElement(), cancelEditingPin(), clampPlaceholderSize(), finalizeEditingPin(), localCoords(), onAnnotDown() (+8 more)

### Community 60 - "Screenshot Contrast Fallback"
Cohesion: 0.28
Nodes (12): detectUrl(), runVisualContrastFallback(), captureVisualContrastCandidate(), compareScreenshotContrast(), sanitizeScreenshotClip(), createDetectorProfile(), extractFindingIds(), percentile() (+4 more)

### Community 61 - "Live Discard Manual-Edits"
Cohesion: 0.26
Nodes (12): args, cwd, pageUrlFilter, remaining, getBufferPath(), readBuffer(), readBufferInternal(), readBufferStrict() (+4 more)

### Community 62 - "SvelteKit Live Adapter"
Cohesion: 0.26
Nodes (14): applySvelteKitLiveAdapter(), buildSvelteLiveRootComponent(), defaultSvelteLayout(), detectSvelteKitProject(), ensureSvelteLiveRootComponent(), escapeRegExp(), fileIncludes(), findSvelteKitAppHtml() (+6 more)

### Community 63 - "Dev Context Signals"
Cohesion: 0.25
Nodes (12): extractRegister(), cli(), COMMON_DEV_PORTS, devServerSignals(), gatherSignals(), gitSignals(), hasCode(), latestCritique() (+4 more)

### Community 64 - "Visual Contrast Overlays"
Cohesion: 0.18
Nodes (14): addBrowserFindings(), addVisualContrastFindings(), addVisualContrastResult(), analyzeVisualContrast(), clearOverlays(), detachOverlay(), disconnectLazyVisualContrastObserver(), postExtensionError() (+6 more)

### Community 65 - "Browser Findings Checks"
Cohesion: 0.18
Nodes (14): browserFindingsFromMap(), checkClippedOverflow(), checkCreamPalette(), checkElementClippedOverflow(), checkElementClippedOverflowDOM(), checkElementTextOverflowDOM(), checkHtmlPatterns(), checkPageQualityDOM() (+6 more)

### Community 66 - "Critique Snapshot Storage"
Cohesion: 0.32
Nodes (11): kebab(), listSnapshotsForSlug(), main(), nowFilenameStamp(), parseFrontmatter(), readLatestSnapshot(), readTrend(), serializeFrontmatter() (+3 more)

### Community 67 - "Live Event Broadcast Queue"
Cohesion: 0.29
Nodes (13): acknowledgePendingEvent(), broadcast(), broadcastAgentPollingIfChanged(), cancelQueuedAnonymousExitEvents(), findAvailablePendingEvent(), findPendingEventById(), flushPendingPolls(), handlePollGet() (+5 more)

### Community 68 - "Category Import Script (Py)"
Cohesion: 0.29
Nodes (12): cell_to_str(), col_index(), find_header(), fmt_num(), infer_type(), load_grid(), main(), norm() (+4 more)

### Community 69 - "App Modules & Core Tables"
Cohesion: 0.17
Nodes (13): The Rail (fixed dark navigation), compliance_requests table, Compliance (TCF) Module, OriginFlow Full Application Documentation, Project Lifecycle Module, projects table, rfqs / rfq_entries tables, Routing & App Shell (HashRouter) (+5 more)

### Community 70 - "Knip Config"
Cohesion: 0.15
Nodes (12): entry, ignore, project, $schema, netlify/functions/*.ts, netlify/**/*.ts, src/app/main.tsx, src/modules/im-viewer/** (+4 more)

### Community 71 - "IM Image Sweep Script"
Cohesion: 0.19
Nodes (11): argv, DRY_RUN, externalizeUri(), kb(), ONLY_ID, ONLY_TABLE, WHY: pasted screenshots used to be stored inline as base64 and duplicated, supabase (+3 more)

### Community 72 - "Toast Notifications"
Cohesion: 0.27
Nodes (8): ToastComponentProps, ToastContainer(), ToastContainerProps, ToastContext, ToastProviderProps, Toast, ToastContextType, ToastType

### Community 73 - "Design System Docs"
Cohesion: 0.21
Nodes (12): Impeccable Init Flow, Impeccable Product Register, Impeccable Shape Reference, OriginFlow PLM Design System (DESIGN.md), Design Tokens (colors, spacing, radii), Layered Elevation System, Inter-only Typography System, One-Voice Rule (Inter only) (+4 more)

### Community 74 - "Skill Cleanup Script"
Cohesion: 0.30
Nodes (11): buildTargetNames(), cleanSkillsLock(), cleanup(), DEPRECATED_NAMES, findProjectRoot(), findSkillsDirs(), HARNESS_DIRS, isImpeccableSkill() (+3 more)

### Community 76 - "Attribute CSV Import"
Cohesion: 0.30
Nodes (9): extractUnit(), GROUP_MAP, isBlankRow(), mapDataType(), mapGroup(), normalize(), parseAttributeCsv(), splitOptions() (+1 more)

### Community 77 - "CSP Detection"
Cohesion: 0.35
Nodes (10): detectCsp(), INLINE_HEADER_SIGNALS, LAYOUT_EXTS, MONOREPO_HELPER_SIGNALS, NUXT_ROUTE_RULES_SIGNALS, NUXT_SECURITY_SIGNALS, SCAN_EXTS, SKIP_DIRS (+2 more)

### Community 78 - "Motion/Layout Checks"
Cohesion: 0.22
Nodes (11): checkElementMotion(), checkElementMotionDOM(), checkLayout(), checkMotion(), checkPageLayout(), isCardLike(), isCardLikeDOM(), isCardLikeFromProps() (+3 more)

### Community 79 - "OKLCH Palette Generator"
Cohesion: 0.24
Nodes (7): args, buildWeights(), hashUnit(), pickSeed(), seed, SEEDS, weightedPick()

### Community 80 - "Skill Pin Generator"
Cohesion: 0.25
Nodes (9): __dirname, findHarnessDirs(), generatePinnedSkill(), HARNESS_DIRS, loadCommandMetadata(), pin(), root, unpin() (+1 more)

### Community 81 - "Package Manifest"
Cohesion: 0.18
Nodes (10): description, main, name, scripts, build, serve, start, test (+2 more)

### Community 82 - "Hero/Icon Component Checks"
Cohesion: 0.27
Nodes (10): checkElementHeroEyebrow(), checkElementHeroEyebrowDOM(), checkElementIconTile(), checkElementIconTileDOM(), checkHeroEyebrow(), checkIconTile(), isAccentColor(), isEmojiOnlyText() (+2 more)

### Community 83 - "Content Quality Checks"
Cohesion: 0.29
Nodes (10): checkElementQuality(), checkElementQualityDOM(), checkQuality(), checkRepeatedSectionKickers(), checkRepeatedSectionKickersDOM(), checkRepeatedSectionKickersFromDoc(), cleanInlineText(), collectRepeatedSectionKickerCandidates() (+2 more)

### Community 84 - "Live UI Core Mount"
Cohesion: 0.29
Nodes (8): appendStyleToLiveUiRoot(), appendToLiveUiRoot(), escapeCssIdent(), getLiveUiElementById(), LIVE_CHROME_MOUNT_CONTRACT, LIVE_UI_COMPONENT_IDS, LIVE_UI_SURFACES, resolveLiveUiRoot()

### Community 85 - "Button Component"
Cohesion: 0.22
Nodes (8): Button(), ButtonProps, ButtonSize, ButtonVariant, SIZE_CLASSES, VARIANT_CLASSES, ConfirmationModalProps, DEFAULT_CONFIRM_LABEL

### Community 86 - "Project IM Service"
Cohesion: 0.29
Nodes (8): deleteProjectIM(), getGeneratedProjectIMs(), mapProjectIMRow(), saveProjectIM(), setProjectIMFinalized(), call(), { readResult, singleQueue, refreshSession }, updateProjectIMPlaceholders()

### Community 87 - "Edit Badge Proxy"
Cohesion: 0.31
Nodes (9): bindEditBadgeProxy(), editBadgeProxyTargets(), initEditBadgeHitProxies(), positionEditBadge(), proxyMouseEvent(), setImportantStyle(), styleEditBadgeProxy(), syncEditBadgeHitProxies() (+1 more)

### Community 88 - "Connection Recovery"
Cohesion: 0.28
Nodes (7): ConnectionBanner(), ConnectionContext, ConnectionContextType, ConnectionProvider(), ConnectionStatus, IMPORTANT: this must NEVER navigate, reload, refresh the session, or sign the, useConnection()

### Community 89 - "Error Boundary"
Cohesion: 0.25
Nodes (3): ErrorBoundary, ErrorBoundaryProps, ErrorBoundaryState

### Community 90 - "IM Layout & Bindable Fields"
Cohesion: 0.36
Nodes (5): BindableField(), BindableFieldProps, DEFAULT_MASTER_PAGES, getBackgroundStyle(), joinAttrValues()

### Community 91 - "Impeccable Command Docs"
Cohesion: 0.29
Nodes (8): Impeccable Layout Reference, Impeccable Live Variant Mode, Impeccable Onboard Reference, Impeccable Optimize Reference, Impeccable Overdrive Reference, Impeccable Polish Reference, Impeccable Quieter Reference, Impeccable Typeset Reference

### Community 93 - "Live CLI Entry"
Cohesion: 0.50
Nodes (7): __dirname, ensureServerRunning(), globToRegex(), liveCli(), runScript(), safeParse(), scanForDrift()

### Community 94 - "Project SKU Service"
Cohesion: 0.46
Nodes (3): collapseSkuAttributeValues(), getEffectiveSkuValue(), getLatestSkuSubmission()

### Community 95 - "Generated-File Detection"
Cohesion: 0.53
Nodes (5): hasGeneratedHeader(), HEADER_MARKERS, isGeneratedFile(), isGitIgnored(), searchDir()

### Community 96 - "Supplier File URL Function"
Cohesion: 0.47
Nodes (5): handler(), json(), NetlifyEvent, toStoragePath(), UrlRequest

### Community 97 - "Translate Netlify Function"
Cohesion: 0.47
Nodes (5): handler(), json(), LANG_NAMES, langName(), NetlifyEvent

### Community 98 - "Design Rules & Accessibility"
Cohesion: 0.40
Nodes (5): Impeccable Harden Reference, Impeccable Interaction Design Reference, Color-Plus-Shape Rule, Status Badges (signature four-hue vocabulary), Accessibility Target WCAG 2.1 AA

### Community 99 - "Category Import & IM Data"
Cohesion: 0.40
Nodes (5): Prepare Category Import Skill, Data Mapping Strategy (snake_case -> domain models), im_templates / im_sections / project_ims tables, Instruction Manual (IM) Module, Modular Service Layer (src/services/index.ts barrel)

### Community 100 - "Border Checks"
Cohesion: 0.50
Nodes (5): checkBorders(), checkElementBorders(), checkElementBordersDOM(), isNeutralColor(), BORDER_SAFE_TAGS

### Community 101 - "Brand & Creative North Star"
Cohesion: 0.40
Nodes (5): The Control Room (Creative North Star), Anti-references (generic SaaS / consumer-flashy), Brand Personality: Calm, Precise, Trustworthy, Internal Product Managers / Admins (Klarstein staff), OriginFlow PLM Platform

### Community 102 - "Security & Backend Model"
Cohesion: 0.50
Nodes (5): Auth & Access Control, portalClient (tokenized supplier client), RLS & Token-Scoped Security Model, Supabase Backend (Postgres + Auth + RLS), External Suppliers (factories/vendors)

### Community 103 - "Detector Path Resolver"
Cohesion: 0.50
Nodes (3): candidates, detectorPath, __dirname

### Community 104 - "Contrast Text Candidates"
Cohesion: 0.67
Nodes (4): collectVisualContrastCandidates(), collectVisualContrastReasons(), getDirectText(), getDirectTextRect()

## Knowledge Gaps
- **315 isolated node(s):** `DEPRECATED_NAMES`, `HARNESS_DIRS`, `SKILL_FINGERPRINTS`, `COMMON_DEV_PORTS`, `SOURCE_DIRS` (+310 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **6 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `v()` connect `SKU/Proposal/Compliance Forms` to `CSS Cascade Engine`, `Live Browser Design Builder`, `Status Badge System`, `SKU Catalog`, `Screenshot Library (vendor)`, `Hero/Icon Component Checks`, `IM Shared UI & Languages`, `Live Design Panel UI`, `Supplier RFQ Portal`, `Dev Context Signals`, `Design Spec Parser`?**
  _High betweenness centrality (0.209) - this node is a cross-community bridge._
- **Why does `el()` connect `Live Agent Status Rows` to `CSS Cascade Engine`, `Browser Findings Checks`, `Browser Antipattern Detector`, `CSS/Text Detection`, `Live Browser Design Builder`, `IM Viewer & HTML Sanitization`, `Contrast Text Candidates`, `Color Palette Checks`, `Visual Contrast Analysis`, `Layout/Border Checks`, `Motion/Layout Checks`, `Live Svelte Component Injection`, `Live Page-Chat & Voice`, `Content Quality Checks`, `Attribute Inputs & Block Editor`, `Live Design Panel UI`, `Typography Checks`?**
  _High betweenness centrality (0.130) - this node is a cross-community bridge._
- **Why does `q()` connect `Screenshot Library (vendor)` to `IM Viewer & HTML Sanitization`, `App Shell & Routing`, `Admin & Compliance Library`, `IM Publish Service`, `SKU Catalog`, `IM Block Library`, `Attribute Inputs & Block Editor`, `IM Shared UI & Languages`, `Live Insert CLI`, `SKU/Proposal/Compliance Forms`?**
  _High betweenness centrality (0.075) - this node is a cross-community bridge._
- **Are the 4 inferred relationships involving `ProjectIMGenerator()` (e.g. with `.textContent()` and `q()`) actually correct?**
  _`ProjectIMGenerator()` has 4 INFERRED edges - model-reasoned connections that need verification._
- **Are the 30 inferred relationships involving `el()` (e.g. with `browserFindingsFromMap()` and `collectVisualContrastCandidates()`) actually correct?**
  _`el()` has 30 INFERRED edges - model-reasoned connections that need verification._
- **Are the 2 inferred relationships involving `ProjectDetail()` (e.g. with `v()` and `sku()`) actually correct?**
  _`ProjectDetail()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `DEPRECATED_NAMES`, `HARNESS_DIRS`, `SKILL_FINGERPRINTS` to the rest of the system?**
  _315 weakly-connected nodes found - possible documentation gaps or missing edges._