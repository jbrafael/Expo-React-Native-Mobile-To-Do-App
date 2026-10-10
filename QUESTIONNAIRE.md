# TaskFlow — Reverse-Engineering Questionnaire

> Answers are written against the final code in this repository. File references are relative to the project root.

## 1. Project Structure
**What are the main parts of the project, and where can you find the UI/screens, data models, SQLite/database code, navigation, and notification code? Briefly describe the project organization.**

All app code lives in `src/`, split by responsibility:

| Concern | Location |
|---|---|
| Screens (routes) | `src/app/` — Expo Router turns each file into a screen: `index.tsx` (task list), `task/[id].tsx` (editor, `/task/new` creates), `categories.tsx` (category management) |
| Navigation | `src/app/_layout.tsx` — root native `Stack`, plus the `SQLiteProvider` and `TaskStoreProvider` that wrap every screen |
| Data models | `src/models/types.ts` — `Task`, `Category`, `TaskInput`, filter types |
| SQLite | `src/db/database.ts` (schema, migrations, `Db` type), `src/db/taskRepository.ts`, `src/db/categoryRepository.ts` (all SQL) |
| Shared state | `src/state/TaskStore.tsx` — React Context + `useTaskStore()` hook |
| Notifications | `src/notifications/reminders.ts` — the only module that imports `expo-notifications` |
| Reusable UI | `src/components/` (`Chip`, `TaskRow`, `DueDateField`, `PermissionBanner`), `src/theme/colors.ts` |
| Pure helpers | `src/utils/` (`filterTasks`, date formatting) |
| Tests | `__tests__/` folders next to the code they test, plus test-only helpers in `src/test/` |

Only route files go in `src/app/`, because Expo Router would turn anything else in that folder into a route. BUILD_LOG Entry 7 covers a test file that ended up there by mistake.

## 2. Architecture and State
**How is application state managed? Explain how the UI updates after creating, editing, and completing a task. Does the project use a recognizable architectural pattern or state-management approach?**

The app uses a single React Context, `TaskStoreProvider` in `src/state/TaskStore.tsx`. It sits in the root layout, so all three screens share the same state: `tasks`, `categories`, `loading`, `error` and the notification `permission`. Screens never run SQL. They read state and call mutation functions through `useTaskStore()`.

The layers are: screens (view) → `TaskStore` (a ViewModel-style layer that holds state and mutations) → repositories (data access) and the reminder service. It's close to MVVM with a repository pattern, built from plain React (`useState`, `useCallback`, `useMemo`). There is no Redux or Zustand. BUILD_LOG Entry 2 explains why: three screens sharing the same lists didn't need another dependency.

SQLite queries are not reactive, so the UI refreshes explicitly. Every task mutation (`createTask`, `updateTask`, `setCompleted`) does three things in order:
1. Writes through the repository (`taskRepo.insertTask` / `updateTask` / `setTaskCompleted`).
2. Syncs the task's reminder (`syncTaskReminder`) and stores the result in `notification_id`.
3. Calls `refresh()`, which re-reads all tasks and categories with `Promise.all` and puts them in React state.

The new state flows to every screen that uses the context. The list re-derives what it shows with `useMemo(() => filterTasks(tasks, status, category))`, so the change appears as soon as the mutation's promise resolves. BUILD_LOG Entry 2 says expo-sqlite's change listener was considered and rejected because it's less explicit and harder to test.

## 3. SQLite Persistence
**How is SQLite used? Identify where the database is created, how tasks and categories are stored, and where create, read, update, and delete operations are implemented.**

