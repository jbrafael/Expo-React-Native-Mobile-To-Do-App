# TaskFlow — Build Log

Chronological, append-only development log for the TaskFlow Expo / React Native To-Do app.
Earlier entries are never rewritten; corrections appear as new entries.

Environment used throughout (unless an entry says otherwise):

- Host: Windows + WSL2 (Linux 6.18, x86_64), shell `bash`
- Node v20.19.2, npm 11.6.2 (no Bun → `npx` is used, `package-lock.json` is the lockfile)
- Coding agent: Claude Code (model Claude Opus 5.5) working through terminal and file-editing tools

---

## Entry 1 — Workspace inspection and documentation bootstrap

**Date:** 2026-10-10 19:40 (-03:00)

### Prompt / Request
> "Expo + React Native Mobile To-Do App — Master Implementation Prompt … Begin by inspecting the workspace, recording the initial state, and creating the documentation files. Then proceed incrementally."

(The full assignment specification was supplied as a single prompt; it is summarised per step in the entries below.)

### Decision Summary
- The workspace `TaskFlow/` is **not** the earlier Kotlin Multiplatform project: it is a freshly generated `create-expo` (v5.0.1) template committed as `d27921e Initial commit`. The parent directory contains only `TaskFlow/`, so there is no KMP code to protect. The implementation is done in place inside `TaskFlow/`.
- The template already pins **Expo SDK 54** (`expo ~54.0.36`, React Native 0.81.5, React 19.1, Expo Router 6, TypeScript 5.9 with `strict: true`). I keep SDK 54 rather than upgrading: it is what the template resolved, all docs are fetched for `v54.0.0`, and an SDK upgrade adds risk without benefit for this assignment.
- The project's `AGENTS.md` asks for routes under `src/app/` and non-route code outside it. The template uses a root-level `app/`. I will move to a `src/` layout (`src/app` for routes, `src/db`, `src/notifications`, … for the rest), which Expo Router supports natively.
- Documentation files (`BUILD_LOG.md`, `README.md`, `QUESTIONNAIRE.md`) are created before any feature work, as required.

### Actions Performed
- Commands: `ls -la`, `cat package.json app.json tsconfig.json .gitignore eslint.config.js`, `git log`, `git remote -v` (no remote configured), `node -v`, `npm -v`, `which bun adb emulator java`, `adb devices -l`.
- Found tooling:
  - `adb` 34.0.4 in WSL (`/usr/lib/android-sdk/platform-tools`), **no devices attached** from the WSL side.
  - No `java`, no `emulator`, no `bun`, no `eas` on the WSL `PATH`.
  - A Windows-side Android SDK at `C:\Users\rafae\AppData\Local\Android\Sdk` (emulator, platform-tools, system images) with one AVD: `TodoTestAVD`.
- Created `BUILD_LOG.md` (this file), replaced the template `README.md` with a project README skeleton, created `QUESTIONNAIRE.md` with the eight questions (answers filled in at the end, from the final code).

### Result
Initial state recorded. Documentation files exist. No application code changed yet.

### Problems / Errors
- None yet. Noted risk: a native Android build (development build) needs a JDK + Android SDK reachable from WSL, which is not currently installed in WSL.

### Fixes Attempted
- N/A

### Current Status
Completed

---

## Entry 2 — Documentation research, dependency installation, architecture decision

**Date:** 2026-10-10 19:50 (-03:00)

### Prompt / Request
> "Before installing dependencies, inspect the current environment and determine the compatible Expo SDK and package versions. Use Expo's compatibility tooling … Record every important dependency, its purpose, and the reason for selecting it in `BUILD_LOG.md`."

### Decision Summary
Docs fetched for the installed major version (SDK 54): `docs.expo.dev/versions/v54.0.0/sdk/sqlite`, `/sdk/notifications`, `/sdk/date-time-picker`.

