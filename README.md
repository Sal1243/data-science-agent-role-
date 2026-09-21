# Fieldnote

**A little clarity for your data.** A local-first data-science agent that turns a CSV into a profile, evidence-backed observations, a predictive baseline, and a portable report.

Fieldnote is a working React + FastAPI application, not a dashboard populated with hard-coded metrics. Its agent is a **deterministic pandas / scikit-learn workflow**, not an LLM. Every finding is computed from the selected dataset. No AI API key is required.

## What you can do

- **Start with a real workflow:** an explicitly synthetic, reproducible commerce dataset is ready on first launch.
- **Bring your own CSV:** drag and drop, validation, automatic type inference, leading-zero preservation for ID-named columns, and actionable parsing errors.
- **See the big picture:** completeness, duplicate rows, a documented quality score, time-series aggregates, category breakdowns, and histogram fallbacks. Missing time periods remain gaps, not invented zeros.
- **Investigate the details:** literal search, server-side sorting and pagination, expandable column profiles, and pairwise correlations with sample counts.
- **Test a predictive baseline:** choose a target, task, features, and random or chronological validation. Compare a random forest against a naive model, inspect held-out permutation importance, and review regression predictions or a classification confusion matrix.
- **Take the findings with you:** Markdown and structured JSON reports, including the latest experiment and its caveats.
- **Stay in control:** delete uploaded datasets, use a keyboard-accessible interface, and work on desktop or mobile. App fonts and runtime assets are self-hosted.

## Run it

Requires **Python 3.11+**, **Node.js 22+**, and npm. Commands below assume a Unix-like shell.

```bash
# Install the verified dependency set
python -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt -c requirements.lock.txt
npm ci

# Build the frontend and serve everything from one origin
npm run build
python -m uvicorn backend.app:app --host 0.0.0.0 --port 8000
```

Open `http://localhost:8000` on your own machine. In Arena, use the **Fieldnote live preview** instead of a localhost URL. The default page loads the synthetic commerce demo; use **New analysis** for your own data.

Alternatively: `make install && make start`.

### Development

```bash
./scripts/dev.sh
```

This starts FastAPI on port 8000 and Vite on port 5173, stopping both on exit. Open port 5173 for hot reload. The frontend uses relative `/api` URLs; Vite proxies them to the backend. Preview hosts ending in `.e2b.app` are allowed. Backend reloads clear in-memory uploads.

### Container

```bash
docker build -t fieldnote .
docker run --rm -p 8000:8000 fieldnote
```

The image runs as a non-root user with a **single worker**. Do not add workers without replacing the in-memory store with shared storage.

## A transparent analysis contract

| Area             | Method                                                                                                                                    |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Completeness     | Non-missing cells divided by all cells                                                                                                    |
| Quality score    | `0.8 × completeness % + 0.2 × exact-row uniqueness %`                                                                                     |
| Duplicate rows   | Exact duplicates across all columns; flagged, not silently deleted from the analysis                                                      |
| Relationships    | Pairwise Pearson correlation on at least 10 complete observations; identifiers and constants excluded                                     |
| Outlier flags    | Outside `Q1 − 1.5 × IQR` and `Q3 + 1.5 × IQR`; zero-IQR columns are not flagged                                                           |
| Time charts      | UTC-parsed dates, adaptive day/week/month/year aggregates; no imputation of missing periods                                               |
| Baseline model   | Seed-42 random forest, 80 trees, bounded depth, single CPU thread per fit                                                                 |
| Naive comparator | Training mean for regression; majority training class for classification                                                                  |
| Validation       | Random 80/20 holdout (stratified for classification), or earlier dates versus later dates; equal timestamps stay in one partition         |
| Leakage controls | Exact duplicates removed **before** splitting; target excluded; direct target copies excluded; preprocessing fitted on training data only |
| Importance       | Held-out permutation score drop over 3 shuffles, using up to 300 test rows                                                                |

These checks do **not** establish accuracy, fairness, causality, or future predictive performance. A strong holdout score can still hide leakage. Review feature availability, grouped entities, chronology, representativeness, and domain assumptions. There is no hyperparameter search, confidence interval estimation, causal analysis, or automatic production deployment.

The demo's revenue is computed from units, price, and discount; its model scores illustrate learning a known formula, **not forecasting a real business**. Amounts have no assumed currency.

### Input and resource limits