- **Creation:** `src/app/_layout.tsx` renders `<SQLiteProvider databaseName="taskflow.db" onInit={migrateDbIfNeeded}>`. `onInit` finishes before any child renders, so every screen sees the final schema. If opening the database fails, `onError` shows a "Database error" screen instead of crashing.
- **Schema / migrations:** `src/db/database.ts` keeps an ordered `MIGRATIONS` array indexed by `PRAGMA user_version`. Each step runs in a transaction together with the version bump. On every open it also sets `journal_mode = WAL` and `foreign_keys = ON`, because foreign keys are a per-connection setting in SQLite.
- **Tables:**
  - `categories(id, name UNIQUE COLLATE NOCASE, CHECK non-blank)`
  - `tasks(id, title CHECK non-blank, description, completed 0/1, due_date_time, created_at, category_id → categories ON DELETE SET NULL, notification_id)`

  Dates are ISO-8601 UTC strings, which sort correctly as text in `ORDER BY`.
- **CRUD** (all parameterised with `?`):
  - Tasks, in `src/db/taskRepository.ts`: `getAllTasks` (pending first, then by due date), `getTaskById`, `insertTask`, `updateTask`, `setTaskCompleted`, `setTaskNotificationId`, `deleteTask`.
  - Categories, in `src/db/categoryRepository.ts`: `getAllCategories`, `insertCategory`, `renameCategory` (both check for duplicates ignoring case), `countTasksInCategory`, `deleteCategory`.
  - `deleteCategory` runs `UPDATE tasks SET category_id = NULL` and `DELETE FROM categories` in one `withTransactionAsync`, so the category's tasks are kept.
- Repositories take a `Db` parameter (a `Pick<SQLiteDatabase, …>`) instead of using a global connection. That lets `src/db/__tests__/repositories.test.ts` run the same SQL against real SQLite (`better-sqlite3`) in Node.

## 4. Follow One Operation
**Trace the creation of a task from pressing Save until the task is stored in SQLite, appears in the task list, and has a notification scheduled if it has a future due date. Describe the actual functions and components involved.**

1. **Editor screen** (`src/app/task/[id].tsx`, `TaskEditorScreen`). The user taps Save, either the header button or the bottom `save-button`, which calls `save()`. If the trimmed title is empty, `save()` shows "Title is required." and stops. Otherwise it builds a `TaskInput`; `form.due` (a `Date` from `DueDateField`) becomes `toISOString()`. Because the route id is `new`, `taskId === null`, so it calls `createTask(input)` from `useTaskStore()`.
2. **Store** (`src/state/TaskStore.tsx`, `createTask`):
   - `taskRepo.insertTask(db, input)` runs `validateTitle`, then `INSERT INTO tasks (…) VALUES (?, ?, ?, ?, ?, ?)`, then re-reads the row with `getTaskById(lastInsertRowId)` and returns a `Task`.
   - `syncTaskReminder(db, task)`. `isReminderEligible(task)` is true when the task isn't completed and its due date is later than now. If so, it calls `scheduleReminder(task)`.
3. **Reminder service** (`src/notifications/reminders.ts`, `scheduleReminder`):
   - `cancelReminder(task.id)` removes any existing `task-<id>` request.
   - `ensurePermission()` runs `configureNotifications()` (handler + Android channel `task-reminders`). It then reads permission and only prompts if the status is still undetermined.
   - `Notifications.scheduleNotificationAsync({ identifier: 'task-<id>', content: { title: 'TaskFlow', body: 'Task reminder: <title>', data: { taskId, dueDateTime } }, trigger: { type: DATE, date, channelId } })`.
   - It returns `{ status: 'scheduled', notificationId }`, or `permission-denied` / `error`. It never throws, so the saved task is never rolled back.
4. **Back in `syncTaskReminder`:** `setTaskNotificationId` writes `task-<id>` into `tasks.notification_id`. `afterReminderChange` updates `permission`, and `refresh()` re-queries tasks and categories into state.
5. **Back in the editor:** if the reminder status isn't `scheduled`, `describeReminderOutcome` shows an alert (for example, "Task saved, but notifications are not allowed…"). Then `setLeaving(true)` turns off the `usePreventRemove` guard, and an effect calls `router.back()`.
6. **List** (`src/app/index.tsx`): its `tasks` from context have already changed. `filterTasks` recomputes, and the `FlatList` renders the new `TaskRow` with a bell icon because `notificationId` is set.

