#!/usr/bin/env python3
"""Single-user kanban board server.

Serves the board UI and a small JSON API over data/board.json. Standard
library only (Python 3.9 or newer), so `python3 server.py` is all it takes.

The board file is read from disk on every request, so edits made to
data/board.json while the server runs (by hand or by Claude) are picked up.
Writes use the file's content hash as an ETag: a save made against an older
version of the file is refused with 409 rather than silently overwriting it.

Access control: by default the server binds to 127.0.0.1, which is what
keeps other machines out. It also refuses requests whose Host header is not an
allowed name (this defends against DNS-rebinding web pages, not against other
machines, since a client chooses its own Host header), and every write needs a
custom header that other websites cannot send. With --allow-remote (which the
Docker image uses, because it must listen on all interfaces inside the
container) the server additionally requires an access token: it prints a link
containing the token, opening it sets a cookie, and requests without the
cookie are refused.
"""

from __future__ import annotations

import argparse
import hmac
import io
import ipaddress
import json
import mimetypes
import os
import re
import secrets
import sys
import threading
import zipfile
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

sys.path.insert(0, str(Path(__file__).resolve().parent))
import boardlib  # noqa: E402

APP_DIR = Path(__file__).resolve().parent
STATIC_DIR = APP_DIR / "static"

MAX_BOARD_BYTES = 20 * 1024 * 1024
MAX_UPLOAD_BYTES = 10 * 1024 * 1024
# Random per process: lets server.py --stop and the same-board check confirm a
# recorded server is really this one, in every mode, without exposing anything.
INSTANCE = secrets.token_hex(8)
# Inside a container our pid means nothing to the host, so --stop from the host
# must not signal it (the container is stopped with docker compose stop).
IN_CONTAINER = os.path.exists("/.dockerenv") or os.path.exists("/run/.containerenv")
UPLOAD_NAME = re.compile(r"^[a-f0-9]{32}\.(png|jpg|gif|webp)$")
CLIENT_HEADER = "X-Kanban-Client"

CSP = (
    "default-src 'self'; "
    # Only the one pinned Mermaid file may load from the CDN, not all of jsDelivr.
    "script-src 'self' https://cdn.jsdelivr.net/npm/mermaid@11.17.2/dist/mermaid.min.js; "
    "style-src 'self' 'unsafe-inline'; "
    "img-src 'self' data: blob:; "
    "font-src 'self' data:; "
    "connect-src 'self'; "
    "object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"
)


sniff_image = boardlib.sniff_image


class BoardStore:
    """Owns data/board.json, data/uploads/, and data/backups/."""

    def __init__(self, data_dir: Path):
        self.data_dir = data_dir
        self.board_path = data_dir / "board.json"
        self.uploads_dir = data_dir / "uploads"
        self.backups_dir = data_dir / "backups"
        self.lock = threading.Lock()
        self.uploads_dir.mkdir(parents=True, exist_ok=True)

    def read(self):
        raw = self.board_path.read_bytes()
        return raw, boardlib.content_etag(raw)

    def write(self, board, if_match: str, backup_label: str = ""):
        """Returns (status, payload). Validates, checks the ETag, backs up, then writes.

        The thread lock serialises this server's own requests; board_lock also
        excludes the skill's scripts (edit_board.py, create_board.py --append).
        """
        problems = boardlib.validate_board(board)
        if problems:
            return HTTPStatus.UNPROCESSABLE_ENTITY, {"error": "invalid board", "problems": problems[:50]}
        try:
            with self.lock, boardlib.board_lock(self.board_path):
                _, current = self.read()
                if if_match != current:
                    return HTTPStatus.CONFLICT, {"error": "The board changed since you loaded it.", "etag": current}
                data = boardlib.serialise(board)
                boardlib.backup(self.board_path, self.backups_dir, backup_label)
                boardlib.atomic_write(self.board_path, data)
                return HTTPStatus.OK, {"etag": boardlib.content_etag(data)}
        except OSError as exc:
            return HTTPStatus.INTERNAL_SERVER_ERROR, {"error": f"The server could not write the board file: {exc.strerror or exc}. Check that data/ is writable."}

    def save_upload(self, data: bytes):
        """Returns (status, payload)."""
        ext = sniff_image(data)
        if ext is None:
            return HTTPStatus.UNSUPPORTED_MEDIA_TYPE, {"error": "Only PNG, JPEG, GIF, and WebP images can be attached."}
        name = f"{secrets.token_hex(16)}.{ext}"
        try:
            boardlib.atomic_write(self.uploads_dir / name, data)
        except OSError as exc:
            return HTTPStatus.INTERNAL_SERVER_ERROR, {"error": f"The server could not save the image: {exc.strerror or exc}. Check that data/uploads/ is writable."}
        return HTTPStatus.CREATED, {"path": f"uploads/{name}"}