Findings that shaped the design:
- **expo-sqlite (SDK 54)** offers `SQLiteProvider` (`databaseName`, `onInit`) + `useSQLiteContext()`, and async `runAsync` / `getAllAsync` / `getFirstAsync` / `execAsync` / `withTransactionAsync`. Docs recommend `PRAGMA user_version` for migrations. Running migrations in `onInit` guarantees the schema exists before any child screen renders.
- **expo-notifications (SDK 54)**: local notifications *remain available in Expo Go*; only remote push was removed from Expo Go on Android in SDK 53. Date triggers use `{ type: SchedulableTriggerInputTypes.DATE, date, channelId }`. On Android 13+ the permission prompt can only appear after a notification channel exists, so the channel is created before requesting permission. `scheduleNotificationAsync` accepts an `identifier`.
- **Reboot restoration**: rather than trusting the doc sentence alone, I read the library source in `node_modules/expo-notifications/android`:
  - `AndroidManifest.xml` declares `RECEIVE_BOOT_COMPLETED` and registers `.service.NotificationsService` for `BOOT_COMPLETED`, `REBOOT`, `QUICKBOOT_POWERON`, `MY_PACKAGE_REPLACED`.
  - `NotificationsService.kt` → `onSetupScheduledNotifications()` → `ExpoSchedulingDelegate.setupScheduledNotifications()` re-schedules **every request in its persistent store** (`store.allNotificationRequests`).
  - `ExpoSchedulingDelegate.kt:106` uses `setExactAndAllowWhileIdle` only when `SDK_INT < S || alarmManager.canScheduleExactAlarms()`, otherwise falls back to inexact `setAndAllowWhileIdle`.
  - ⇒ Android reboot restoration is provided natively by the library, **with no custom native code or config plugin**. The app adds a JS-level startup reconciliation as a second safety net (covers app-data/notification-store drift, edits made while the alarm was lost, etc.). In Expo Go the boot receiver belongs to the Expo Go app, so reboot behaviour must be evaluated on a development build.
- **Date picker**: `@react-native-community/datetimepicker` is the SDK-54-listed picker and is included in Expo Go. Android uses the imperative `DateTimePickerAndroid.open()` (date dialog, then time dialog); iOS uses the inline component.

Architecture chosen (simple, no extra state library):

```
Screen (src/app/*.tsx)
  → TaskStore context hook (src/state/TaskStore.tsx)   — shared tasks/categories, mutations, explicit refresh
      → repositories (src/db/*Repository.ts)          — parameterised SQL only
      → reminder service (src/notifications/reminders.ts) — all expo-notifications calls
  → expo-sqlite → taskflow.db
```

- A single Context is justified because three screens share the same task/category lists; Redux/Zustand would add a dependency without a concrete need.
- **Refresh strategy:** explicit. Every mutation in the store awaits the repository write, syncs the reminder, then re-queries tasks/categories (`refresh()`). Plain SQLite queries are not reactive; expo-sqlite's change listener was considered but rejected as less explicit and harder to test.
- **Reminder identity:** deterministic identifier `task-<id>` so re-scheduling a task always targets the same OS request (cancel + schedule) and reconciliation cannot create duplicates.

### Actions Performed
- `npx expo install expo-sqlite expo-notifications expo-device @react-native-community/datetimepicker`

| Package | Resolved version | Purpose / why |
|---|---|---|
| `expo-sqlite` | ~16.0.10 | Persistent SQLite source of truth; first-party Expo module, works in Expo Go. |
| `expo-notifications` | ~0.32.17 | Local scheduled reminders; first-party; native boot re-scheduling on Android. |
| `expo-device` | ~8.0.10 | `Device.isDevice` to explain limitations on simulators/emulators in diagnostics. |
| `@react-native-community/datetimepicker` | 8.4.4 | Native date/time dialogs, version pinned by `expo install` for SDK 54, in Expo Go. |
| `expo-constants` | ~18.0.13 (template) | `Constants.executionEnvironment` to detect Expo Go vs dev build. |

- `expo install` automatically added the `expo-sqlite` and `@react-native-community/datetimepicker` config plugins to `app.json`.
- `npm` reported 43 audit vulnerabilities in the transitive dev/tooling tree (template baseline); not addressed with `npm audit fix --force` because it would break SDK-pinned versions.

### Result
Dependencies installed successfully, SDK-compatible versions pinned by Expo tooling.

### Problems / Errors
- None blocking. Noted: exact alarm scheduling on Android 12+ depends on `SCHEDULE_EXACT_ALARM`; without it reminders may be delayed by the OS.

### Fixes Attempted
- N/A

### Current Status
Completed

---

## Entry 3 — Template cleanup, project layout, data layer (models, schema, repositories)

**Date:** 2026-10-10 20:05 (-03:00)

### Prompt / Request
> "Initialize Expo and TypeScript … Implement the data models and SQLite schema … Implement task CRUD … Implement category CRUD … Keep raw SQL out of screen components. Use parameterized SQL statements … Use transactions when an operation requires multiple database changes."

