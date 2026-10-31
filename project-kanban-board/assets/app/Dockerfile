# Optional: the board runs with plain `python3 server.py`. Use Docker if you
# would rather not depend on the host's Python.
# The minor version is pinned; rebuilding (docker compose build --pull) picks up
# Python and Debian security patches for it.
FROM python:3.13-slim

WORKDIR /app
COPY server.py boardlib.py ./
COPY static ./static

# Inside the container the server must listen on all interfaces so Docker can
# forward to it; docker-compose.yml publishes the port on 127.0.0.1 only.
ENV KANBAN_HOST=0.0.0.0 \
    KANBAN_PORT=8080 \
    KANBAN_DATA=/app/data \
    KANBAN_ALLOW_REMOTE=1 \
    PYTHONUNBUFFERED=1

RUN useradd --system --uid 10001 kanban && mkdir -p /app/data && chown kanban /app/data
USER kanban

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8080/api/health')" || exit 1
CMD ["python", "server.py"]
