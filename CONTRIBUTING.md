# Contributing

Working agreements for the team during the hackathon: two developers, 48 hours, one repository.

## Ground rules

- Everything is in English: code, comments, commits, pull requests, documentation and user interface.
- `main` always works. Nobody pushes to `main` directly.
- One small, testable step per pull request.
- A plan is agreed before any code is written for a new feature.
- When a requirement is unclear, ask before building.
- Errors and edge cases are handled explicitly. Nothing fails silently.
- No secrets and no environment-specific values in the code. Use environment variables or untracked configuration files, and keep `.env.example` up to date.
- Aim for the solution that gives most of the value for a fraction of the effort. Raise costly optimizations before starting them.

## Branches

- Start every branch from an up-to-date `main`.
- Name it `type/short-description`, for example `feat/cutout-fetcher` or `fix/spectral-wcs`.
- Keep branches short-lived: hours, not days.
- Each module has one owner. Agree on the interface between two modules before working on either side.

```
git switch main
git pull
git switch -c feat/short-description
```

## Commits

Commit messages follow the Conventional Commits format: `type(scope): summary`. The scope is optional.

- Types: `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `chore`, `ci`, `build`.
- Summary in the imperative mood, lower case, no final period, 72 characters at most.
- Example: `feat(cutouts): retry failed downloads`.

## Pull requests

- Open a pull request as soon as the step works, and fill in the template.
- Checks must pass before merging, once continuous integration is in place.
- Merge with "Squash and merge". The branch is deleted automatically.
- Review is not mandatory. Ask for one when the change touches the other person's module or a shared interface.
- After a merge, update your open branches:

```
git fetch origin
git rebase origin/main
```

## Code quality

- Small modules with a single responsibility, loose coupling and explicit interfaces.
- Tests cover the core computations.
- Comments explain intent, not mechanics.

## AI usage, sources and licenses

- The Space Apps rules allow AI tools and require their use to be disclosed. Commits created with an AI assistant carry a `Co-Authored-By` trailer, and the README keeps an "AI usage" section.
- Every external resource is cited with its license: data, code, libraries and images. The submission form requires it.
- The project is licensed under AGPL-3.0. Contributions are made under the same license.