### Decision Summary
- **Template removal:** the create-expo tab template (`app/(tabs)`, `modal.tsx`, themed components, parallax view, haptic tab, icon-symbol, `scripts/reset-project.js`, React logo images) was removed with `git rm`, and unused template dependencies uninstalled: `@react-navigation/bottom-tabs`, `expo-haptics`, `expo-image`, `expo-symbols`, `expo-web-browser`. Kept: `@expo/vector-icons` (Ionicons), `@react-navigation/native` (needed for `usePreventRemove`), safe-area, screens, reanimated/worklets (Expo Router stack dependencies).
- **Layout:** `src/app` (routes only, per `AGENTS.md`), `src/models`, `src/db`, `src/notifications`, `src/state`, `src/components`, `src/utils`, `src/theme`, `src/test`. `tsconfig` alias `@/*` → `./src/*`.
- **Timestamps:** ISO 8601 UTC strings (`toISOString()`), converted to local time only for display/picking. ISO UTC strings sort lexicographically in chronological order, so `ORDER BY due_date_time` is correct in SQL.
- **Schema (v1)** in `src/db/database.ts`:
  - `categories(id INTEGER PK AUTOINCREMENT, name TEXT NOT NULL UNIQUE COLLATE NOCASE CHECK(length(trim(name))>0))`
  - `tasks(id INTEGER PK AUTOINCREMENT, title TEXT NOT NULL CHECK(length(trim(title))>0), description TEXT, completed INTEGER NOT NULL DEFAULT 0 CHECK(completed IN (0,1)), due_date_time TEXT, created_at TEXT NOT NULL, category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL, notification_id TEXT)`
  - indexes `idx_tasks_category_id`, `idx_tasks_completed`.
  - Validation exists in **both** layers: repositories trim/validate and give friendly errors; CHECK/UNIQUE constraints protect the data even if a caller bypasses the repository.
- **Migrations:** ordered array of SQL scripts keyed by `PRAGMA user_version`; each step runs inside a transaction together with the `user_version` bump. `PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;` run on every open (foreign keys are per-connection in SQLite).
- **Duplicate category policy:** names are unique case-insensitively ("Work" vs "work" is a duplicate). Checked in the repository first (`DuplicateCategoryError`, friendly message) and enforced by `UNIQUE COLLATE NOCASE`. Renaming a category to a different casing of its *own* name is allowed.
- **Category delete policy:** keep the tasks, set `category_id = NULL`. `deleteCategory()` runs `UPDATE tasks SET category_id = NULL WHERE category_id = ?` and `DELETE FROM categories WHERE id = ?` inside `withTransactionAsync`. The FK `ON DELETE SET NULL` is a second line of defence.
- **Testability:** repositories take a `Db` parameter typed as `Pick<SQLiteDatabase, 'execAsync' | 'runAsync' | 'getAllAsync' | 'getFirstAsync' | 'withTransactionAsync'>` instead of importing a global connection, so tests can inject a Node SQLite engine.
- Additional task field: `notificationId` (TEXT, nullable) records the identifier of the reminder currently scheduled — useful for diagnostics/UI (bell icon) even though identifiers are deterministic.
- `app.json`: added `android.package` / `ios.bundleIdentifier` (`com.jbrafael.taskflow`, required for native builds), `expo-notifications` plugin (`color`), `android.permissions: ["android.permission.SCHEDULE_EXACT_ALARM"]` so reminders can fire on time on Android 12–13 (on Android 14+ this permission is denied by default for new installs and the library falls back to inexact alarms). Removed the `web` config: expo-sqlite on web needs extra WASM/COOP headers setup and web is out of scope.

### Actions Performed
- Removed template files listed above; `npm uninstall @react-navigation/bottom-tabs expo-haptics expo-image expo-symbols expo-web-browser`.
- Edited `package.json` scripts (removed `reset-project`, `web`; added `typecheck`, `test`), `tsconfig.json`, `app.json`.
- Created `src/models/types.ts`, `src/db/database.ts`, `src/db/taskRepository.ts`, `src/db/categoryRepository.ts`.

### Result
Data layer written. Verified later by unit tests (Entry 5).

### Problems / Errors
- None at this step.

### Fixes Attempted
- N/A

### Current Status
Completed

---

## Entry 4 — Reminder service, shared state, navigation and the three screens

**Date:** 2026-10-10 20:30 (-03:00)

### Prompt / Request
> "Implement a centralized reminder service with operations equivalent to: Schedule a reminder. Cancel a reminder. Reschedule a reminder. Reconcile reminders with persisted tasks. Restore eligible reminders at startup when appropriate." / "Implement at least these screens: Task List, Task Editor / Detail, Category Management."

### Decision Summary
- **`src/notifications/reminders.ts`** is the only module importing `expo-notifications`:
  `configureNotifications()` (foreground handler + Android channel `task-reminders`, HIGH importance), `getPermissionState()`, `ensurePermission()`, `scheduleReminder()` / `rescheduleReminder()`, `cancelReminder()`, `reconcileReminders()`, `listScheduledReminders()`, `isReminderEligible()`, `reminderIdentifier()` / `taskIdFromIdentifier()`, `reminderBody()` → `"Task reminder: <title>"`.
  - Identifier `task-<id>`; `scheduleReminder` always cancels that identifier first.
  - Eligible = not completed **and** due date strictly in the future; past due dates never schedule.
  - All functions catch errors and return a status (`scheduled | not-eligible | permission-denied | error`) — never throw into the save path.
  - Permission is requested **lazily**, the first time a reminder is actually needed, not at launch. Startup reconciliation never prompts.
