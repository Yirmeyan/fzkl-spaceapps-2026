FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

COPY --from=ghcr.io/astral-sh/uv:0.13.1 /uv /bin/uv

WORKDIR /app

# Dependencies first, so that a code change does not reinstall them.
COPY pyproject.toml uv.lock .python-version README.md ./
RUN uv sync --locked --no-dev --no-install-project

COPY src ./src
RUN uv sync --locked --no-dev

RUN useradd --create-home --uid 10001 app
USER app

ENV PATH="/app/.venv/bin:$PATH" \
    PORT=8080
EXPOSE 8080

# Cloud Run provides PORT. The shell form expands it, and exec keeps uvicorn as PID 1.
CMD ["sh", "-c", "exec uvicorn spherex_explorer.api.app:create_app --factory --host 0.0.0.0 --port ${PORT}"]
