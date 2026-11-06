# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

"Nöbet Planlayıcı": a client-only React app that generates monthly hospital on-call (nöbet) rosters for nurses. There is no backend. All data lives in the browser's `localStorage`. Stack: Vite + React + TypeScript + shadcn/ui + Tailwind, with the `@/` alias pointing at `src/`.

All user-facing text is in Turkish, and some code comments are too. New UI strings should also be in Turkish.

## Commands

```sh
npm i                 # install (npm, package-lock.json)
npm run dev           # Vite dev server on port 8080, all interfaces (host "::") so a phone on the LAN or Tailscale can open it
npm run build         # production build to dist/
npm run lint          # ESLint (flat config, eslint.config.js); must report 0 errors
npm run typecheck     # tsc for the app and the Vite/Vitest configs
npm test              # vitest, single run
npx vitest run -t "strict"              # run tests whose name matches
```

CI (`.github/workflows/ci.yml`) runs typecheck, lint, test (with `TZ=Europe/Istanbul`) and build on every push to `main` and on PRs.

Tests live next to the code under `src/` (`vitest.config.ts` only picks up `src/**/*.test.{ts,tsx}`). `src/lib/*.test.ts` cover scheduling, persistence and exports. `src/pages/Index.test.tsx` renders the real components under jsdom (`// @vitest-environment jsdom`), with shims for what Radix needs. Pass `{ seed }` to `generateSchedule` for reproducible output. Without a seed every call gives a different schedule. Date code must be tested in a UTC+ zone: set `process.env.TZ` in the test (Node applies it immediately), as `persistence.test.ts` does.

The only lint warnings are `react-refresh/only-export-components` in generated `src/components/ui/` files. `eslint.config.js` turns off `no-empty-object-type` for that folder, because its files are generated and not hand-edited.

TypeScript runs in loose mode (`strict: false`, `strictNullChecks: false`, `noImplicitAny: false`), and ESLint has `no-unused-vars` turned off. Don't expect the compiler to catch null-handling bugs.

## Architecture

There is a single page. `src/pages/Index.tsx` owns all app state (`staff`, `config`, `rosters`, `carryIn`) and passes it down to three tabs. The roster shown is `rosters[monthKey(config)]`, the saved roster of the selected month. Its stats are recomputed with `evaluateSchedule` on every render (`useMemo`), so they always reflect the current staff and settings. Pressing Oluştur on a month that already has a roster asks before overwriting it.

- **Personel**: `StaffManager.tsx` adds and removes staff and edits each person's monthly hours, vacation days, unavailable date ranges, and together/not-together preferences (each with a "strict" flag).
- **Ayarlar**: `ScheduleConfig.tsx` sets month and year, `totalMonthlyHours` (the default per-person target, despite the name), and `minStaffPerShift`. It also shows who worked the previous month's last day. That list comes from the previous month's saved roster, or is picked by hand (`carryIn`) when there is none.
- **Çizelge**: `ScheduleView.tsx` renders the generated calendar and stats. Clicking a day opens `ShiftEditDialog.tsx` for manual edits.

CSV and printable-HTML "PDF" export is in `src/lib/exportUtils.ts`. Domain types are in `src/types/schedule.ts`. `src/components/ui/` is generated shadcn/ui code; add new components there with the shadcn CLI (`components.json`) and don't hand-edit them.

### Scheduling (`src/lib/`)

The logic is split into three modules. Keep it that way, so generation, stats and the edit dialog can't disagree about the rules:

