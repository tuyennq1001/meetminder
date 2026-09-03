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