class ThreadingHTTPServerV6(ThreadingHTTPServer):
    address_family = __import__("socket").AF_INET6


class Handler(BaseHTTPRequestHandler):
    server_version = "KanbanBoard/1"
    sys_version = ""
    store: BoardStore
    allowed_hosts: set
    token: str = ""  # set only with --allow-remote

    # ---- plumbing -------------------------------------------------------

    def log_message(self, fmt, *args):
        if os.environ.get("KANBAN_QUIET") != "1":
            sys.stderr.write("%s %s\n" % (self.log_date_time_string(), fmt % args))

    def _send(self, status, body: bytes = b"", content_type="application/json; charset=utf-8", headers=None):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Cache-Control", "no-store")
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _json(self, status, payload, headers=None):
        self._send(status, json.dumps(payload).encode("utf-8"), headers=headers)

    def _host_ok(self) -> bool:
        host = (self.headers.get("Host") or "").strip().lower()
        hostname = urlsplit("//" + host).hostname or ""
        return hostname in self.allowed_hosts

    def _token_ok(self) -> bool:
        """With --allow-remote, require the access cookie (or set it from ?token=)."""
        if not self.token:
            return True
        cookies = self.headers.get("Cookie") or ""
        for part in cookies.split(";"):
            name, _, value = part.strip().partition("=")
            if name == "kanban_token" and hmac.compare_digest(value, self.token):
                return True
        return False

    def _token_from_query(self):
        """If the URL carries a valid ?token=, set the cookie and redirect to the clean URL."""
        parts = urlsplit(self.path)
        for pair in parts.query.split("&"):
            name, _, value = pair.partition("=")
            if name == "token" and self.token and hmac.compare_digest(value, self.token):
                self.send_response(HTTPStatus.SEE_OTHER)
                self.send_header("Location", parts.path or "/")
                self.send_header("Set-Cookie", f"kanban_token={self.token}; HttpOnly; SameSite=Strict; Path=/")
                self.send_header("Content-Length", "0")
                self.end_headers()
                return True
        return False

    def _mutation_ok(self) -> bool:
        # A custom header cannot be set by a cross-site form or simple fetch
        # without a CORS preflight, which this server never approves.
        if self.headers.get(CLIENT_HEADER) != "1":
            return False
        origin = self.headers.get("Origin")
        if origin and origin != "null":
            o = urlsplit(origin)
            if (o.hostname or "") not in self.allowed_hosts:
                return False
            if o.netloc.lower() != (self.headers.get("Host") or "").lower():
                return False
        return True

    def _read_body(self, limit):
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            return None, "Bad Content-Length"
        if length <= 0:
            return None, "Empty body"
        if length > limit:
            return None, f"Body too large (limit {limit // (1024 * 1024)} MB)"
        return self.rfile.read(length), None

    # ---- routes ---------------------------------------------------------

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        if not self._host_ok():
            return self._json(HTTPStatus.FORBIDDEN, {"error": "Host not allowed"})
        path = urlsplit(self.path).path
        if path != "/api/health" and not self._token_ok():
            if self._token_from_query():
                return None
            if path.startswith("/api/"):
                return self._json(HTTPStatus.UNAUTHORIZED, {"error": "access link needed"})
            return self._send(
                HTTPStatus.UNAUTHORIZED,
                b"This board needs its access link. Open the link the server printed when it started "
                b"(with Docker: docker compose logs board).",
                content_type="text/plain; charset=utf-8",
            )
        if path in ("/", "/index.html"):
            return self._static("index.html")
        if path.startswith("/static/"):
            return self._static(path[len("/static/"):])
        if path.startswith("/uploads/"):
            return self._upload(path[len("/uploads/"):])
        if path == "/api/health":
            vendored = (STATIC_DIR / "vendor" / "mermaid.min.js").is_file()
            # "app", "data", and "pid" let a caller confirm it reached this board's server,
            # not another program or another board on the port. In token mode they
            # are left out, because /api/health needs no token.
            info = {"ok": True, "app": "kanban-board", "instance": INSTANCE, "pid": os.getpid(),
                    "container": IN_CONTAINER, "mermaidVendored": vendored}
            if not self.token:
                info["data"] = str(self.store.data_dir)
            return self._json(HTTPStatus.OK, info)
        if path == "/api/board":
            try:
                raw, etag = self.store.read()
            except FileNotFoundError:
                return self._json(HTTPStatus.NOT_FOUND, {"error": "data/board.json not found"})
            return self._send(HTTPStatus.OK, raw, headers={"ETag": etag})
        if path == "/api/version":
            try:
                _, etag = self.store.read()
            except FileNotFoundError:
                return self._json(HTTPStatus.NOT_FOUND, {"error": "data/board.json not found"})
            return self._json(HTTPStatus.OK, {"etag": etag})
        if path == "/api/export.zip":
            return self._export()
        return self._json(HTTPStatus.NOT_FOUND, {"error": "Not found"})

    def _refuse(self):
        if self._host_ok() and not self._token_ok():
            return self._json(HTTPStatus.UNAUTHORIZED, {"error": "access link needed"})
        return self._json(HTTPStatus.FORBIDDEN, {"error": "Request refused"})

    def do_PUT(self):
        if not self._host_ok() or not self._token_ok() or not self._mutation_ok():
            return self._refuse()
        if urlsplit(self.path).path != "/api/board":
            return self._json(HTTPStatus.NOT_FOUND, {"error": "Not found"})
        if_match = self.headers.get("If-Match")
        if not if_match:
            return self._json(HTTPStatus.PRECONDITION_REQUIRED, {"error": "If-Match header required"})
        body, err = self._read_body(MAX_BOARD_BYTES)
        if err:
            return self._json(HTTPStatus.BAD_REQUEST, {"error": err})
        try:
            board = json.loads(body.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            return self._json(HTTPStatus.BAD_REQUEST, {"error": f"Invalid JSON: {exc}"})
        label = self.headers.get("X-Kanban-Backup-Label", "")
        status, payload = self.store.write(board, if_match, label if re.match(r"^[a-z-]{1,30}$", label) else "")
        headers = {"ETag": payload["etag"]} if "etag" in payload else None
        return self._json(status, payload, headers=headers)

    def do_POST(self):
        if not self._host_ok() or not self._token_ok() or not self._mutation_ok():
            return self._refuse()
        if urlsplit(self.path).path != "/api/uploads":
            return self._json(HTTPStatus.NOT_FOUND, {"error": "Not found"})
        body, err = self._read_body(MAX_UPLOAD_BYTES)
        if err:
            return self._json(HTTPStatus.BAD_REQUEST, {"error": err})
        status, payload = self.store.save_upload(body)
        return self._json(status, payload)

    def do_DELETE(self):
        self._json(HTTPStatus.METHOD_NOT_ALLOWED, {"error": "Method not allowed"})

    # ---- helpers --------------------------------------------------------

    def _static(self, rel):
        target = (STATIC_DIR / rel).resolve()
        if STATIC_DIR.resolve() not in target.parents or not target.is_file():
            return self._json(HTTPStatus.NOT_FOUND, {"error": "Not found"})
        ctype = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype in ("application/javascript",):
            ctype += "; charset=utf-8"
        headers = {"Content-Security-Policy": CSP} if target.suffix == ".html" else None
        return self._send(HTTPStatus.OK, target.read_bytes(), content_type=ctype, headers=headers)

    def _upload(self, name):
        if not UPLOAD_NAME.match(name):
            return self._json(HTTPStatus.NOT_FOUND, {"error": "Not found"})
        target = self.store.uploads_dir / name
        if not target.is_file():
            return self._json(HTTPStatus.NOT_FOUND, {"error": "Not found"})
        ext = name.rsplit(".", 1)[1]
        ctype = {"png": "image/png", "jpg": "image/jpeg", "gif": "image/gif", "webp": "image/webp"}[ext]
        return self._send(
            HTTPStatus.OK,
            target.read_bytes(),
            content_type=ctype,
            headers={"Content-Security-Policy": "default-src 'none'", "Cache-Control": "private, max-age=86400"},
        )

    def _export(self):
        try:
            raw, _ = self.store.read()
        except FileNotFoundError:
            return self._json(HTTPStatus.NOT_FOUND, {"error": "data/board.json not found"})
        # Only images the board still uses: a screenshot deleted from a comment
        # (perhaps because it showed something sensitive) must not travel on.
        used = boardlib.referenced_uploads(json.loads(raw))
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("board.json", raw)
            for f in sorted(self.store.uploads_dir.iterdir()):
                if UPLOAD_NAME.match(f.name) and f.name in used:
                    zf.write(f, f"uploads/{f.name}")
        slug = boardlib.slugify(json.loads(raw).get("board", {}).get("title", "board"), "board")
        return self._send(
            HTTPStatus.OK,
            buf.getvalue(),
            content_type="application/zip",
            headers={"Content-Disposition": f'attachment; filename="{slug}-export.zip"'},
        )


def load_or_create_token(data_dir: Path) -> str:
    """Keep the access token in data/.kanban-token so the link survives restarts."""
    path = data_dir / ".kanban-token"
    try:
        token = path.read_text(encoding="utf-8").strip()
        if len(token) >= 20:
            return token
    except OSError:
        pass
    token = secrets.token_urlsafe(24)
    try:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(token + "\n")
    except OSError as exc:
        sys.stderr.write(f"Warning: could not save the access token ({exc}); the link will change on restart.\n")
    return token


def port_in_use(port: int):
    """Return an address where something already accepts connections on this port, or None.

    Binding 127.0.0.1 can succeed on macOS even while another program listens
    on the wildcard address (often IPv6), and "localhost" may then reach that
    other program instead of the board. So probe both loopbacks first.
    """
    import socket

    for family, addr in ((socket.AF_INET, "127.0.0.1"), (socket.AF_INET6, "::1")):
        try:
            with socket.socket(family, socket.SOCK_STREAM) as probe:
                probe.settimeout(0.5)
                if probe.connect_ex((addr, port)) == 0:
                    return addr
        except OSError:
            continue
    return None


def is_loopback(host: str) -> bool:
    if host in ("localhost",):
        return True
    try:
        return ipaddress.ip_address(host).is_loopback
    except ValueError:
        return False


def main(argv=None):
    parser = argparse.ArgumentParser(description="Run the kanban board.")
    parser.add_argument("--host", default=os.environ.get("KANBAN_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("KANBAN_PORT", "8080")))
    parser.add_argument("--data", default=os.environ.get("KANBAN_DATA", str(APP_DIR / "data")))
    parser.add_argument(
        "--allow-remote",
        action="store_true",
        default=os.environ.get("KANBAN_ALLOW_REMOTE") == "1",
        help="Permit binding to a non-loopback address. Turns on an access token (KANBAN_TOKEN, or one kept in data/.kanban-token), printed in a link at start.",
    )
    parser.add_argument(
        "--allowed-hosts",
        default=os.environ.get("KANBAN_ALLOWED_HOSTS", ""),
        help="Extra comma-separated Host names to accept (for example a LAN hostname). Loopback names are always accepted.",
    )
    parser.add_argument("--stop", action="store_true",
                        help="Stop the server this folder's board is running on (found via data/.server.json).")
    args = parser.parse_args(argv)

    if args.stop:
        return stop_running(Path(args.data).resolve())

    if not is_loopback(args.host) and not args.allow_remote:
        parser.error(
            f"Refusing to bind to {args.host}: the board has no login. "
            "Use 127.0.0.1, or pass --allow-remote if you accept that anyone who can reach it can edit it."
        )

    data_dir = Path(args.data).resolve()
    store = BoardStore(data_dir)
    if not store.board_path.exists():
        parser.error(f"No board found at {store.board_path}. Create one with the skill's create_board.py first.")
    raw, _ = store.read()
    try:
        problems = boardlib.validate_board(json.loads(raw))
    except json.JSONDecodeError as exc:
        problems = [f"board.json is not valid JSON: {exc}"]
    if problems:
        sys.stderr.write("Warning: board.json has problems; the browser will refuse to save until they are fixed:\n")
        for p in problems[:20]:
            sys.stderr.write(f"  - {p}\n")

    allowed = {"localhost", "127.0.0.1", "::1", "[::1]"}
    allowed.update(h.strip().lower() for h in args.allowed_hosts.split(",") if h.strip())
    Handler.store = store
    Handler.allowed_hosts = allowed
    if args.allow_remote:
        Handler.token = os.environ.get("KANBAN_TOKEN") or load_or_create_token(data_dir)

    running = recorded_server(data_dir)
    if running:
        sys.stderr.write(f"This board is already being served on port {running['port']} (pid {running['pid']}). "
                         "Open that, or stop it first with: python3 server.py --stop\n")
        return 1
    busy = port_in_use(args.port) if args.port else None
    if busy:
        sys.stderr.write(f"Another program is already listening on port {args.port} ({busy}), so localhost might "
                         f"reach it instead of the board. Choose another port with --port.\n")
        return 1
    try:
        server_class = ThreadingHTTPServerV6 if ":" in args.host else ThreadingHTTPServer
        httpd = server_class((args.host, args.port), Handler)
    except OSError as exc:
        sys.stderr.write(f"Could not listen on {args.host} port {args.port}: {exc}\n"
                         "Check the --host address, or try another port with --port.\n")
        return 1
    shown = "localhost" if is_loopback(args.host) or args.host in ("0.0.0.0", "::") else args.host
    port = os.environ.get("KANBAN_PUBLIC_PORT") or httpd.server_address[1]
    if Handler.token:
        print(f"Kanban board running. Open this link (it contains your access token):", flush=True)
        print(f"  http://{shown}:{port}/?token={Handler.token}", flush=True)
        print(f"Data: {data_dir}", flush=True)
    else:
        print(f"Kanban board running at http://{shown}:{port}/  (data: {data_dir})", flush=True)
    import signal

    # Installed before the record is written, so a SIGTERM at any point cleans up.

    def stop(signum, frame):  # `kill` should clean up like Ctrl+C does
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, stop)

    # data/.server.json records this server so `python3 server.py --stop` can stop
    # exactly it. A container also writes it (through the bind mount); --stop
    # then sees "container" and refuses rather than signal a meaningless pid.
    run_file = data_dir / ".server.json"
    try:
        # Where --stop and the same-board check can reach this server.
        probe_host = {"0.0.0.0": "127.0.0.1", "::": "::1", "localhost": "127.0.0.1"}.get(args.host, args.host)
        # In Docker, the port the host can reach is the published one.
        record_port = int(os.environ.get("KANBAN_PUBLIC_PORT") or httpd.server_address[1])
        record = {"pid": os.getpid(), "port": record_port, "host": probe_host,
                  "instance": INSTANCE, "container": IN_CONTAINER}
        run_file.write_text(json.dumps(record) + "\n", encoding="utf-8")
    except OSError:
        run_file = None
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()
        if run_file is not None:
            try:
                if json.loads(run_file.read_text(encoding="utf-8")).get("pid") == os.getpid():
                    run_file.unlink()
            except (OSError, ValueError):
                pass
    return 0


def recorded_server(data_dir: Path):
    """The live server recorded in data/.server.json for this folder, or None.

    A record is trusted only if a server on its recorded address reports the
    same random instance id, so a stale record (after a crash or reboot) is
    ignored. stop_running additionally checks the pid before signalling.
    """
    import urllib.request

    try:
        info = json.loads((data_dir / ".server.json").read_text(encoding="utf-8"))
        pid, port, instance = int(info["pid"]), int(info["port"]), str(info["instance"])
        raw_host = str(info.get("host") or "127.0.0.1")
        host = f"[{raw_host}]" if ":" in raw_host else raw_host
    except (OSError, ValueError, KeyError, TypeError):
        return None
    # No proxy: an http_proxy setting must not redirect a check of our own loopback port.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    # A loopback Host header, which every server accepts, even one bound to a LAN address.
    request = urllib.request.Request(f"http://{host}:{port}/api/health", headers={"Host": f"localhost:{port}"})
    try:
        with opener.open(request, timeout=3) as resp:
            health = json.loads(resp.read())
    except (OSError, ValueError):
        return None
    if health.get("instance") == instance:
        return {"pid": pid, "port": port, "reported_pid": health.get("pid"),
                "container": bool(health.get("container") or info.get("container"))}
    return None


def stop_running(data_dir: Path) -> int:
    """Stop this folder's server, after confirming the recorded pid really is it.

    The pid is signalled only if the live server on the recorded address
    reports the same instance id and the same pid, and is not in a container.
    """
    import signal
    import time

    run_file = data_dir / ".server.json"
    running = recorded_server(data_dir)
    if not running:
        if run_file.exists():
            run_file.unlink(missing_ok=True)
            print("The recorded server is not running (the record was stale and has been removed).")
        else:
            print("No running board server is recorded for this folder.")
        return 1
    pid, port = running["pid"], running["port"]
    if running["container"]:
        print("This board's server runs in a container; stop it with: docker compose stop")
        return 1
    if running["reported_pid"] != pid:
        print(f"The server on port {port} reports pid {running['reported_pid']}, not the recorded {pid}; "
              "not signalling anything. Stop it from the terminal it runs in.")
        return 1
    try:
        os.kill(pid, signal.SIGTERM)
    except (PermissionError, ProcessLookupError) as exc:
        print(f"Could not signal pid {pid}: {exc}. Stop it from the terminal it runs in.")
        return 1
    # Stopped means it no longer answers on its port. (Checking the pid alone
    # can mislead: an exited process lingers until its parent collects it.)
    for _ in range(100):  # up to 10 seconds
        time.sleep(0.1)
        if recorded_server(data_dir) is None:
            run_file.unlink(missing_ok=True)
            print(f"Stopped the board server on port {port} (pid {pid}).")
            return 0
    print(f"Asked the board server (pid {pid}) to stop, but it is still running. "
          f"Try again, or end it with: kill -9 {pid}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
