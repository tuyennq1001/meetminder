# Decision log: Meet Minder

Append-only. Every entry records the decision, alternatives considered, why,
dissent (if any), and a revisit trigger.

## 2026-09-03 — Proposal for purple-and-white visual theme

- **Decision:** Recommend replacing the current blue primary accent with the
  logo purple `#431A46` and white foreground treatment, while keeping neutral
  dark surfaces and semantic status colors unchanged [S1][S2].
- **Alternatives considered:** Keep the current blue Material 3 palette; use
  purple as a full-surface background instead of a restrained accent system.
- **Why:** The logo already establishes a purple-and-white identity [S1], while
  the current UI tokens still center on blue [S2]. A restrained accent system
  preserves hierarchy and transcript readability [S3].
- **Dissent:** The consistency and readability hypothesis has not yet been
  validated with user research [A1][A2].
- **Revisit when:** Visual QA finds contrast or hierarchy failures, or user
  feedback indicates the purple treatment reduces readability or discoverability.

## 2026-09-03 — Implementation authorized without rebuild

- **Decision:** Implement the approved purple-and-white theme on branch
  `codex/theme-purple-white`; defer build, app replacement and restart while
  the user is actively using the current app.
- **Alternatives considered:** Build and restart immediately after the color
  changes, as required by the normal repository workflow.
- **Why:** The user explicitly requested that the running app not be rebuilt or
  restarted in this session.
- **Dissent:** Full runtime verification remains pending until the user is
  ready to stop using the current app.
- **Revisit when:** The user confirms the app can be rebuilt and restarted for
  runtime visual QA.

## 2026-09-03 — Release app rebuilt and restarted

- **Decision:** Build the release app, replace `/Applications/Meet Minder.app`,
  retain the prior app in a temporary backup, and restart the app.
- **Alternatives considered:** Leave the rebuilt app only in the repository and
  defer installation.
- **Why:** The user explicitly approved rebuilding after using the previous
  running version.
- **Dissent:** No functional build errors; the build emitted two existing Rust
  warnings in `src/commands/transcript.rs`.
- **Revisit when:** Visual feedback from the rebuilt app requires another color
  adjustment.

## 2026-09-08 — Git backup is user-configured, app-automated

- **Decision:** Let the user install and configure Git, repository, remote, and
  credentials outside Meet Minder. Inside the app, provide an opt-in Git
  backup feature with configurable commit and push schedules, a manual
  “Backup now” action, and clear status for pending changes, offline state,
  authentication errors, and conflicts.
- **Alternatives considered:** Make Meet Minder create and authenticate a
  hosted repository automatically; expose raw Git concepts such as branches,
  staging, and rebasing as the primary UI.
- **Why:** The user retains ownership of the repository and credentials while
  the app removes repetitive Git work. Git remains an implementation detail in
  the normal flow, but advanced users can keep using their existing Git tools.
  Backup commits must stage only Meet Minder-managed records, images, and
  catalog data; audio and settings remain excluded. A backup operation is
  additive and must never delete or overwrite existing repository data without
  an explicit restore action.
- **Dissent:** A local commit alone does not protect against loss of the
  machine; remote push or another external backup remains necessary. Automatic
  push may fail when the remote has diverged, so the app must pause and ask for
  user intervention rather than silently resolving conflicts.
- **Revisit when:** Users report that setup is too technical, auto-push causes
  unexpected remote changes, or multi-device conflict frequency requires a
  dedicated merge workflow.