## 5. Navigation
**How does navigation between screens work? How does the app navigate from the task list to the editor? What information is passed when editing an existing task?**

Navigation uses Expo Router with file-based routes. `src/app/_layout.tsx` sets up a native `Stack` with three screens: `index`, `task/[id]` and `categories`.

- **List → editor:** `openEditor(id)` in `src/app/index.tsx` calls `router.push({ pathname: '/task/[id]', params: { id: String(id) } })`. The floating "+" button passes `'new'`; tapping a row passes the task's numeric id.
- **List → categories:** `router.push('/categories')` from the header tag icon.
- **Notification → editor:** `useOpenTaskFromNotification()` in `_layout.tsx` reads `Notifications.useLastNotificationResponse()`, which covers both warm and cold starts. It gets the task id from the `task-<id>` identifier and pushes the same editor route.

**Only the id is passed.** The editor reads it with `useLocalSearchParams<{ id: string }>()` and loads the task from SQLite (`loadTask` → `getTaskById`), so it always edits the stored data and never a stale copy. A non-numeric or missing id shows "This task no longer exists." Leaving with unsaved changes is caught by `usePreventRemove` from `@react-navigation/native`, which handles header back, Android back and iOS swipe, and asks "Discard changes?".

## 6. Notifications
**How are reminders implemented? Explain scheduling, task association, due-date changes, task completion/deletion, and restoration behavior. Distinguish implemented behavior from platform limitations and untested behavior.**

**Implemented** (all in `src/notifications/reminders.ts`, called from `TaskStore`):
- **Association:** each task has at most one local notification, with the fixed identifier `task-<id>`. The id is also stored in `tasks.notification_id` and in the payload (`data.taskId`).
- **Scheduling:** a date trigger at `due_date_time` on the Android channel `task-reminders`, with body `Task reminder: <title>`. Only tasks that are pending and due in the future are eligible (`isReminderEligible`). `scheduleReminder` always cancels the identifier first, so rescheduling never creates duplicates.
- **Due-date change / completion / reopen / removing the date:** every update goes through `syncTaskReminder`, which reschedules an eligible task or cancels an ineligible one. Reopening a completed task with a future date schedules it again.
- **Deletion:** `deleteTask` deletes the row and then calls `cancelReminder(id)`.
- **Permission:** requested only the first time a reminder is actually needed, never at launch. On Android the channel is created first, because Android 13+ only shows the prompt once a channel exists. If permission is denied, the task is still saved, the user gets an alert, and the list shows `PermissionBanner` with "Open settings".
- **Restoration:**
  1. On Android, expo-notifications registers its own `BOOT_COMPLETED` receiver, which re-arms stored requests after a reboot. The app adds no native code for this (BUILD_LOG Entry 2).
  2. At every app start, `reconcileReminders` cancels `task-*` requests for tasks that are missing, completed or past due, and re-arms every eligible task. It does this without prompting for permission. It re-arms everything on purpose instead of trusting `getAllScheduledNotificationsAsync()`, because that call can list reminders whose alarm the OS has already deleted (BUILD_LOG Entry 9).

**Platform limitations:**
- Android removes all alarms of a force-stopped app. Reminders come back only when the user opens the app again.
- On Android 14+, `SCHEDULE_EXACT_ALARM` is denied by default for new installs, so the library uses inexact alarms and a reminder can arrive a few minutes late.
- iOS allows at most 64 pending local notifications per app.
- OEM battery savers can delay or drop alarms.
- Remote push is not available in Expo Go (SDK 53+). TaskFlow doesn't use it.

**Verification status:** scheduling, rescheduling, cancelling, delivery, tap-to-open, reboot restoration and force-stop recovery were checked on Android emulators, and the unit tests cover the full lifecycle with a fake scheduler. BUILD_LOG Entries 8–9 say exactly which emulator, runtime (Expo Go or a native build) and Android version was used for each check. **iOS was never tested.**