- `scheduleRules.ts`: shared definitions. These cover day and month keys (`dayKey`, `monthKey`, `previousMonth`), availability (`isStaffUnavailable`; `availableDays` adds the carry-in rest day from `MonthContext.workedPreviousDay`), target hours (`monthlyHours ?? config.totalMonthlyHours`; `totalMonthlyHours` is the per-person default despite its name), hours ↔ shift-count math, the not-together relation, and `planStaff`.
- `scheduleGenerator.ts`: `generateSchedule(staff, config, { seed?, workedPreviousDay? })`. The header comment explains the algorithm in full. In short:
  - Hours become a window of allowed shift counts. Any n with ceil(H/24) ≤ n ≤ floor(H/16) hits H exactly, using (H−16n)/8 shifts of 24h and the rest 16h.
  - Simulated annealing then places people on days.
  - Finally the 24h shifts are spread across the month.
  - **The algorithm never breaks these rules, because any move that would is rejected:** the rest rule (no two days in a row, and nobody from the previous month's last day on day 1), vacations and unavailable ranges, strict `preferNotTogether`, and each person's maximum shift count.
  - **Everything else is a weighted penalty (`WEIGHT`).** In priority order: hour targets, then days below `minStaffPerShift`, then together/not-together preferences.
  - **Step 4 balances the real workload ("gerçek yük").** A second annealing pass trades days between two people with the same shift length. A trade changes no day's head count or 24h count and nobody's hours. It stops when everyone's workload is in proportion to their hours. It ranks above soft preferences, and people in strict together pairs are never traded.
- `scheduleStats.ts`: `evaluateSchedule(staff, shifts, config, { workedPreviousDay? })` returns stats, `targetDeviation` (mean % off target) and the Turkish warnings shown under "Öneriler". It ignores shifts outside `config`'s month. Assignments of deleted staff are flagged and don't count as coverage. The generator uses it, and so does `Index` for the shown roster.

Real workload (`workShare` in `scheduleRules.ts`): every hour of a day is split among the people on duty at that hour. A 24h shift runs 08:30–08:30 and a 16h shift 08:30–00:00, so 00:00–08:30 is shared by the 24h staff only. With four people on 24h each carries 6 hours of the day, with five 4.8. `StaffStats.workload` is that sum per person. `fairWorkload` is the month's work split in proportion to hours. `evaluateSchedule` warns when the most and least loaded person are more than `WORKLOAD_TOLERANCE` (3 hours) apart. These shift times come from the user's ward; change `NIGHT_HOURS` if they differ.

Hour targets that aren't a multiple of 8 (or are exactly 8) can't be met with 24h/16h shifts. They are rounded down and a warning is shown. A target can also be more than the month allows under the rest rule; it is then capped at that limit, again with a warning.

Manual edits (`ShiftEditDialog`) are allowed to break the rules. The dialog shows a warning for each broken rule, and `evaluateSchedule` lists the violations afterwards. Empty days can be clicked and filled, and saving a day with nobody selected removes its shift. The dialog resets its draft from the saved shift every time it opens. It also lists assignments of deleted staff so they can be removed.

### IDs and plain HTTP

New records get their ID from `newId()` (`src/lib/id.ts`), not `crypto.randomUUID()` directly. Browsers only provide `randomUUID` and other secure-context APIs on HTTPS or localhost. The dev server is also opened over plain HTTP on a LAN or Tailscale address, e.g. from a phone, and there those APIs are undefined.

### Dates and persistence

All of it is in `src/lib/persistence.ts`. The `localStorage` key is `hospital-shift-scheduler-data`, holding `AppData`: `staff`, `config`, `rosters` (saved rosters by `yyyy-MM` month key, shifts only) and `carryIn`. `Index` loads it in its `useState` initialisers, before the first render, so the first save writes back exactly what was loaded.

`parseAppData` checks every record on its own. A bad record or field is dropped and described in Turkish in `problems`, without taking the rest of the data with it. When anything couldn't be read, `loadAppData` first copies the original text to a `hospital-shift-scheduler-backup-<timestamp>` key, and `Index` shows a toast. A failed save also shows a toast.

Dates are saved as `yyyy-MM-dd` strings and parsed back as local-time `Date`s (`parseStoredDate`). Saves from before 2026-01-01 contain full UTC ISO strings (`JSON.stringify(Date)`). These are converted to an instant and then to the local day. Taking the first 10 characters would move every date one day earlier in UTC+ zones such as Turkey. Keep date-only handling local. Never round-trip through `toISOString()`, and compare days with `dayKey`, `isSameDay` or `format(d, 'yyyy-MM-dd')`, not timestamps.

Exports (`exportUtils.ts`): the print view escapes every user string with `escapeHtml`. The CSV uses `;` (Turkish-locale Excel's list separator), quotes fields through `csvCell`, which also neutralises formula prefixes, and starts with a BOM.

### Routing

`App.tsx` sets up React Router. Add new routes above the catch-all `*` route; a comment marks that spot.
