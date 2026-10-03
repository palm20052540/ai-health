# Tong Fit — Project Master

> Canonical product and engineering reference for the Tong Fit AI Health Portal.
>
> Last verified: 3 October 2026 (Asia/Bangkok)
>
> Branch status: cloud/tong-fit-workflows-20261003 implements the decision-first workflows. Test-then-deploy was authorized on 3 October; see section 20 for release validation and the native Sites version for publication status. No GitHub merge is included.

## 1. Product Summary

Tong Fit is a private, single-user AI health and fitness portal. It combines Google Health data and Hevy training history to answer four practical questions:

1. How is my health changing?
2. How recovered am I?
3. How is my training progressing?
4. What should I do next?

The product behaves like a **fitness coach, but nerdy**: concise recommendations first, followed by the evidence, time range, and confidence behind them.

Tong Fit provides wellness and training guidance. It is not a medical device and must not diagnose, treat, or present uncertain inferences as medical facts.

### Production

- Site: <https://tong-fit-ai-health.palm20052540.chatgpt.site/>
- Hosting: GPT Sites, owner-private
- Sites project ID: `appgprj_6abb647b32d88191bd344fa93a8675ca`
- Supabase project ref: `wgolwcojpqydgtlfyjko`
- Primary timezone: `Asia/Bangkok`
- UI language: English
- Intended user count: one

## 2. Current Product Surface

This branch exposes three bottom-navigation tabs: Health, Recovery, and Training. Coach is temporarily hidden. Old `?tab=Coach` links and saved Coach selections open Recovery; unsupported tab names also fall back to Recovery. The selected supported tab is persisted so stale Coach state is repaired.

### Health

- A narrative Daily Brief answers today's health picture before six rated themes: sleep, recovery, training readiness, training trend, activity, and attention
- Every theme includes explicit evidence and uncertainty; missing, stale and sample evidence cannot produce a personal rating
- Optional OpenAI-generated narrative/summary through the same-origin `/api/health-brief`; validated deterministic evidence remains authoritative
- Visible distinction between AI generated, rules-based, unavailable, cached and configuration/connection states
- Detailed source metrics and charts follow the brief; windows are 7D, 30D, 3M, 6M and 1Y
- No synthetic fallback metrics, workouts or recommendations when real data is empty or unavailable
- Body composition, goal physique and local progress photos remain available

### Recovery

- A decision first: train as planned with a check-in, reduce, rest, or insufficient evidence
- Draft pain location, pain severity (0–10) and fatigue (0–10) become active only with **Update recommendations**
- The button re-fetches a fixed 28-day evidence window, then uses the newest submitted input and saved goal/profile; repeated clicks are deduplicated
- A failed refresh withdraws previous advice; new evidence, settings, a Bangkok calendar day or more than 12 hours invalidate it
- Saved check-in inputs and configurable goals/profile stay local to this browser; applied recommendations and raw source snapshots are not persisted
- Conservative, unvalidated wellness rules, not medical readiness validation; no diagnosis, drug/hormone guidance or increasing load through pain
- Existing evidence rows, recovery charts and source timestamps remain visible below the decision

### Training

1. **Latest session review:** actual working volume and sets, logged RPE/coverage, same-exercise-ID comparisons and contextual narrative; extra volume alone is never an improvement score
2. **Next session plan:** actual Hevy routine list and detail by stable IDs, per-exercise load/sets/reps, goal/effort/recovery reasons, editable local draft and reset; no write to Hevy
3. **Long-term progress:** 1M/3M/6M/12M windows, observed record span and comparison gaps, exercise detail and primary-muscle-only totals (including Core and Other)

Routine history matching requires exercise-template IDs on both catalog and session records. Two distinct, recent sessions with at least 80% valid RPE coverage are needed for automatic targets. Source freshness, applied recovery, pain and fatigue guardrails take precedence. An optional extra rep at the same load may be suggested; a kg increase is never automatic. Older payloads without identity/coverage fields safely abstain until the updated backend is available.

### Coach (temporarily hidden)