## 7. Agent Decisions
**Identify at least two important decisions made by the coding agent that were not explicitly specified in the assignment. Explain the choices using evidence from the code and development history.**

1. **Deterministic reminder identifiers (`task-<id>`) instead of storing the random id that the library generates.** In `reminders.ts`, `reminderIdentifier()` is passed as `identifier` to `scheduleNotificationAsync`, and `scheduleReminder` always cancels that id first. Rescheduling and repeated reconciliation are therefore idempotent: a task can never have two reminders. BUILD_LOG Entry 2 ("Reminder identity") explains this. It's also what made the Entry 9 fix (re-arm everything at startup) safe.
2. **Deleting a category keeps its tasks and makes them uncategorized.** The assignment didn't specify this. `categoryRepository.deleteCategory` nulls `category_id` and deletes the category in one transaction, and the schema has `ON DELETE SET NULL` as a backup. The categories screen tells the user how many tasks will be kept. BUILD_LOG Entry 3 lists this policy, and a test checks that a failed delete is rolled back.
3. **Category names are unique regardless of case** ("Work" and "work" count as duplicates). This is enforced by the repository (a friendly `DuplicateCategoryError`) and by `UNIQUE COLLATE NOCASE` (BUILD_LOG Entry 3).
4. **Notification permission is requested lazily**, the first time a reminder is needed, and startup reconciliation never prompts. See `ensurePermission()` and the comment on `reconcileReminders`.
5. **Explicit refresh with one Context instead of a state library or reactive queries** (see Q2 and BUILD_LOG Entry 2).
6. **Real SQLite in unit tests** (`better-sqlite3` behind `src/test/sqliteTestDb.ts`) instead of mocking the database, so the actual SQL, constraints and transactions are tested (BUILD_LOG Entry 5).

## 8. BUILD_LOG Analysis
**Using `BUILD_LOG.md`, identify a problem or bug, the attempted solution, whether the first solution worked, and the final fix. Explain what the log reveals that would have been harder to discover from the final code alone.**

**Problem (Entries 8 and 9):** during on-device acceptance test 26, the app was force-stopped and relaunched. Startup reconciliation logged `kept: [4]`, meaning it believed the "Pay rent" reminder still existed. But `dumpsys alarm` showed **0** pending alarms, so the reminder would never fire.

**Investigation:** with `adb root`, the log compared three sources:
- SQLite still had `notification_id = task-4`.
- expo-notifications' SharedPreferences request store still listed `notification_request-task-4`.
- AlarmManager had nothing.

Root cause: Android deletes all alarms of a force-stopped app, but the library's request store survives, and `getAllScheduledNotificationsAsync()` reads that store.

**First solution — did it work?** No. The original design (Entry 4) trusted the listing: "if a matching request is listed with the right due date, keep it." It passed every unit test, because the fake scheduler treated "listed" and "will fire" as the same thing. It failed on the device.

**Final fix:** `reconcileReminders` now cancels reminders for tasks that are no longer eligible and **re-arms every eligible task** (cancel + schedule with the same `task-<id>`). This stays idempotent because the identifier is fixed. The fake was split into `scheduled` (the library store) and `alarms` (the OS) and given a `forceStop()`. A new regression test was added, and the log notes it was confirmed to fail against the old code. The fix was checked on the device over three force-stop/relaunch cycles, each ending with exactly one alarm.

**What the log shows that the final code doesn't:** the final code only has a short comment saying it re-arms "deliberately". From the code alone, a reader would likely see re-arming every reminder on every launch as wasteful and "optimise" it back to the broken version. The log keeps the evidence: the device shell output, the gap between the library's store and AlarmManager, the failed first design, and why the unit tests missed it.

The log also records problems that left no trace in the code at all:
- The cross-realm `instanceof Error` flakiness in Jest (Entry 6), whose fix is a single wrapper function.
- The WSL2 IPv4/IPv6 port-forwarding issue (Entry 8).
- The iOS date-trigger serialisation difference found by reading the library source (Entry 4).