- **Problem found while writing reconciliation (fixed before first run):** my first draft compared the *trigger date* returned by `getAllScheduledNotificationsAsync()` with the task's due date. Reading the native serialisers showed this is platform-dependent: Android's `DateTrigger.toBundle()` returns `{ type: 'date', value: <ms> }` (`NotificationTriggers.kt`), but iOS converts a date trigger into a `UNTimeIntervalNotificationTrigger` (`Records.swift`) and serialises it as `{ type: 'timeInterval', seconds }` (`EXNotificationSerializer.m`) — the absolute date cannot be read back on iOS. On iOS my draft would have cancelled and re-created every reminder on every launch. **Fix:** the reminder payload now carries `data: { taskId, dueDateTime }` and reconciliation compares `request.content.data.dueDateTime === task.dueDateTime`, which works on both platforms.
- **`src/state/TaskStore.tsx`** — React Context provider + `useTaskStore()` hook (ViewModel-style). Holds `tasks`, `categories`, `loading`, `error`, `permission`. Mutations: `createTask`, `updateTask`, `setCompleted`, `deleteTask`, `createCategory`, `renameCategory`, `deleteCategory`, plus `loadTask`, `countTasksInCategory`, `refresh`, `reconcile`. Each task mutation = repository write → `syncTaskReminder()` (schedule or cancel, then persist `notification_id`) → `refresh()`. Startup: `refresh()` first (UI usable immediately), then `reconcile()` in the background.
- **Navigation (Expo Router, native Stack)** in `src/app/_layout.tsx`:
  - `<SQLiteProvider databaseName="taskflow.db" onInit={migrateDbIfNeeded} onError={…}>` — migrations complete before any child screen renders (the provider renders nothing while opening). A DB failure shows an error screen instead of crashing.
  - Routes: `/` (`index.tsx`, list), `/task/[id]` (`task/[id].tsx`, editor; `id = "new"` creates), `/categories` (`categories.tsx`).
  - The list navigates with `router.push({ pathname: '/task/[id]', params: { id: String(task.id) } })`. Only the **id** is passed; the editor reads it with `useLocalSearchParams()` and loads the task from SQLite (`loadTask` → `getTaskById`), so it never edits stale data.
  - Tapping a delivered reminder opens its task (`Notifications.useLastNotificationResponse()` handles warm and cold starts).
- **Editor**: title validation (inline error), description, category chips, `DueDateField` (switch + Android `DateTimePickerAndroid.open` date then time dialogs; iOS compact inline pickers; warning when the chosen time is in the past), completed switch, Save (header + button), Cancel, Delete. **Unsaved input** is protected with React Navigation's `usePreventRemove`, which intercepts header back, Android hardware back and iOS swipe-back and asks "Discard changes?".
- **List**: status chips (All/Pending/Completed) + horizontally scrolling category chips (Any/Uncategorized/each category), loading spinner, error + Retry, two different empty states, completion checkbox, delete with confirmation, FAB to create, header button to categories, banner when notification permission is denied (with "Open settings").
- **Categories**: add (inline validation/duplicate error), inline rename, delete with confirmation that states how many tasks will be kept and uncategorized.

### Actions Performed
- Created `src/notifications/reminders.ts`, `src/state/TaskStore.tsx`, `src/utils/filterTasks.ts`, `src/utils/dates.ts`, `src/theme/colors.ts`, `src/components/{Chip,TaskRow,PermissionBanner,DueDateField}.tsx`, `src/app/{_layout,index,categories}.tsx`, `src/app/task/[id].tsx`.
- First draft of the editor used `router.dispatch(data.action)` in the discard handler; changed to `useNavigation().dispatch(...)` before running anything because I was not certain `router` exposes `dispatch` (the navigation object does).
- `npx tsc --noEmit` → exit 0. `npx expo lint` → exit 0, no warnings.

### Result
All screens and services written; typecheck and lint clean. Not yet run on a device.

### Problems / Errors
- iOS trigger-shape problem described above (caught by reading library source, not by a failing run).

### Fixes Attempted
- Payload-based comparison (final).

### Current Status
Needs testing

---

## Entry 5 — Test infrastructure and unit/component tests

**Date:** 2026-10-10 20:50 (-03:00)

### Prompt / Request
> "Jest and React Native Testing Library, or the current Expo-compatible testing setup, where practical." / "Add tests."