Coach is not rendered or listed in bottom navigation on this branch. The frontend does not request `/api/coach`. The existing Coach component, API helper, and Worker route are retained for a reversible restoration; this change does not delete backend functionality.

Retained implementation:

- Adaptive daily brief combining Health, Recovery, and Training
- Ranked cross-signal priorities
- One next-best action with prescription, explanation, and confidence
- Evidence-coverage summary
- Link into the next-session recommendation flow
- Wellness disclaimer

The retained Coach implementation supports two operating modes:

1. **Evidence Engine** — deterministic reasoning from live aggregate data; always available.
2. **Model-generated mode** — the safe Health Brief generator also adapts output for the dormant Coach route; HTTP model calls require both the server-side key and configured allowed-user gate.

The UI must state which mode produced the result. Never represent deterministic fallback text as model-generated output.

## 3. User Configuration

Configuration is stored locally in the browser under `tong-fit:settings:v1`.

Current sections:

- Goals: primary goal, duration, target weight, training frequency, and focus exercises
- Training preferences: training days, equipment, style, rest days, RPE limits, and weekly set target
- Personal context: age, height, limitations, previous injuries, and precautions
- Analytics: unit, baseline length, comparison mode, and featured metrics
- Goal physique: free-text physique description and progress photos

Settings are browser-local. They are not currently synchronized across devices or persisted in Supabase.

## 4. System Architecture

```mermaid
flowchart TD
    U[Private user] --> S[GPT Sites UI]
    S --> W[Same-origin Cloudflare Worker]
    W -->|Bearer site API key| E[Supabase hevy-actions Edge Function]
    E --> DB[(Supabase Postgres)]
    E --> H[Hevy API]
    E --> G[Google Health API]
    S --> LS[Browser localStorage]
    W -. optional aggregate snapshot .-> O[OpenAI Responses API]

    C[Supabase Cron / manual sync] --> SYNC[sync-health-data Edge Function]
    SYNC --> G
    SYNC --> DB
```

### Frontend

- React `19.1.1`
- React DOM `19.1.1`
- Vite `8.0.16`
- Mobile-first layout with a maximum app width of 440 px
- Plain CSS design system in `src/styles.css`
- No client-side router; tab state is held in React and persisted to localStorage
- Live payloads are cached in memory by day range for the current session

### GPT Sites Worker

`worker/index.js` is the same-origin backend-for-frontend.

Responsibilities:

- Serve the static React bundle
- Keep upstream credentials out of browser code
- Enforce the optional `ALLOWED_USER_EMAIL` check
- Proxy dashboard, sync, freshness, and routine requests to Supabase
- Call the OpenAI Responses API for the Health Daily Brief when configured and authorized; retain a safe dormant Coach adapter
- Return JSON with `Cache-Control: no-store`

The browser must call only same-origin `/api/*` routes. It must never call Supabase with a private API key or call OpenAI directly.

### Supabase

Supabase owns persistence, external-source synchronization, aggregation, and API authorization.

Edge Functions:

- `oauth-callback` — completes Google OAuth and stores tokens
- `sync-health-data` — refreshes tokens and synchronizes Google Health data
- `hevy-actions` — serves Custom GPT, plugin, and portal API routes; also manages Hevy routines

All three functions currently set `verify_jwt = false` in `supabase/config.toml` and perform explicit application-level authorization. Do not remove the custom authorization checks when changing `verify_jwt`.

### Data Sources

- Google Health API: activity, sleep, heart rate, HRV, resting heart rate, exercise sessions, active-zone minutes, and weight
- Hevy API: workouts, exercises, sets, RPE, routines, and body measurements
- Progress photos: browser-local storage at present

## 5. Request and Data Flow

### Dashboard read

1. `App.jsx` converts the selected range to 7, 30, 180, or 365 days.
2. `src/portalData.js` requests `GET /api/dashboard?days=N`.
3. The Site Worker calls `GET /v1/portal-dashboard?days=N` on `hevy-actions`.
4. Supabase returns one compact aggregate payload.
5. `buildLiveView()` converts that payload into UI-ready view data.
6. React components derive charts, insights, and recommendations from the view.

