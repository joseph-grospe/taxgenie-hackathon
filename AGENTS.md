# Repository Guidelines

## Project Structure & Module Organization
- `app/` holds the FastAPI service (API routes, core config, services, utils). Entry point: `app/main.py`.
- `modules/` contains supporting Python modules used by the extraction flow.
- `cache/`, `files/`, `results/` are runtime/working directories for document inputs and outputs.
- `docs/` contains architecture, requirements, and user journey references.
- `webapp/tax-track/` is the TanStack Start frontend (routes in `src/routes`, UI in `src/components`).

## Build, Test, and Development Commands
Backend (Python, uv):
- `uv pip install -r pyproject.toml` installs dependencies.
- `uv run uvicorn app.main:app --host 0.0.0.0 --port 8000` runs the API locally.

Frontend (TanStack Start, pnpm):
- `pnpm dev` runs the web app on port 3000.
- `pnpm build` builds the frontend.
- `pnpm preview` serves the production build.
- `pnpm lint` / `pnpm format` / `pnpm check` run eslint/prettier workflows.

## Coding Style & Naming Conventions
- Python: use snake_case for modules/functions; keep service logic in `app/services`.
- Frontend: routes are file-based in `webapp/tax-track/src/routes` (kebab-case files, e.g., `batch-status.tsx`).
- Components live in `webapp/tax-track/src/components`; shared UI in `src/components/ui`.
- Keep environment-specific values in `.env` (see README for required keys).

## UI Guidelines
- UI must be minimalist and functional; remove ornamental elements that do not support user tasks.
- Do not use gradients in backgrounds, text, or decorative elements.
- Prefer clean layouts, restrained spacing, and clear typographic hierarchy.
- Use Shadcn UI components where appropriate; use the Shadcn UI MCP tools to find, add, or reference components when needed.

## Testing Guidelines
- No test framework is configured in the Python service yet.
- Frontend uses `vitest` (`pnpm test`) but no tests are currently defined.
- When adding tests, keep names descriptive (e.g., `*.test.tsx`) and colocate with the feature.

## Commit & Pull Request Guidelines
- Recent commit messages are short, imperative, and scoped to the change (e.g., “Add cache data”).
- Follow the same style for new commits: one-line summary, present-tense verb.
- PRs should include: a concise summary, affected areas (API/UI/docs), and screenshots for UI changes.

## Security & Configuration Tips
- Do not commit secrets. Use `.env` with `GEMINI_API_KEY` and the
  Gemini/signature settings documented in `.env.sample`.
