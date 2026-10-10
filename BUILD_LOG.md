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