One compact dashboard request per range is preferred over many widget-level queries.

### Manual synchronization

1. The user taps **Sync now**.
2. The browser calls `POST /api/sync`.
3. The Worker calls `POST /v1/sync-missing-data`.
4. Supabase applies per-source cooldown and atomic sync guards.
5. The app refreshes the currently selected dashboard range.

Do not sync Hevy or Google Health on every page load. Synchronization is manual or scheduled so repeated browsing does not waste Supabase or external API usage.

### Health Daily Brief generation

1. The browser allowlists only numeric aggregate statistics and dated source freshness. No IDs, workout titles, raw records, notes, pain reports, goals/free text, photos or credentials enter the model request.
2. `POST /api/health-brief` sanitizes again, builds a conservative evidence draft and checks current coverage. It can report configuration safely even if the separate health API is not configured.
3. Missing/stale/sample evidence abstains. Without `OPENAI_API_KEY`, the draft is explicitly rules-based. An HTTP request with a key but no `ALLOWED_USER_EMAIL` is also withheld from the model (`authorization_not_configured`).
4. The Responses API uses `store: false` and strict JSON schema. The model can tighten narrative/summary wording; theme IDs, ratings, evidence and uncertainty must match the evidence engine exactly. Invalid, refused, incomplete or unsafe output falls back honestly.
5. Cache entries are scoped to viewer/input/model/schema version, bounded to 32, and expire after 5 minutes; failures have a 30-second cooldown. Concurrent identical calls deduplicate; server timeout is 10 seconds and client timeout is 12 seconds.
6. The existing `/api/coach` route adapts this validated result for compatibility; the frontend still never requests Coach.

Production configuration was not queried or changed in this implementation. No live model request was made. Only synthetic mocks exercised configured-model behavior.

## 6. API Surface

### Browser-to-Site routes

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/api/dashboard?days=N` | Fetch one aggregate portal payload |
| `POST` | `/api/sync` | Synchronize missing Hevy and Google Health data |
| `GET` | `/api/status` | Read data freshness |
| `GET` | `/api/routines` | List Hevy routines |
| `GET` | `/api/routines/:id` | Read one routine |
| `POST` | `/api/routines` | Create a routine |
| `PUT` | `/api/routines/:id` | Update a routine |
| `POST` | `/api/health-brief` | Validated aggregate Health Daily Brief with honest fallback |
| `POST` | `/api/coach` | Dormant safe compatibility adapter |

### Compact Supabase routes

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/v1/daily-state` | Current health and recovery state |
| `GET` | `/v1/health-recap?days=N` | Aggregate health recap |
| `GET` | `/v1/workout-progress?days=N` | Aggregate workout progress |
| `GET` | `/v1/data-freshness` | Source freshness |
| `GET` | `/v1/portal-dashboard?days=N` | Portal payload |
| `POST` | `/v1/sync-missing-data` | Guarded data sync |

Legacy Custom GPT Action routes remain available for backward compatibility. New portal work should prefer `/v1` routes.

## 7. Data Model

Important tables include:

- `health_tokens` — Google OAuth tokens per user
- `health_metrics` — flexible source records stored as `jsonb`
- `sync_logs` — sync attempts and status
- `hevy_workouts` and related Hevy tables — workout history and sets
- `workout_health_summaries` — measured physiology contained within workout windows

RLS is enabled on user-owned health tables. Authenticated reads must be scoped to `auth.uid() = user_id`. Edge Functions use the service role only on the server.

### Time and units

- Persist timestamps in an unambiguous timezone-aware format.
- Render user-facing dates in `Asia/Bangkok`.
- Default weight unit is kilograms.
- Estimated 1RM is directional guidance, not a maximum-attempt prescription.
- Source-reported calories may be shown as trend context but must not be treated as a precise caloric-deficit measurement.

## 8. Environment and Secrets

Never commit real secrets. `.env`, `.dev.vars`, generated build secrets, and service credentials must remain outside Git.