### Decision Summary
- `jest-expo` preset (SDK-54 version via `expo install`) + `@testing-library/react-native`.
- **Real SQL in tests:** `better-sqlite3` (dev-only) behind a small adapter `src/test/sqliteTestDb.ts` that implements the expo-sqlite async API subset (`Db`). Repository tests therefore exercise the actual SQL, constraints, FK and transactions on SQLite 3.53 rather than mocks. Trade-off: one native dev dependency; acceptable because it never ships in the app bundle.
- **Fake notification scheduler** `src/test/fakeNotifications.ts`: an in-memory map keyed by identifier with Android-style date triggers and controllable permission/failure, injected via `jest.mock('expo-notifications', …)`. These tests prove the app's *requests to the OS*, not delivery.

### Actions Performed
- `npx expo install jest-expo jest @types/jest @testing-library/react-native -- --save-dev` → **failed** (see Problems).
- `npx expo install jest-expo jest @types/jest -- --save-dev` and `npm install --save-dev react-test-renderer@19.1.0 @testing-library/react-native` → succeeded.
- `npm install --save-dev better-sqlite3 @types/better-sqlite3`.
- Moved `jest`, `jest-expo`, `@types/jest` from `dependencies` to `devDependencies` (expo install had put them in `dependencies`); pinned `react-test-renderer` to exactly `19.1.0`; added `"jest": { "preset": "jest-expo", "testMatch": [...] }` to `package.json`.
- Tests:
  - `src/db/__tests__/repositories.test.ts` — migrations (+ idempotency), insert/read/update/complete/reopen/delete, whitespace title rejection (repository and SQL CHECK), ordering, SQL-injection-style title stored verbatim, category create/list/rename, empty and case-insensitive duplicate names, **delete category keeps tasks** and **transaction rollback** (a trigger makes the DELETE fail after the UPDATE; the UPDATE must be rolled back).
  - `src/notifications/__tests__/reminderLifecycle.test.ts` — the numbered lifecycle rules 1–12 (create future/no-date, change date, remove date, complete, reopen future/past, delete, past date, duplicate-free repeated scheduling + reconciliation, permission denied, permission only requested while undetermined, scheduling failure keeps the task, startup reconciliation schedules missing / cancels completed, moved and orphaned reminders / leaves foreign notifications alone / never prompts).
  - `src/utils/__tests__/utils.test.ts` — filters and date helpers.
  - `src/app/__tests__/TaskEditorScreen.test.tsx` — RNTL: empty title rejected (no save), create with entered values, edit loads by id and saves via `updateTask`, not-found state.
- **Mutation check:** temporarily removed `await cancelReminder(task.id)` from `syncTaskReminder` → 3 lifecycle tests failed (remove due date, complete, reopen-past); restored the file → all pass. Confirms the tests detect a real regression.

### Result
First run of the three non-UI suites: 37/37 passed. After adding the editor test: 41 tests — but see Entry 6 (intermittent failures).

### Problems / Errors
- `npm error ERESOLVE … peer react@"^19.3.0" from react-test-renderer@19.3.0` — `@testing-library/react-native@13.3.3` has a peer on `react-test-renderer >=18.2.0`; npm picked the newest (19.3.0), which requires React 19.3, but SDK 54 pins React 19.1.0.

### Fixes Attempted
- Did **not** use `--legacy-peer-deps`/`--force` (would hide a real mismatch). Installed `react-test-renderer@19.1.0` explicitly so it matches React exactly, then pinned it without a caret so a fresh install cannot float to 19.3.

### Current Status
Completed

---

## Entry 6 — Bug: intermittent test failures in the repository suite

**Date:** 2026-10-10 21:00 (-03:00)

### Prompt / Request
(Found during "Run the appropriate project checks, including … Unit tests.")

### Decision Summary
After adding the 4th test file, `npx jest` reported 2 failures in `repositories.test.ts` (`enforces the title CHECK constraint at the SQL level too`, `rolls back the category delete transaction if a statement fails`) with *"expect(received).rejects.toThrow(expected) … Received function did not throw"*. Re-running immediately: all passed. Running the suite 8 times: failed in 2 of 8 runs, always the same two tests — the only two that assert on an error thrown by better-sqlite3 itself.

Hypothesis: better-sqlite3's native addon registers its `SqliteError` constructor once per **process**, while Jest creates a fresh JS realm (globals, `Error`) per **test file**. When another test file in the same worker loads the addon first, errors thrown later are instances of the *other* realm's `Error`; Jest's `toThrow` doesn't recognise them. Which file runs first in a worker depends on scheduling → flaky.

