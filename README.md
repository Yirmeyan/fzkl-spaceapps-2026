# fzkl-spaceapps-2026

Project of team Foxtrot Zulu Kilo Lima for the 2026 NASA Space Apps Challenge.

- **Challenge:** [Planet X and SPHEREx](https://www.spaceappschallenge.org/2026/challenges/planet-x-and-spherex/)
- **Event:** November 14 and 15, 2026, Montréal local event
- **Status:** frontend viewer on the Barnard's Star sample; backend health endpoint live in `backend/`

## Quick start

```bash
# Site (Barnard's Star works offline from the sample)
cd frontend && npm install && npm run dev

# Service (optional for the health badge and later live frames)
cd backend && uv sync && uv run python -m uvicorn spherex_explorer.api.app:create_app --factory --reload
```

**Agents (Nic + Tommy):** read [`AGENTS.md`](AGENTS.md) and the live board [`docs/AGENT_BRIDGE.md`](docs/AGENT_BRIDGE.md) before working.

Plan: [`docs/architecture.md`](docs/architecture.md). Contract: [`docs/api-contract.md`](docs/api-contract.md). Challenge text: [`docs/challenge.md`](docs/challenge.md). Nic wake-up notes: [`docs/nic-handoff.md`](docs/nic-handoff.md). Win tracker: [`docs/win-progress.md`](docs/win-progress.md).

## AI usage

This project is built with the help of AI tools, including Claude by Anthropic and Cursor Agent. AI-assisted work is disclosed here and in the project submission, as the Space Apps guidelines require. This section will be updated as the project evolves.

## License

Copyright (C) 2026 the Foxtrot Zulu Kilo Lima team.

This program is free software: you can redistribute it and/or modify it under the terms of the GNU Affero General Public License as published by the Free Software Foundation, version 3. It is distributed without any warranty. See [LICENSE](LICENSE) for the full text.