- UTF-8 / UTF-8-BOM `.csv`; comma, semicolon, tab, and pipe separators are detected.
- Maximum **15 MB**, **50,000 rows**, and **60 columns**. Request-body limits also apply to chunked uploads.
- Headers must be non-empty, unique after trimming, and at most 100 characters.
- Empty cells, whitespace-only cells, `null`, `NULL`, `NaN`, `nan`, and `N/A` are missing. The legitimate string `NA` is preserved. Infinite numeric values become missing, with a note.
- ID-named columns are loaded as strings so values such as `001` survive parsing. Other types are inferred. Common numeric date formats are detected; use ISO 8601 to avoid month/day ambiguity.
- Aggregate statistics use double precision and up to 12 significant digits; this is not arbitrary-precision financial arithmetic. Row previews serialize integers beyond JavaScript’s safe range as strings.
- Numeric magnitudes above `1e100` must be rescaled before analysis; this baseline requires feature and target magnitudes at most `1e30`.
- Modeling needs at least **60 distinct usable rows**, at most **30 selected features**, and a non-constant target. Classification supports up to **20 classes**, with at least **5 examples per class** before splitting.
- Large model runs use a disclosed, reproducible sample of at most **10,000 rows**. One experiment can run at a time.
- Identifiers, dates, free text, and empty/constant columns are not automatically modeled. Auto task detection treats small integer label sets as classification; override this when counts or ratings should be regression.

## Privacy and deployment boundaries

**This is a trusted, single-user workspace—not a multi-tenant service.** There is no authentication or user isolation. Anyone who can reach its API can access the workspace. Add authentication, authorization, per-user storage, TLS, rate limits, and an appropriate retention policy before public deployment.

- Uploaded datasets live in server memory; they are not intentionally saved to the repository or a database. Multipart parsing may use temporary upload files, which are closed after processing.
- At most **four uploads** plus the synthetic demo are retained. A fifth upload evicts the least recently used upload.
- Uploads expire after **two hours without access**; expired entries are cleaned on access and by a once-per-minute sweep. Restarting the server clears all uploads and model results.
- Only the last selected dataset ID is stored in browser local storage, not the dataset itself.
- Reports do not include whole raw rows, but column names, category labels, summaries, and sampled evaluation values can still be sensitive. Review exports before sharing.
- No dataset or prompt is sent to an external AI service. The built app works without external runtime requests; FastAPI's optional Swagger documentation uses its standard CDN-hosted documentation assets.

## Verify it

```bash
source .venv/bin/activate
ruff check backend tests
ruff format --check backend tests
pytest -q
npm run format:check
npm run build

# Install a browser once, then test desktop and mobile workflows
npx playwright install --with-deps chromium
npm run test:e2e
```

Playwright starts the API when needed (activate the virtual environment first) and reuses an existing local server outside CI. Build the frontend before running browser tests. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` if using an already installed Chromium binary.

Coverage includes malformed CSVs, encoding and shape limits, literal searches, nullable statistics, time gaps, deterministic demo generation, ID preservation, report escaping, deletion/expiry, preprocessing isolation, reproducible regression/classification, model guardrails, real uploads/downloads, retry states, mobile overflow, modal focus restoration, and automated WCAG AA checks. Automated accessibility checks are useful but not a substitute for manual assistive-technology testing.

A CI workflow can run the same backend lint/tests, frontend formatting/build, and browser tests. No workflow is currently version-controlled; run the verification commands above locally. No GitHub secrets or AI credentials are needed.

## API

Interactive docs: `/api/docs` · schema: `/api/openapi.json`

| Endpoint                        | Purpose                                          |
| ------------------------------- | ------------------------------------------------ |
| `GET /api/health`               | Service health                                   |
| `GET /api/demo`                 | Load the reproducible demo and its analysis      |
| `GET /api/datasets`             | List the in-memory workspace                     |
| `POST /api/datasets`            | Analyze a multipart `file` upload                |
| `GET /api/datasets/{id}`        | Dataset profile and findings                     |
| `DELETE /api/datasets/{id}`     | Remove an uploaded dataset and its experiment    |
| `GET /api/datasets/{id}/rows`   | `search`, `sort`, `direction`, `offset`, `limit` |
| `GET /api/datasets/{id}/charts` | `metric`, `aggregation=sum\|mean`, `category`    |
| `POST /api/datasets/{id}/model` | `{target, task, split, features?}`               |
| `GET /api/datasets/{id}/model`  | Latest completed experiment, or `null`           |
| `GET /api/datasets/{id}/report` | Download `format=markdown\|json`                 |

## Project map

```text
backend/
  analysis.py    CSV validation, schema inference, profiling, charts, findings
  modeling.py    Training-only preprocessing and held-out baseline evaluation
  store.py       Bounded, expiring in-memory dataset workspace
  reports.py     Escaped Markdown report generation
  app.py         FastAPI routes, request limits, cleanup, static app serving
src/
  App.tsx        Workspace, dataset lifecycle, upload and guide dialogs
  Dashboard.tsx  Overview, charts, quality checks, agent observations
  Explorer.tsx   Searchable rows, schema profiles, relationships
  ModelLab.tsx   Experiment controls, metrics, predictions, importance
  Reports.tsx    Readable findings, methods, next steps, exports
tests/           Backend unit and API integration tests
e2e/             Real-browser desktop, mobile, and accessibility tests
```