### Actions Performed
- `npx jest -i src/db` alone → 14/14 pass.
- Wrote a custom Jest test sequencer (scratch file, not committed) forcing `reminderLifecycle.test.ts` to run before `repositories.test.ts` in one process (`npx jest -i --testSequencer=…`) → the same 2 tests failed **deterministically**, confirming the hypothesis. (First attempt to run the sequencer failed with `Cannot find module '@jest/test-sequencer'` because the scratch file lived outside the project; fixed by requiring it via its absolute path in `node_modules`.)
- Fix in `src/test/sqliteTestDb.ts`: every adapter call goes through `call()`, which re-throws native errors as a realm-local `new Error(message)` (preserving `code`). This also mirrors production, where app code checks `e instanceof Error`.
- Considered instead changing the two assertions to `rejects.toMatchObject({ message })`; rejected because it would hide the realm issue for any future test.

### Result
- Forced-order run: 31/31 pass. Full suite run 10 times in a row: 41/41 every time.
- `npx tsc --noEmit` exit 0. `npx expo lint`: 1 warning (`no-require-imports` on the `require()` inside the hoisted `jest.mock` factory) → added a targeted `eslint-disable-next-line` with an explanatory comment; lint now clean.

### Problems / Errors
- Flaky tests caused by cross-realm native error classes (test infrastructure bug, not an app bug).

### Fixes Attempted
1. Re-run → passed (not a fix; noted as flake).
2. Deterministic reproduction with custom sequencer → confirmed cause.
3. Wrap native errors in the adapter → fixed.

### Current Status
Completed

---

## Entry 7 — Fix: test file placed inside the router directory

**Date:** 2026-10-10 21:05 (-03:00)

### Prompt / Request
(Self-review of `git status` before the first feature commit.)

### Decision Summary
`src/app/__tests__/TaskEditorScreen.test.tsx` was inside `src/app/`. Expo Router turns **every** file in `src/app` into a route, so this would have created a bogus `/__tests__/TaskEditorScreen.test` route and pulled Jest-only code into the bundle (and violated the project rule "keep non-route code outside `src/app/`").

### Actions Performed
- `git mv src/app/__tests__/TaskEditorScreen.test.tsx src/__tests__/TaskEditorScreen.test.tsx`
- `npx jest` → 41/41 pass.

### Result
Router directory contains only route files.

### Problems / Errors
- Misplaced test file (caught before commit, never shipped).

### Fixes Attempted
- Moved the file (final).

### Current Status
Completed

---

## Entry 8 — Runtime validation on an Android emulator (Expo Go)

**Date:** 2026-10-10 22:00–23:30 (-03:00) — emulator clock was GMT (23:0x)

### Prompt / Request
> "Run the application on an available Android emulator or physical device. Verify the acceptance criteria." / "For notification tests, inspect actual scheduled notifications and, when available, the operating system's notification UI. Distinguish between an alarm being scheduled and a notification actually being delivered."

### Decision Summary
- **Environment:** the only AVD on the machine is `TodoTestAVD` = **Android 8.0 (API 26), google_apis, x86**, running in the Windows emulator (`emulator.exe`) and controlled from WSL through Windows `adb.exe`. API 26 is above SDK 54's minSdk (24) but **below Android 13**, so the runtime `POST_NOTIFICATIONS` prompt cannot be exercised on it.
- **Runtime:** Expo Go 54.0.8 (SDK 54 client, from `api.expo.dev/v2/versions`) — local notifications are supported in Expo Go. No development build yet (no JDK/Android SDK in WSL; see Entry 10).
- **Evidence sources:** `uiautomator dump` (UI text/accessibility tree, driven by a scratch helper script `ui.sh` that taps by text/label), `dumpsys alarm` (pending AlarmManager alarms = *scheduled*), `dumpsys notification --noredact` (posted notifications = *delivered*), screenshots, and the on-device SQLite file read with `sqlite3` after `adb root`.

### Actions Performed / environment problems
1. `emulator.exe -avd TodoTestAVD` started, but `adb.exe devices` was empty. **Cause:** the WSL `adb` server I had started during Entry 1 was listening on port 5037, and WSL's localhost forwarding routed Windows `adb.exe` to it (the Linux server cannot see the Windows emulator). **Fix:** `adb kill-server` (WSL) then `adb.exe start-server` → `emulator-5554 device`, Android 8.0.0.
2. Downloaded `Expo-Go-54.0.8.apk` and `adb.exe install -r` → Success.
3. `CI=1 npx expo start --go --port 8081 --offline`, `adb.exe reverse tcp:8081 tcp:8081`, opened `exp://127.0.0.1:8081` → Expo Go **"Something went wrong"**; logcat: `Failed to download remote update … readResponseHeaders`. **Cause:** WSL2's localhost forwarding answered on Windows `[::1]:8081` but **not** `127.0.0.1:8081` (checked with PowerShell `Invoke-WebRequest`: IPv4 failed, IPv6 returned `packager-status:running`), and `adb reverse` uses IPv4. **Fix:** removed the reverse and opened `exp://172.26.205.13:8081` (the WSL VM's IP, reachable from the emulator through the Windows host) → bundle built (1291 modules) and the app launched.
4. On launch Expo Go logged `ERROR expo-notifications: Android Push notifications (remote notifications) functionality … was removed from Expo Go with the release of SDK 53` and showed a LogBox toast that covered the "+" button. This is emitted on import and concerns remote push only. **Change:** `LogBox.ignoreLogs(['expo-notifications: Android Push notifications'])` in `src/app/_layout.tsx` (with comment). The message still appears in the Metro terminal.
5. Restarted Metro without `CI=1` (watch mode) for hot reload.