### Local development

Common local variables:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_PROJECT_REF`
- `SUPABASE_ACCESS_TOKEN`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`
- `GOOGLE_OAUTH_STATE`
- `HEALTH_USER_ID`
- `HEALTH_SOURCE`
- `SYNC_SHARED_SECRET`
- `SYNC_WINDOW_DAYS`

### GPT Sites production environment

- `AI_HEALTH_API_URL`
- `AI_HEALTH_PLUGIN_API_KEY` — contains the dedicated Site API key value
- `ALLOWED_USER_EMAIL` — required before HTTP model generation; visitor email must match
- `OPENAI_API_KEY` — optional server-only key for Health Brief narrative/summary generation
- `OPENAI_MODEL` — optional model override

The value stored as the Site's `AI_HEALTH_PLUGIN_API_KEY` should match the Supabase `AI_HEALTH_SITE_API_KEY`. Keep the Site key separate from the personal Codex plugin key.

### Supabase function secrets

The deployed functions may require:

- `SERVICE_ROLE_KEY`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`
- `GOOGLE_OAUTH_STATE`
- `HEALTH_USER_ID`
- `HEALTH_SOURCE`
- `SYNC_SHARED_SECRET`
- `HEVY_API_KEY`
- `HEVY_ACTIONS_API_KEY`
- `AI_HEALTH_PLUGIN_API_KEY`
- `AI_HEALTH_SITE_API_KEY`

Use different credentials for the Custom GPT, personal plugin, and Site whenever practical.

## 9. Repository Map

```text
AI Health/
├── .openai/hosting.json          # Sites project binding only
├── src/
│   ├── App.jsx                   # App composition, loading, tabs, sheets
│   ├── CoachView.jsx             # Adaptive Coach and Evidence Engine
│   ├── TrainingView.jsx          # Training analytics and exercise sheets
│   ├── healthView.js             # API payload → live UI view model
│   ├── portalData.js             # Browser API client
│   ├── components.jsx            # Shared UI primitives
│   ├── DetailSheets.jsx          # Workout, exercise, and recommendation sheets
│   ├── SettingsSheets.jsx        # Configuration UI
│   ├── settings.js               # Defaults and local persistence
│   ├── icons.jsx                 # Shared SVG icon system
│   └── styles.css                # Design tokens and responsive CSS
├── worker/index.js               # Sites Worker and private API proxy
├── supabase/
│   ├── config.toml               # Edge Function verification config
│   ├── functions/
│   │   ├── hevy-actions/
│   │   ├── oauth-callback/
│   │   └── sync-health-data/
│   └── migrations/               # Database history
├── scripts/                      # Build, deploy, OAuth, and sync helpers
├── hevy-gpt-actions.openapi.yaml # Custom GPT Actions contract
├── vite.config.js
└── package.json
```

## 10. Coding Guidelines

### General

- Prefer the smallest change that preserves the current architecture.
- Keep business calculations in pure functions, not inside JSX.
- Derive display state with `useMemo` when the calculation is non-trivial.
- Do not duplicate server data in React state unless the user can edit it.
- Use functional state updates when the next state depends on the previous state.
- Keep `App.jsx` as composition and orchestration; move feature-specific rendering into focused modules.
- Reuse existing components and CSS tokens before adding a new component family.
- Do not silently invent health values, sessions, dates, or confidence scores.

### Data calculations

- Every insight must identify its time range.
- Show only dates that have source data.
- Deduplicate workouts when combining muscle groups.
- Do not average percentages when a weighted calculation is required.
- Distinguish missing data from a true zero.
- Preserve raw source timestamps; do not infer set or exercise timestamps.
- Separate observation, inference, and recommendation.
- Attach confidence to recommendations that depend on incomplete coverage.

### AI and wellness guidance

- Use the supplied aggregate data only.
- Never diagnose or prescribe medical treatment.
- Avoid causal claims unless the data design supports them.
- Phrase correlations as possibilities: “may be associated with,” not “caused by.”
- Provide one clear action before secondary detail.
- Include evidence and confidence.
- Fall back safely when the model is unavailable or returns invalid output.
- Never allow model text to alter credentials, authorization, or server configuration.

### Accessibility

- Target WCAG 2.2 AA.
- Use semantic headings and landmarks.
- All icon-only buttons require an accessible label.
- Interactive pills use `aria-pressed` and a group label.
- Bottom sheets must trap focus, close on Escape, restore focus, and prevent background scrolling.
- Maintain a minimum 44 × 44 px touch target where practical.
- Never rely on color alone to communicate status.
- Respect `prefers-reduced-motion` for new animation.

### Styling

- Preserve the clean, techy white/blue/orange visual direction.
- Keep the mobile-first 440 px app shell.
- Use existing CSS custom properties for color, spacing, and surfaces.
- Prefer open sections and lists over nested card grids.
- Avoid adding decorative badges, gradients, or icons without a functional purpose.
- Check both narrow mobile and desktop-hosted mobile-shell layouts.

### Security

- Never expose `SUPABASE_SERVICE_ROLE_KEY`, Google secrets, Hevy keys, Site API keys, or OpenAI keys to the browser.
- Never place runtime secrets in `.openai/hosting.json`.
- Validate request methods, paths, ranges, and JSON bodies at the Worker boundary.
- Keep the Site owner-private unless the user explicitly changes its audience.
- Keep `ALLOWED_USER_EMAIL` aligned with the account opening the private Site.
- Use `Idempotency-Key` for routine writes.
- Do not log tokens, authorization headers, raw health payloads, or model prompts containing sensitive data.

## 11. Development Workflow

### Install and run

```powershell
npm install
npm run dev
```

Default local URL:

```text
http://127.0.0.1:5173/
```

### Required checks

```powershell
node --test tests/navigation.test.js
npm run check
npm run build
git diff --check
```

`npm run build` performs:

1. Clean `dist`
2. Build the Worker
3. Build the React client
4. Remove build-time secrets
5. Generate the GPT Sites-compatible server entrypoint and hosting metadata

### Browser QA

Before publishing a visible change, verify:

- Correct production or local URL and page title
- Meaningful content renders; no framework error overlay
- No relevant console warnings or errors
- Health, Recovery, and Training navigation; Coach must remain hidden
- Old Coach links, saved Coach state, and unknown tabs fall back to Recovery
- At least one interaction affected by the change
- Live-data, loading, error, empty, and fallback behavior as applicable
- Mobile layout, fixed bottom navigation, sheets, focus, and scrolling

For data bugs, inspect the API response and source coverage before changing UI code.

## 12. Deployment

### Supabase

Supabase changes are deployed separately from the Site.

```powershell
npm run check
supabase functions deploy <function-name> --project-ref wgolwcojpqydgtlfyjko
```

Use migrations for persistent database changes. Review RLS, grants, and database advisors before considering a schema change complete.

### GPT Sites

The Site source is bound through `.openai/hosting.json`. Publishing requires:

1. Build and validate the exact source state.
2. Push that state to the Site source repository.
3. Package the matching `dist` archive.
4. Save a Site version using the pushed commit SHA and archive.
5. Deploy the saved version privately.
6. Confirm deployment status and production URL.

Updating Site environment variables does not update a running deployment by itself. Deploy a saved version after an environment revision so the new values take effect.

## 13. Error Handling and Fallbacks

### Frontend

- Dashboard failure: show sample data plus the returned error message.
- Coach failure: retain the deterministic Evidence Engine.
- Sync failure: show a dedicated bottom sheet.
- Missing metric: display an em dash, not zero.

### Worker status conventions

- `401`/`403`: authentication or allowed-user problem
- `402`: Supabase usage limitation; explain that live data will resume when service is restored
- `502`: upstream health API or OpenAI failure
- `503`: required Worker configuration missing

### Authentication troubleshooting order

1. Confirm whether `/api/dashboard` fails before or inside the Site Worker.
2. Check GPT Sites Worker logs.
3. Confirm the Site is active and the current account is allowed.
4. Confirm `ALLOWED_USER_EMAIL` matches the authenticated Site visitor.
5. Confirm the Site `AI_HEALTH_PLUGIN_API_KEY` matches Supabase `AI_HEALTH_SITE_API_KEY`.
6. Call the Supabase endpoint directly with an authorized server-side credential.
7. Inspect Supabase Edge Function invocation logs.

Do not rotate or replace credentials until the failing layer has been identified.

## 14. Current Operational Note

As of 3 October 2026, the private Site has reproduced a same-origin `/api/dashboard` `401` while the direct Supabase dashboard endpoint returned `200`. No corresponding Site Worker error event was recorded. This indicates the request can be rejected by the private Site authorization layer before reaching application code, commonly because of a stale or missing browser authentication session.

First recovery step: reopen or refresh the Site with an active ChatGPT session. If the issue persists, inspect the Sites auth client/access policy before modifying Supabase credentials.

## 15. Known Limitations

- Single-user architecture
- Settings and photos are local to one browser
- Model output requires a Site-side `OPENAI_API_KEY` and allowed-user authorization; this change does not verify or configure production secrets
- No medical diagnosis or clinical decision support
- No automatic routine mutation without explicit user review
- Estimated 1RM and progression guidance depend on Hevy logging quality and RPE coverage
- OAuth tokens are stored in protected database columns rather than per-token Vault references
- Historical source coverage varies by metric

## 16. Near-Term Roadmap

1. Stabilize GPT Sites private-session authentication for `/api/*` requests.
2. Keep Coach hidden until its product direction and model setup are approved.
3. If Coach is restored, configure its key through the approved Site secret flow and validate model-generated output against the Evidence Engine.
4. Add recommendation outcome tracking: suggested action → performed action → result.
5. Add weekly review and progress forecasting with explicit confidence bands.
6. Add physique-photo comparison with conservative, non-diagnostic language.
7. Move settings and photo metadata to private Supabase storage if cross-device use becomes necessary.

## 17. Definition of Done

A change is complete only when:

- The requested behavior is implemented.
- Calculations use real source data or are clearly labeled sample data.
- Security boundaries remain intact.
- `npm run check`, `npm run build`, and `git diff --check` pass.
- The affected flow is verified in a browser.
- Console errors are resolved or explicitly documented.
- Merge or production deployment occurs only when separately authorized; cloud-only implementation is delivered on an isolated branch.
- This master document is updated when architecture, environment keys, routes, major features, or operational constraints change.


## 18. Cloud-Only Verification — 3 October 2026

This isolated change was prepared on the assistant cloud computer from `agent/add-hevy-integration` at `03efc5012e4a7fa90aad5b92f8c47d13c9e09a02`. The 52 materialized source files were verified against their GitHub blob hashes before editing. Design image assets and environment examples were not needed for this local build and were not copied; existing repository files are preserved by the branch change.

Changes:

- Hide Coach from the UI while preserving its unused component and server route.
- Centralize the three visible tabs in `src/navigation.js` and normalize unsupported URL/saved tabs to Recovery.
- Use equal-width automatic navigation columns and stop the frontend Coach-generation effect.
- Add five dependency-free navigation regression tests.

Verification in the cloud:

- `node --test tests/navigation.test.js`: passed, 5 tests.
- `npm run build`: passed, including Worker, React client, secret-output sanitation, and Sites server packaging.
- Actual React server rendering: passed 6 URL/saved-tab scenarios, each with 3 navigation buttons and no Coach.
- `git diff --check`: passed.
- `npm run check`: attempted; Deno dependency downloads did not complete in this environment within the bounded retry. The aggregate Deno type check is unverified, not passed.
- Browser QA: blocked before page load because isolated Chromium could not create its Unix socket (`Operation not permitted`). The dedicated cloud browser also blocked the loopback preview URL (`ERR_BLOCKED_BY_CLIENT`). Interactive behavior and visual layout still require browser verification.
- Credential-pattern scan of source files: no matching private-key/token patterns found. No real `.env`, runtime credentials, health records, or model calls were used for this proof.

This verifies cloud source access, code editing, focused regression checks, and production build execution without the user's PC. It does not verify live health APIs or production behavior. No merge or deployment is included. Before release, complete the aggregate type check and browser QA against this exact branch.


## 19. Decision-First Workflow Implementation — 3 October 2026

### Source and publication scope

Prepared in the assistant cloud checkout. Before editing, the original repository's `agent/add-hevy-integration` was rechecked at `03efc5012e4a7fa90aad5b92f8c47d13c9e09a02`; the verified Coach-hiding branch remained `cb622791ac677dc0d0e5426d36f4fbf87d579889`. This isolated implementation branch builds on that Coach-hiding commit. Existing remote files omitted from the local materialization are preserved using the remote base tree; no force update to user branches is used.

Code and this master document are published together in `palm20052540/ai-health`, branch `cloud/tong-fit-workflows-20261003`. No new repository, PR merge, production deployment, schema application, live Hevy write, OAuth grant, paid model call or real health-data export is included.

### Calculation and safety contract

- Numeric null, undefined, blank, nonnumeric, boolean and object values stay missing. Actual numeric zero remains zero; RPE zero is invalid because logged RPE must be 1–10.
- Summary, recent workouts, muscle totals and exercise progress share normalized non-warmup working-set semantics. RPE coverage counts valid RPE divided by all working sets. A hard set is the documented convention of valid RPE at least 7.
- Primary muscle attribution only. Secondary muscles are not counted. Unknown muscle assignment is never guessed from exercise title.
- Stable template IDs isolate same-name exercises and retain renamed-template history. Source reads are paginated; missing e1RM stays null. Repeated exercise blocks cannot masquerade as separate workouts.
- Recovery thresholds are conservative product heuristics, not clinically validated cutoffs: sleep below 6h, HRV more than 20% below the available average, resting HR more than 10% above average or fatigue at least 5 suggest reduction. Pain always prevents progression; pain at least 7 or fatigue at least 8 suggests rest from strenuous work.
- A train decision requires pain-free, explicit input; fresh measurement AND sync times (48h) for sleep, HRV and resting HR; positive available baselines and at least three HRV/resting-HR readings. Missing any source yields unknown. Saved free-text restrictions/injuries also require individual review and prevent automatic clearance.
- This strict all-three-source requirement can often abstain when a wearable does not supply one metric. Abstention is intentional; it is not a claim that the user is unwell.
- Health Brief trend comparisons require stable IDs and distinct dated workouts. Per-source freshness is visible and a recent sync of one source cannot make another source current.
- Existing sync implementation limits remain unchanged: Google Health default 7 days/max 90 days, heart-rate sync 14 days, dashboard reads up to 365 stored days. Selected windows are not proof that history exists. `sync-hevy-data` source and original Hevy table migrations are absent from this checkout; their deployed existence was not checked.

### Verification

- `npm run test`: 76 passing synthetic/mocked unit and actual React server-render tests at this checkpoint; no live service calls.
- `npm run lint`: scoped lint for the 17 changed frontend/Worker/analytics modules. The Deno-only no-window rule is excluded for browser-targeted code.
- Actual React hook interaction harness (temporary QA tooling): passed initial loading, explicit draft/apply, duplicate-submit dedupe, routine switching, local override/reset, 3M/12M changes, pain propagation across tabs and failed-refresh invalidation. This is component interaction evidence, not browser DOM/layout proof.
- `npm run build`: full Worker/client build plus existing secret-output sanitation and Sites packaging passed. Wrangler's local log-directory warning is non-fatal.
- Offline Deno typecheck of pure backend analytics passed. A scoped function check with a temporary permissive SDK declaration also passed, but does not validate real SDK types.
- `npm run check`: attempted with the real pinned imports; dependency downloads did not finish before the 75-second limit. Full aggregate SDK typecheck remains unverified.
- Browser QA: the supported cloud browser refused the loopback preview before page load (`ERR_BLOCKED_BY_CLIENT`). No access restriction was bypassed; no real rendered screenshot, responsive layout, browser console or native browser interaction claim is made.
- Process configuration presence only was inspected: `OPENAI_API_KEY`, `OPENAI_MODEL`, `AI_HEALTH_API_URL`, `AI_HEALTH_PLUGIN_API_KEY` and `ALLOWED_USER_EMAIL` were unset in this cloud test process. Values were not inspected; no production secret/configuration inference is made.

### Release gates and known boundaries

Complete full SDK typecheck and browser/responsive QA against the exact branch before release. Deploying the new Supabase action and frontend Worker remains a separate authorized operation; older backend payloads cause safe missing-ID/RPE-coverage states. If the most recent workout falls outside the selected progress window, its actual overview is shown while exercise comparison detail explicitly reports unavailable coverage. Local input/settings persistence has no cross-device guarantee. Model output can remain unavailable until the production key, allowed-user gate and endpoint are verified through approved configuration steps.


## 20. Authorized Release Validation — 3 October 2026

The user authorized testing first and then deploying to the existing owner-private Site. Its verified pre-release state is Site version 5, source `b8309e3a3ead19ad315d4f2a522c487a0261e0ea`; the original repository implementation is `bfee716463aa8c4364d5ee15f443cd52ee6ca731`. The native source-opening helper restored the existing Site source. All overlapping baseline files match the original GitHub source; Site-only design assets and environment examples are preserved.

### Repairs and reproducible validation

- Added the exact already-imported `@supabase/supabase-js@2.110.2` SDK as a pinned development dependency. `npm run check` now uses Deno's manual local-module mode, avoiding the unavailable direct-registry route and checking real SDK types without permissive stubs. Package and Deno lockfiles are synchronized.
- Read-only schema inspection established that generated Bangkok timestamp columns have no timezone suffix. Added explicit Bangkok-to-instant normalization so evening workouts do not appear seven hours later, shift chart dates, lose observed coverage or distort duration. Canonical UTC timestamps take precedence when supplied.
- `npm run check`: passed all five entrypoints with the actual pinned SDK.
- `npm run test`: 81 synthetic/mocked/React-render tests passed, including five new timezone regressions.
- `npm run lint`: passed all 18 scoped changed modules.
- The component interaction harness remains synthetic and covers applied check-ins, duplicate clicks, routine selection/edit/reset, goal/evidence invalidation and range changes. No model, health-sync or Hevy write calls are used by these tests.
- Native Sites build helper runs the existing full Worker/client build and archive preparation pipeline. The exact candidate source is pushed before native version save/publication.
- Actual browser, screenshot and responsive-layout QA remain **unverified**: this cloud runtime is portable, has no supported forwarded/supervised preview, and raw loopback browser access is blocked. This limitation is disclosed; it is not counted as a passing test. There are no known failing functional checks in the tested candidate.

### Backend and configuration compatibility

Read-only deployment/source inspection confirmed existing `hevy-actions` version 23 matches the pre-change source (apart from trailing whitespace). The updated action retains the existing custom API-key authentication and `verify_jwt: false` setting; no security mode is weakened. Existing tables have the fields used by the new analytics, and no database migration is needed. Only `hevy-actions` code needs a compatible backend update; OAuth, health sync and importer functions are preserved.

`sync-hevy-data` is deployed and active at version 6. Its implementation and original table migrations remain absent from this source checkout; that absence is not a claim that the live importer is missing. No importer code or data is changed.

Site configuration metadata lists the health API URL and existing Site/access secrets. Secret values were not copied, extracted or changed. No `OPENAI_API_KEY` or `OPENAI_MODEL` entry exists at the time of inspection, so the new Daily Brief will report rules-based fallback; live AI generation is not verified or activated. Existing private audience is owner-only, with no extra users/groups or external visitors, and is preserved.

Deployment uses the same project and private publishing operation after the final checks. A successful native version/deployment receipt is the source of truth for the actual live version and URL. No merge to GitHub main, schema/data write, OAuth change, credential setup, billing change or paid model test is part of this release.
