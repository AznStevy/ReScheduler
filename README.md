# ReScheduler

ReScheduler is a standalone residency scheduling application. It loads as a static website and then does all of its work in the browser: editing, validation, mixed-integer optimization, constraint relaxation, and storage. There is no backend, database server, account system, or hosted solver.

The optimizer is [HiGHS 1.15](https://highs.dev/) compiled to WebAssembly. It runs in a Web Worker so the page stays usable while a model is solving. If the solver fails to load, ReScheduler stops and says so. It does not invent a schedule with a heuristic.

## Local development

Node.js 20 or newer is enough for local development. The GitHub Actions workflow uses Node.js 22.

```bash
npm install
npm run dev
```

Open the URL Vite prints, usually `http://127.0.0.1:5173`.

The first screen is a fictional sample program so the calendar is visible before any file is imported. Rotations, requirements, and training years are data, so the same application covers any residency. Two other samples are in Settings: a conflict that can be relaxed, and a staffing conflict that cannot. Real resident information does not belong in this repository. GitHub Pages publishes the files you commit.

## Tests

```bash
npm test
npm run test:e2e
```

`npm test` runs Vitest. It covers feasible schedules, impossible staffing, protected leave, locks, graduation requirements, career preferences, fairness, authorized relaxation, distinct alternatives, cancellation between stages, solver timeouts, and JSON, CSV, and Excel transfer. One test builds a validated schedule for the 60-resident demo. That test is slower than the others.

`npm run test:e2e` runs Playwright against the dev server in Chromium. The config and the spec are JavaScript so they load on Node 20.9, which does not provide `module.register`. Install the browser once with `npx playwright install chromium`. The end-to-end test checks that a two-variable binary integer program reaches objective 1 inside the worker.

```bash
npm run smoke:solver
```

runs the same class of HiGHS check directly in Node.

## Production build

```bash
npm run build
npm run preview
```

The build is a static `dist` directory. `base` is `./`, so the same files work on GitHub Pages, Cloudflare Pages, or Netlify without a repository-specific path. The WebAssembly file is emitted next to the JavaScript. The deployed site does not call a backend.

## GitHub Pages

The workflow in `.github/workflows/pages.yml` installs dependencies, runs the unit tests and Playwright, builds the site, and deploys `dist` with GitHub Actions. In the repository settings, set Pages to deploy from GitHub Actions. The first deployment needs the `github-pages` environment, which Actions creates.

Pushing to `main` or `master` starts the workflow. You can also run it manually.

## Importing and exporting

Settings has the full set of transfers:

- JSON project backup and restore, including settings, versions, and the audit log
- Excel workbook with residents, rotations, staffing, requirements, vacations, and assignments
- CSV schedule grid and CSV resident list
- ICS calendar of the current assignments
- Print from the master schedule

A file is checked before it replaces the program. Rows that point at missing people, blocks, or rotations are rejected and the current program stays as it is. A resident CSV replaces residents only. A schedule CSV replaces assignments for the residents it contains.

Chief residents can keep the workbook in a spreadsheet, import it for a solve, and export the result. The application does not require a shared database.

## Browser storage

Programs are stored in IndexedDB on this computer, in this browser profile. Clearing site data, using a private window, or moving to another computer removes them. This is not an enterprise-grade secure record. Exported JSON and Excel files contain the whole program, so treat them like any other local document, especially on a shared computer.

Settings can clear the saved copy and can reload a demonstration program. Reloading a demo replaces what is on screen. Export a backup first if you need to keep it.

## Optimization

Generate runs one mixed-integer model for every resident and block together. Hard constraints include eligibility, one rotation at a time, locked assignments, and approved vacation. Priority 0 requirements and staffing minimums are not relaxed. Lower-priority goals run in order: vacation, fairness, career and elective preferences, changes to the current grid, then spacing. A later stage is not allowed to undo the score of an earlier one.

If the strict model is infeasible, ReScheduler builds slack only for constraints you marked as relaxable. It minimizes higher-priority violations first, then the size of the violation, then the number of residents affected. It then prepares alternatives for vacation, fairness, career alignment, and the fewest changes. A proposal is offered as valid only after a separate validator accepts it. If the immutable constraints still cannot be satisfied, the page says that no valid schedule can be generated.

The time limit applies to each stage. Raising it can prove optimality on larger models. The status line says “proved optimal” only when HiGHS proved it and the relative gap setting is zero. Otherwise a feasible schedule is labeled as not proved optimal.

Stop terminates the worker. The interface does not keep an unvalidated partial solution from a cancelled run.