### Result — acceptance tests actually performed (Android 8.0 emulator, Expo Go)

| # | Test | Evidence | Result |
|---|---|---|---|
| 1 | Create categories "Work", "Home" | category list | ✅ |
| 2 | Empty category name | "Category name is required." | ✅ rejected |
| 3 | Duplicate "work" (vs "Work") | "A category named "work" already exists." (screenshot) | ✅ rejected |
| 4 | Rename "Home" → "Personal" | list + filter chips updated | ✅ |
| 5 | Save task with empty title | "Title is required.", not saved | ✅ |
| 6 | Create "Submit mobile development assignment" (Work, description, due = next full hour 00:00) | list row shows title, Work chip, "Sun, Oct 11, 12:00 AM"; `dumpsys alarm`: 1× `RTC_WAKEUP … tag=*walarm*:expo.modules.notifications.NOTIFICATION_EVENT when=2026-10-11 00:00:00` | ✅ scheduled |
| 7 | Picking a past date (Oct 10 00:00) in the editor | warning "This time is in the past — … no reminder will be scheduled." | ✅ |
| 8 | Change due date → 23:15 (date + time dialogs) | still exactly **1** expo alarm, now `when=2026-10-10 23:15:00` | ✅ rescheduled, no duplicate |
| 9 | Create task with due date ("Buy groceries") | expo alarms 1 → 2 | ✅ |
| 10 | Create task without due date ("Read chapter 5") | alarms stay 2 | ✅ none scheduled |
| 11 | Complete "Buy groceries" from the list | 2 → 1 | ✅ cancelled |
| 12 | Reopen it | 1 → 2 | ✅ rescheduled |
| 13 | Delete it (confirmation dialog) | 2 → 1, row gone | ✅ cancelled |
| 14 | **Delivery** at 23:15 with app in background (Home pressed) | `dumpsys notification`: `pkg=host.exp.exponent tag=task-1 … channel=…/task-reminders`, `android.text=Task reminder: Submit mobile development assignment`; visible in the notification shade (screenshot) | ✅ **delivered** |
| 15 | Tap the notification | app opened on "Edit task" for that task | ✅ |
| 16 | Unsaved changes + Android back | "Discard changes? / You have unsaved changes to this task." → Discard → title unchanged | ✅ |
| 17 | Set future due date, then switch due date off | pending alarms 1 → 0 | ✅ cancelled |
| 18 | Filters: Pending / Completed / Work / Uncategorized / Pending+Work / All+Any | each showed exactly the expected tasks | ✅ |
| 19 | Delete category "Work" (used by 1 task) | dialog "1 task will be kept and become uncategorized."; task still listed, appears under "Uncategorized" | ✅ |
| 20 | **Persistence:** `am force-stop host.exp.exponent` (process gone) and relaunch | tasks, completion state and categories intact | ✅ |
| 21 | On-device SQL check (`sqlite3 …/files/SQLite/taskflow.db`) | `user_version=1`; deleted task 2 and category 1 absent; task 1 `category_id` NULL | ✅ |
| 22 | **Reboot:** schedule 23:25, `adb reboot` (uptime afterwards 43 s → real reboot), **app not opened** | after boot: expo alarm `when=2026-10-10 23:25:00` present; logcat `Start proc …host.exp.exponent for broadcast host.exp.exponent/.notifications.receivers.SchedulingTriggerReceiver`; at 23:25 notification `tag=task-1` posted while the launcher was the resumed activity | ✅ restored and delivered *in Expo Go* |
| 23 | **Permission denied:** turned Expo Go notifications Off in system settings, relaunched | reconcile `permission: "denied"`; banner "Notifications are off, so due-date reminders won't be delivered. Tasks are still saved." | ✅ no crash |
| 24 | Create "Pay rent" with due date while denied | alert "Task saved, but notifications are not allowed, so no reminder was scheduled."; task listed; 0 alarms | ✅ |
| 25 | Re-enable notifications, relaunch | reconcile `scheduled: [4]`, 1 alarm | ✅ startup reconciliation scheduled the missed reminder |
| 26 | Relaunch again (after force-stop) | reconcile said `kept: [4]` but **0 alarms** | ❌ **bug → Entry 9** |

