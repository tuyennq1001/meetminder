---
name: meet-minder-ux
description: Apply reusable UX patterns learned from Meet Minder when designing, implementing, reviewing, or testing data-heavy UI, especially tables, filters, dialogs, keyboard interaction, navigation context, and async feedback.
---

# Reusable UX patterns from Meet Minder

Use this skill for UI work involving a data list/table, filterable management
screen, modal/dialog, keyboard interaction, navigation between list and detail,
or a long-running task. Apply the patterns proportionally; do not force a
complex table or dialog onto a small static screen.

## Core rules

### Data tables

- A user-managed or growing table should have a visible filter and sortable
  headers. Small static tables may opt out only with a stated reason.
- Sort headers must work by mouse and keyboard. Show a neutral state plus clear
  ascending/descending indicators and expose the state with `aria-sort`.
- Filter before pagination, reset to page 1 when filters change, show the result
  count, and provide a one-step Clear filters action.
- Distinguish no data from no results after filtering. Provide loading, error,
  empty, and disabled states.
- Keep filter values, sort, page size, focus, and cursor position across
  re-renders where possible. Do not replace the whole table on every keystroke
  if doing so loses input focus.
- If filters depend on each other, update dependent options and remove or hide
  stale filters when the user changes scope.
- For multi-select, define the selection scope explicitly; select-all should
  match the current filtered set and expose an indeterminate state when needed.
- Use correct comparators for dates, numbers, and text. Use a stable default
  order, such as newest-first for logs.
- Put wide tables in an intentional horizontal-scroll container. Give icon-only
  actions accessible names and keep focus rings visible.

### Dialogs and popups

- Every dismissible dialog needs `Escape`, an explicit Close/X control, and a
  Cancel action when the operation can be abandoned.
- Escape must close only the topmost dialog and must run the same cleanup path as
  Cancel. Backdrop click may equal Cancel only when it cannot silently lose or
  commit data.
- On open, move focus into the dialog; trap Tab within it; restore focus to the
  opener after close. Use `role="dialog"`, `aria-modal="true"`, and an
  accessible label.
- Use explicit action labels such as Save, Delete, Cancel, or Run in background;
  do not make `OK` or an unlabeled `×` the only explanation of a consequential
  action.
- Separate primary, secondary, and destructive actions visually and by wording.
  Confirm destructive actions and state their scope.
- Long-running dialogs need visible progress, current step, cancellation,
  failure/retry feedback, and a background option when useful.

### Context and feedback

- Make the current activity, scope, filters, and result count visible.
- Preserve list context when returning from detail. Counts, badges, and metadata
  should deep-link to the related filtered list when that shortens the task.
- Do not auto-scroll away from content the user is reading; provide a deliberate
  jump-to-bottom action for streaming content.
- Do not disable a configuration choice merely because a prerequisite is missing
  when the user needs that choice to enter the prerequisite. Let them select it,
  explain the missing prerequisite, and block only at the action that truly
  requires it.
- Errors should explain the cause and next step. A toast alone is insufficient
  for important or recoverable errors.
- Keep terminology, labels, icon meanings, empty-value copy, and field order
  consistent across toolbar, form, table, modal, and detail views.

## Review checklist

For a table, verify: filter; sortable header; keyboard access; visible sort
state; `aria-sort`; filter-before-pagination; page reset; Clear; counts;
loading/error/empty states; preserved focus; correct date/number comparison;
selection scope; responsive overflow.

For a dialog, verify: Escape; topmost-only dismissal; Close and Cancel; safe
backdrop behavior; focus entry/trap/restore; dialog ARIA; explicit button copy;
destructive confirmation; unsaved-data protection; async progress and retry.

For any UI change, verify: current context is visible; back navigation preserves
state; feedback is actionable; auto-scroll does not fight reading; labels and
icons are consistent; hover/active/selected/focus/disabled states are
distinguishable without relying only on color.

## Meet Minder source

When working in the Meet Minder repository, read
`docs/ux-playbook.md` for the fuller rationale, project examples, and portable
PRD checklist. Update that playbook when a new UX lesson is confirmed by a bug
fix or a repeated interaction pattern.
