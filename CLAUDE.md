# Claude Code — Project Rules

## CHANGELOG.md
Update for every significant or user-facing change.
Follow Keep a Changelog format: sections are `### Added`, `### Fixed`, `### Changed`.
Header format: `## [VERSION] - YYYY-MM-DD — \`branch-name\``

## README.md
Update when any of the following change: routes, environment variables, file structure, or major features.

## Version sync
`frontend/src/version.ts` must match the version in the latest CHANGELOG.md entry.
Change only the `APP_VERSION` string — nothing else in that file.

## Branches
`feat/` · `fix/` · `refactor/` · `chore/`

## Type checking
Run `npx tsc` from `frontend/` before finishing any TypeScript change.

## Off-limits
Do not modify `.claude/settings.json`.