Important caveats:
- Test 22 proves restoration **in Expo Go**, whose boot receiver is Expo Go's own `SchedulingTriggerReceiver`. In a development/standalone build the receiver is the library's `NotificationsService` (Entry 2). Same library family, different host app → still needs confirming on a development build.
- The alarm-count command initially matched any line containing the tag, including `dumpsys alarm`'s *history statistics*. After the first alarm fired, one stale stats line was counted (seen after test 14). Counts before 23:15 were unaffected because no expo alarm had fired yet. From test 17 on I counted only pending entries (`tag=*walarm*:…`).
- Android 13+ runtime permission prompt, exact-alarm behaviour on Android 12+/14+, and iOS were **not** tested.

### Problems / Errors
- adb server conflict (fixed), IPv4 localhost forwarding (worked around), Expo Go push-removal log (suppressed), bug in test 26 (Entry 9).

### Fixes Attempted
- As listed above.

### Current Status
Partially completed (Android 8 / Expo Go verified; dev build, Android 13+, iOS pending)

---

## Entry 9 — Bug: reminders lost after force-stop were treated as still scheduled

**Date:** 2026-10-10 23:30 (-03:00)

### Prompt / Request
(Found during acceptance test 26: "Verify that reconciliation does not produce duplicate reminders.")

### Decision Summary
Observed: after `am force-stop` and relaunch, startup reconciliation logged `{"kept": [4], "scheduled": []}` but `dumpsys alarm` showed **no** pending expo alarm (re-checked 10 s later: still 0).

Investigation on the device (`adb root`):
- SQLite: `4|Pay rent|2026-10-11T00:00:00.000Z|task-4` → the app believed a reminder existed.
- `shared_prefs/expo.modules.notifications.SharedPreferencesNotificationsStore.xml` contained `notification_request-task-4` → expo-notifications' persistent request store still listed it.
- AlarmManager: nothing.

**Root cause:** Android deletes all AlarmManager alarms of a force-stopped app, but expo-notifications' request store is a SharedPreferences file and survives. `getAllScheduledNotificationsAsync()` on Android reads that store, so it reports requests whose alarm no longer exists. My reconciliation (Entry 4) trusted that list ("matches → keep") and therefore never re-armed the reminder. Users can cause the same situation from Settings → Force stop, and some OEM task killers do it too. The unit tests did not catch it because the fake treated "listed" and "will fire" as the same thing.

**Fix (chosen):** reconciliation no longer trusts the listing for eligible tasks. It cancels app reminders that belong to non-eligible/missing tasks and **re-arms every eligible task** (`scheduleReminder` = cancel + schedule with the same deterministic `task-<id>` identifier). Because of the deterministic identifier this stays idempotent (still exactly one request per task). Cost: one cancel + schedule native call per eligible task per app start — negligible for a To-Do list.
Alternatives considered: comparing with `dumpsys`-like alarm state (not available to JS); a native module to query AlarmManager (needs custom native code — disproportionate).

### Actions Performed
- `src/notifications/reminders.ts`: rewrote `reconcileReminders()`; removed `kept` from `ReconcileReport`; updated comments (payload `dueDateTime` is now used for display only).
- `src/state/TaskStore.tsx`: `reconcile()` derives active reminders from `report.scheduled`.
- `src/test/fakeNotifications.ts`: fake now separates `scheduled` (library store) from `alarms` (OS) and has `forceStop()`.
- Tests: updated "repeated reconciliation" and "startup reconciliation" expectations; **new** test "re-arms reminders whose OS alarm was lost although the store still lists them (force-stop)".
- Verified the new test **fails against the previous `reminders.ts`** (`git show HEAD:… > reminders.ts`, `npx jest -t force-stop` → 1 failed) and passes with the fix.
- `npx jest` 42/42, `npx tsc --noEmit` exit 0, `npx expo lint` clean.
- **On device**, 3 cycles of force-stop → relaunch: after each force-stop `pending=0`; after each relaunch reconcile `scheduled: [4]` and `pending=1` (`when=2026-10-11 00:00:00`). No duplicates.

### Result
Fixed and verified on the emulator and in unit tests.

### Problems / Errors
- Wrong assumption: "listed by `getAllScheduledNotificationsAsync()` ⇒ will fire".

### Fixes Attempted
1. Original design (trust listing) — failed on device.
2. Always re-arm eligible tasks at startup — works.

### Current Status
Completed
