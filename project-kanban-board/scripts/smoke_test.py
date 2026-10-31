#!/usr/bin/env python3
"""Smoke-test a generated board project without touching its real data.

    smoke_test.py path/to/board-project [--screenshot out.png] [--no-browser]

Copies the project to a temporary directory, starts its server on a free
port, and checks: the page and assets load with security headers; the board
API returns a valid board with an ETag; stale and unauthenticated writes are
refused; a valid write succeeds; image uploads are accepted and non-images
refused; the export zip contains the board; and foreign Host headers are
refused; a delete-labelled save keeps a pinned backup; a disk error is
reported as an HTTP error rather than a dropped connection; with
--allow-remote the access token is enforced; and, if Node is installed, the
Markdown renderer neutralises a set of HTML and attribute-injection attacks.
If Chrome or Chromium is installed, it also loads the page headlessly and
checks that the expected number of cards rendered, optionally saving a
screenshot. With Chrome and Node 22 or newer, it then runs ui_check.mjs: an
interactive browser test of the project's app code against a throwaway board
built from assets/fixture-plan.json. That covers adding and editing comments
(with timestamps), pasted images, Mermaid rendering, drag and drop with the
blocked and waiting prompts, swimlane reassignment, the Overview, and edits
made by edit_board.py while the page is open.

Prints PASS/FAIL per check (and SKIP for checks it could not run) and exits
non-zero if any check failed.
"""

from __future__ import annotations

import argparse
SKILL_DIR = __import__("pathlib").Path(__file__).resolve().parent.parent
import http.client
import io
import json
import os
import re
import shutil
import socket
import subprocess
import sys
sys.dont_write_bytecode = True  # keep the skill folder free of caches
import tempfile
import time
import zipfile
from pathlib import Path

# Each case must render with no attribute or tag injected. Checked under Node
# against the real static/markdown.js.
MARKDOWN_ATTACKS = [
    "<img src=x onerror=alert(1)>",
    "<script>alert(1)</script>",
    "![ https://x/onerror=alert(1)//](uploads/0123456789abcdef0123456789abcdef.png)",
    '[https://a.example/" onmouseover="alert(1)](https://b.example)',
    "[x](javascript:alert(1))",
    "![x](javascript:alert(1))",
    "![x](https://tracker.example/pixel.png)",
    "`<b>` **<i>x</i>** https://ok.example/a\"onmouseover=alert(1)",
    "| a | b |\n| --- | --- |\n| <svg onload=alert(1)> | ok |",
]
NODE_CHECK = r"""
const { renderMarkdown } = require(process.argv[1]);
const cases = JSON.parse(process.argv[2]);
const bad = [];
for (const c of cases) {
  const html = renderMarkdown(c);
  // Every tag the renderer emits, and every attribute name in it, must be on the allow-list.
  const tags = /<\/?([a-zA-Z0-9]+)([^>]*)>/g;
  let m;
  while ((m = tags.exec(html))) {
    const tag = m[1].toLowerCase();
    const okTags = ['p','br','strong','em','del','code','pre','a','img','span','ul','ol','li','input','h3','h4','h5','h6','hr','blockquote','div','table','thead','tbody','tr','th','td'];
    if (!okTags.includes(tag)) bad.push([c, 'tag ' + tag]);
    const attrs = m[2].replace(/"[^"]*"/g, '""').match(/[a-zA-Z-:]+(?==)|\s[a-zA-Z-:]+(?=\s|$)/g) || [];
    for (const a of attrs.map((x) => x.trim().toLowerCase())) {
      if (!['href','src','alt','target','rel','class','loading','type','disabled','checked'].includes(a)) bad.push([c, 'attribute ' + a]);
    }
    if (/href="(?!https?:|mailto:|uploads\/)/.test(m[2]) || /src="(?!uploads\/)/.test(m[2])) bad.push([c, 'url ' + m[2]]);
  }
}
console.log(JSON.stringify(bad));
"""

PNG_1PX = bytes.fromhex(
    "89504e470d0a1a0a0000000d4948445200000001000000010806000000"
    "1f15c4890000000d49444154789c6360f8cfc0f01f0005000201e2b1d3"
    "8c0000000049454e44ae426082"
)

results = []


def check(name, ok, detail=""):
    results.append((name, bool(ok)))
    print(f"{'PASS' if ok else 'FAIL'}  {name}{(': ' + detail) if detail and not ok else ''}")


def skip(name, why):
    print(f"SKIP  {name}: {why}")


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def request(port, method, path, body=None, headers=None, host=None):
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=10)
    hdrs = {"Host": host or f"localhost:{port}"}
    hdrs.update(headers or {})
    conn.request(method, path, body=body, headers=hdrs)
    res = conn.getresponse()
    data = res.read()
    conn.close()
    return res.status, dict((k.lower(), v) for k, v in res.getheaders()), data


def find_chrome():
    candidates = [
        os.environ.get("CHROME"),
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Chromium.app/Contents/MacOS/Chromium",
        shutil.which("google-chrome"),
        shutil.which("google-chrome-stable"),
        shutil.which("chromium"),
        shutil.which("chromium-browser"),
        shutil.which("chrome"),
    ]
    for c in candidates:
        if c and Path(c).exists():
            return c
    return None


def expected_cards(board):
    s = board.get("settings", {})
    n = 0
    for t in board["tickets"]:
        if t["type"] == "epic" and not s.get("showEpicCards", False):
            continue
        if t["type"] == "subtask" and not s.get("showSubtasks", True):
            continue
        n += 1
    return n


def run_tool_checks(work, port, proc, env, upload_path):
    """The maintenance tools and server safety features, on the temporary copy."""
    edit = [sys.executable, str(SKILL_DIR / "scripts" / "edit_board.py"), str(work)]
    st, _, body = request(port, "GET", "/api/health")
    health = json.loads(body) if st == 200 else {}
    check("health identifies this board's server",
          health.get("app") == "kanban-board" and health.get("pid") == proc.pid
          and health.get("data") == str((work / "data").resolve()), json.dumps(health))

    other = work.parent / "other-board"
    shutil.copytree(work / "data", other / "data", ignore=shutil.ignore_patterns(".server.json"))
    second = subprocess.run([sys.executable, str(work / "server.py"), "--port", str(port), "--data", str(other / "data")],
                            capture_output=True, text=True, timeout=20, env=env)
    check("a server on a busy port refuses to start",
          second.returncode == 1 and "already listening" in second.stderr, second.stderr[-200:])
    third = subprocess.run([sys.executable, str(work / "server.py"), "--port", str(free_port()), "--data", str(work / "data")],
                           capture_output=True, text=True, timeout=20, env=env)
    check("a second server for the same board refuses to start",
          third.returncode == 1 and "already being served" in third.stderr, third.stderr[-200:])

    # Records that must never lead to a signal: wrong instance, and right instance but wrong pid.
    fake = work.parent / "fake-board"
    shutil.copytree(work / "data", fake / "data", ignore=shutil.ignore_patterns(".server.json"))
    stop_cmd = [sys.executable, str(work / "server.py"), "--stop", "--data", str(fake / "data")]
    (fake / "data" / ".server.json").write_text(json.dumps(
        {"pid": proc.pid, "port": port, "host": "127.0.0.1", "instance": "not-the-real-one"}), encoding="utf-8")
    r1 = subprocess.run(stop_cmd, capture_output=True, text=True, timeout=20)
    (fake / "data" / ".server.json").write_text(json.dumps(
        {"pid": 999999, "port": port, "host": "127.0.0.1", "instance": health.get("instance")}), encoding="utf-8")
    r2 = subprocess.run(stop_cmd, capture_output=True, text=True, timeout=20)
    still_up = proc.poll() is None and request(port, "GET", "/api/health")[0] == 200
    check("--stop refuses records whose instance or pid do not match",
          r1.returncode == 1 and r2.returncode == 1 and "not signalling" in r2.stdout and still_up,
          r1.stdout + r2.stdout)

    board = json.loads((work / "data" / "board.json").read_text(encoding="utf-8"))
    target = next(t["id"] for t in board["tickets"] if t["type"] != "epic")
    # Quotes, a backslash, $1, and a backtick: everything a shell or JSON would alter.
    secret = 'pa"ss\\wo$1rd`-7Q'
    r = subprocess.run(edit + ["--op", json.dumps({"op": "comment", "id": target, "body": "token " + secret})],
                       capture_output=True, text=True)
    cid = (r.stdout.split("comment ")[1].split(" ")[0]) if r.returncode == 0 else ""
    subprocess.run(edit + ["--op", json.dumps({"op": "delete-comment", "id": target, "comment": cid})], capture_output=True)
    # A reason containing the secret ends up in a status-history note when the ticket moves on.
    blocked = next((c["name"] for c in board["columns"] if c["kind"] == "blocked"), None)
    if blocked:
        subprocess.run(edit + ["--op", json.dumps({"op": "move", "id": target, "status": blocked, "reason": "key " + secret})],
                       capture_output=True)
        subprocess.run(edit + ["--op", json.dumps({"op": "move", "id": target, "status": "done"})], capture_output=True)
    subprocess.run(edit + ["--op", json.dumps({"op": "set", "id": target, "fields": {"priority": "high"}})], capture_output=True)
    # While the text is still on the board, purge must refuse and delete nothing.
    subprocess.run(edit + ["--op", json.dumps({"op": "set", "id": target, "fields": {"description": "kept " + secret}})],
                   capture_output=True)
    backups_before = len(list((work / "data" / "backups").glob("*.json")))
    refused = subprocess.run(edit + ["--purge-text", secret], capture_output=True, text=True)
    check("--purge-text refuses while the text is still on the board",
          refused.returncode == 1 and len(list((work / "data" / "backups").glob("*.json"))) == backups_before,
          refused.stdout + refused.stderr)
    subprocess.run(edit + ["--op", json.dumps({"op": "set", "id": target, "fields": {"description": ""}})], capture_output=True)
    escaped = json.dumps(secret)[1:-1]
    holds = lambda f: escaped in f.read_text(encoding="utf-8", errors="replace")  # noqa: E731
    innocent = [f.name for f in (work / "data" / "backups").glob("*.json") if not holds(f)]
    r = subprocess.run(edit + ["--purge-text-stdin"], input=secret + "\n", capture_output=True, text=True)
    leftovers = [f.name for f in (work / "data").rglob("*.json") if holds(f)]
    survivors = [n for n in innocent if (work / "data" / "backups" / n).exists()]
    check("--purge-text-stdin removes the text from history notes and backups, and only those",
          r.returncode == 0 and "Deleted 0" not in r.stdout and not leftovers and len(survivors) == len(innocent),
          r.stdout + r.stderr + str(leftovers))
    found = subprocess.run(edit + ["--find-text-stdin"], input=secret + "\n", capture_output=True, text=True)
    check("--find-text-stdin confirms the text is gone", found.returncode == 0 and "Not found" in found.stdout,
          found.stdout + found.stderr)

    r = subprocess.run(edit + ["--op", json.dumps({"op": "set-board", "assumptions": ["Smoke assumption"]})],
                       capture_output=True, text=True)
    r2 = subprocess.run(edit + ["--op", '{"op": "set-board"}'], capture_output=True, text=True)
    saved = json.loads((work / "data" / "board.json").read_text(encoding="utf-8"))["board"].get("assumptions")
    check("set-board edits assumptions and refuses an empty change",
          r.returncode == 0 and saved == ["Smoke assumption"] and r2.returncode == 1, r.stderr + r2.stderr)

    # A container-run server must never be signalled from the host.
    (fake / "data" / ".server.json").write_text(json.dumps(
        {"pid": proc.pid, "port": port, "host": "127.0.0.1", "instance": health.get("instance"), "container": True}),
        encoding="utf-8")
    r3 = subprocess.run(stop_cmd, capture_output=True, text=True, timeout=20)
    check("--stop refuses a server recorded as running in a container",
          r3.returncode == 1 and "docker compose stop" in r3.stdout and proc.poll() is None, r3.stdout + r3.stderr)

    # An image a comment still uses must survive even --include-recent.
    st_up, _, body_up = request(port, "POST", "/api/uploads", PNG_1PX, {"Content-Type": "image/png", "X-Kanban-Client": "1"})
    used_path = json.loads(body_up).get("path") if st_up == 201 else None
    if used_path:
        subprocess.run(edit + ["--op", json.dumps({"op": "comment", "id": target, "body": f"![shot]({used_path})"})],
                       capture_output=True)
    if upload_path:
        name = upload_path.split("/")[-1]
        r1 = subprocess.run(edit + ["--clean-uploads"], capture_output=True, text=True)
        kept = (work / "data" / "uploads" / name).exists()
        r2 = subprocess.run(edit + ["--clean-uploads", "--include-recent"], capture_output=True, text=True)
        gone = not (work / "data" / "uploads" / name).exists()
        in_use = bool(used_path) and (work / "data" / used_path).exists()
        check("--clean-uploads reports recent images; --include-recent removes them but keeps images in use",
              kept and "Kept 1" in r1.stdout and gone and in_use, r1.stdout + r2.stdout)

    r = subprocess.run(edit + ["--op", '{"op": "add-column", "name": "Smoke column", "kind": "testing"}'],
                       capture_output=True, text=True)
    r2 = subprocess.run(edit + ["--op", '{"op": "remove-column", "column": "Smoke column"}'], capture_output=True, text=True)
    r3 = subprocess.run(edit + ["--op", '{"op": "move", "id": "%s", "status": "done", "waitingOn": "x"}' % target],
                        capture_output=True, text=True)
    check("edit_board column ops work and unknown op keys are refused",
          r.returncode == 0 and r2.returncode == 0 and r3.returncode == 1 and "reason" in r3.stderr,
          (r.stderr + r2.stderr + r3.stderr)[-300:])


def run_ui_check(work, tmp, chrome, env, shot_dir):
    """Interactive browser test of the project's app code on a throwaway fixture board."""
    node = shutil.which("node")
    if not node or subprocess.run([node, "-e", "process.exit(typeof WebSocket === 'function' ? 0 : 1)"]).returncode != 0:
        skip("interactive browser checks", "needs Node 22 or newer (for its built-in WebSocket)")
        return
    fixture = tmp / "fixture"
    fixture.mkdir()
    for name in ("server.py", "boardlib.py"):
        shutil.copy2(work / name, fixture / name)
    shutil.copytree(work / "static", fixture / "static")
    sys.path.insert(0, str(work))
    import boardlib
    plan = json.loads((SKILL_DIR / "assets" / "fixture-plan.json").read_text(encoding="utf-8"))
    board_path = fixture / "data" / "board.json"
    board_path.parent.mkdir()
    boardlib.atomic_write(board_path, boardlib.serialise(boardlib.build_board_from_plan(plan)))
    port = free_port()
    proc = subprocess.Popen([sys.executable, str(fixture / "server.py"), "--port", str(port), "--data", str(fixture / "data")],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=env)
    try:
        for _ in range(50):
            try:
                if request(port, "GET", "/api/health")[0] == 200:
                    break
            except OSError:
                time.sleep(0.2)
        cmd = [node, str(SKILL_DIR / "scripts" / "ui_check.mjs"), str(port), str(board_path),
               str(SKILL_DIR / "scripts" / "edit_board.py"), chrome, sys.executable] + ([str(shot_dir / "ui-check")] if shot_dir else [])
        try:
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=240)
            out = r.stdout
        except subprocess.TimeoutExpired:
            check("interactive browser checks", False, "timed out after 4 minutes")
            return
        lines = [l for l in out.splitlines() if l.startswith(("PASS", "FAIL", "SKIP"))]
        for line in lines:
            name, _, detail = line[6:].partition(": ")
            if line.startswith("SKIP"):
                skip("ui: " + name, detail)
            else:
                check("ui: " + name, line.startswith("PASS"), detail)
        if r.returncode != 0 and not any(l.startswith("FAIL") for l in lines):
            check("interactive browser checks completed", False, f"exit {r.returncode}: {(out + r.stderr)[-300:]}")
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("project", help="Board project directory (contains server.py and data/).")
    ap.add_argument("--screenshot", help="Save a headless-browser screenshot here.")
    ap.add_argument("--no-browser", action="store_true", help="Skip the headless browser checks.")
    args = ap.parse_args(argv)

    project = Path(args.project).resolve()
    if not (project / "server.py").exists() or not (project / "data" / "board.json").exists():
        print(f"{project} does not look like a board project (needs server.py and data/board.json).")
        return 2

    tmp = Path(tempfile.mkdtemp(prefix="kanban-smoke-"))
    proc = None
    try:
        work = tmp / "project"
        shutil.copytree(project, work, ignore=shutil.ignore_patterns("backups", "__pycache__"))
        port = free_port()
        env = dict(os.environ, KANBAN_QUIET="1")
        proc = subprocess.Popen(
            [sys.executable, str(work / "server.py"), "--port", str(port), "--data", str(work / "data")],
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env=env,
        )
        up = False
        for _ in range(50):
            try:
                if request(port, "GET", "/api/health")[0] == 200:
                    up = True
                    break
            except OSError:
                pass
            if proc.poll() is not None:
                break
            time.sleep(0.2)
        if not up:
            out = proc.stdout.read().decode() if proc.poll() is not None else ""
            check("server starts", False, out.strip() or "no response within 10 seconds")
            return 1
        check("server starts", True)

        st, hdr, body = request(port, "GET", "/")
        check("index page loads with CSP", st == 200 and "content-security-policy" in hdr and b"app.js" in body, f"HTTP {st}")
        for asset in ("/static/app.js", "/static/app.css", "/static/markdown.js"):
            st, _, _ = request(port, "GET", asset)
            check(f"{asset} loads", st == 200, f"HTTP {st}")
        st, _, _ = request(port, "GET", "/static/../server.py")
        check("path traversal refused", st == 404, f"HTTP {st}")

        st, hdr, raw = request(port, "GET", "/api/board")
        board = json.loads(raw) if st == 200 else None
        etag = hdr.get("etag")
        check("board API returns board with ETag", st == 200 and etag and isinstance(board, dict), f"HTTP {st}")
        if not board:
            return 1
        sys.path.insert(0, str(work))
        import boardlib  # the project's own copy

        problems = boardlib.validate_board(board)
        check("served board is valid", not problems, "; ".join(problems[:5]))

        st, _, _ = request(port, "GET", "/api/board", host="evil.example:80")
        check("foreign Host header refused", st == 403, f"HTTP {st}")

        payload = json.dumps(board).encode()
        base = {"Content-Type": "application/json"}
        st, _, _ = request(port, "PUT", "/api/board", payload, {**base, "If-Match": etag})
        check("write without client header refused", st == 403, f"HTTP {st}")
        st, _, _ = request(port, "PUT", "/api/board", payload,
                           {**base, "If-Match": etag, "X-Kanban-Client": "1", "Origin": "http://evil.example"})
        check("cross-origin write refused", st == 403, f"HTTP {st}")
        st, _, _ = request(port, "PUT", "/api/board", payload, {**base, "If-Match": '"stale"', "X-Kanban-Client": "1"})
        check("stale write refused with 409", st == 409, f"HTTP {st}")
        bad = json.loads(payload)
        bad["columns"] = []
        st, _, _ = request(port, "PUT", "/api/board", json.dumps(bad).encode(), {**base, "If-Match": etag, "X-Kanban-Client": "1"})
        check("invalid board refused with 422", st == 422, f"HTTP {st}")

        board["board"]["description"] = (board["board"].get("description") or "") + " "
        st, hdr2, body2 = request(port, "PUT", "/api/board", json.dumps(board).encode(),
                                  {**base, "If-Match": etag, "X-Kanban-Client": "1", "Origin": f"http://localhost:{port}"})
        new_etag = json.loads(body2).get("etag") if st == 200 else None
        check("valid write accepted and ETag changes", st == 200 and new_etag and new_etag != etag, f"HTTP {st} {body2[:200]!r}")
        backups = list((work / "data" / "backups").glob("board-*.json"))
        check("previous version backed up", len(backups) >= 1)
        st, _, body3 = request(port, "PUT", "/api/board", json.dumps(board).encode(),
                               {**base, "If-Match": new_etag or "", "X-Kanban-Client": "1", "X-Kanban-Backup-Label": "before-delete"})
        pinned = list((work / "data" / "backups").glob("board-*-before-delete.json"))
        check("delete-labelled save keeps a pinned backup", st == 200 and len(pinned) == 1, f"HTTP {st}, {len(pinned)} pinned")
        new_etag = json.loads(body3).get("etag") if st == 200 else new_etag

        if os.name == "nt" or (hasattr(os, "geteuid") and os.geteuid() == 0):
            skip("disk error reported", "file permissions cannot simulate a write failure on Windows or as root")
        else:
            data_dir = work / "data"
            os.chmod(data_dir, 0o555)
            try:
                st, _, body4 = request(port, "PUT", "/api/board", json.dumps(board).encode(),
                                       {**base, "If-Match": new_etag or "", "X-Kanban-Client": "1"})
            except OSError as exc:
                st, body4 = 0, str(exc).encode()
            finally:
                os.chmod(data_dir, 0o755)
            check("disk error reported as HTTP 500 with a reason", st == 500 and b"could not write" in body4, f"HTTP {st} {body4[:120]!r}")

        st, _, body = request(port, "POST", "/api/uploads", PNG_1PX, {"Content-Type": "image/png", "X-Kanban-Client": "1"})
        path = json.loads(body).get("path") if st == 201 else None
        check("PNG upload accepted", st == 201 and path and re.match(r"^uploads/[a-f0-9]{32}\.png$", path), f"HTTP {st}")
        if path:
            st, hdr, data = request(port, "GET", "/" + path)
            check("uploaded image served as image/png", st == 200 and hdr.get("content-type") == "image/png" and data == PNG_1PX, f"HTTP {st}")
        svg = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
        st, _, _ = request(port, "POST", "/api/uploads", svg, {"Content-Type": "image/svg+xml", "X-Kanban-Client": "1"})
        check("SVG/non-raster upload refused", st == 415, f"HTTP {st}")

        st, hdr, data = request(port, "GET", "/api/export.zip")
        ok = False
        if st == 200:
            with zipfile.ZipFile(io.BytesIO(data)) as zf:
                names = zf.namelist()
                # The PNG uploaded above is referenced by nothing, so it must be left out.
                ok = "board.json" in names and (not path or path not in names)
        check("export zip has the board and leaves out unreferenced images", ok, f"HTTP {st}")

        run_tool_checks(work, port, proc, env, path)

        node = shutil.which("node")
        if not node:
            skip("Markdown renderer resists injection", "Node is not installed")
        else:
            r = subprocess.run([node, "-e", NODE_CHECK, str(work / "static" / "markdown.js"), json.dumps(MARKDOWN_ATTACKS)],
                               capture_output=True, text=True, timeout=30)
            try:
                bad = json.loads(r.stdout.strip() or "null")
            except json.JSONDecodeError:
                bad = None
            check("Markdown renderer resists injection", bad == [], (r.stdout + r.stderr)[:300])

        # Token mode: what Docker and --allow-remote use. Its own copy of the data,
        # because a second server for the same folder is refused.
        token_data = tmp / "token-data"
        shutil.copytree(work / "data", token_data, ignore=shutil.ignore_patterns(".server.json"))
        tport = free_port()
        tproc = subprocess.Popen(
            [sys.executable, str(work / "server.py"), "--port", str(tport), "--data", str(token_data), "--allow-remote"],
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env=dict(env, KANBAN_TOKEN="smoke-token-123"),
        )
        try:
            for _ in range(50):
                try:
                    if request(tport, "GET", "/api/health")[0] == 200:
                        break
                except OSError:
                    time.sleep(0.2)
            st1 = request(tport, "GET", "/")[0]
            st2 = request(tport, "GET", "/api/board")[0]
            st3, h3, _ = request(tport, "GET", "/?token=wrong")
            st4, h4, _ = request(tport, "GET", "/?token=smoke-token-123")
            cookie = (h4.get("set-cookie") or "").split(";")[0]
            st5 = request(tport, "GET", "/api/board", headers={"Cookie": cookie})[0]
            th = json.loads(request(tport, "GET", "/api/health")[2] or b"{}")
            check("token-mode health does not reveal the data path", "data" not in th and th.get("app") == "kanban-board",
                  json.dumps(th))
            st6 = request(tport, "PUT", "/api/board", b"{}", {"X-Kanban-Client": "1", "If-Match": "x"})[0]
            check("token mode refuses requests without the token", (st1, st2, st3, st6) == (401, 401, 401, 401), f"{(st1, st2, st3, st6)}")
            check("token link sets cookie and grants access", st4 == 303 and cookie.startswith("kanban_token=") and st5 == 200, f"{st4} {cookie!r} {st5}")
            tstop = subprocess.run([sys.executable, str(work / "server.py"), "--stop", "--data", str(token_data)],
                                   capture_output=True, text=True, timeout=30)
            try:
                exited = tproc.wait(timeout=10) is not None
            except subprocess.TimeoutExpired:
                exited = False
            check("server.py --stop works in token mode", tstop.returncode == 0 and exited, tstop.stdout + tstop.stderr)
        finally:
            if tproc.poll() is None:
                tproc.terminate()
            try:
                tproc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                tproc.kill()

        if args.no_browser:
            skip("browser render", "--no-browser given")
        else:
            chrome = find_chrome()
            if not chrome:
                skip("browser render", "no Chrome or Chromium found (set CHROME=/path/to/chrome to enable)")
            else:
                profile = tmp / "chrome-profile"
                # Wide enough for every column, so the screenshot shows sign-off and Done too.
                width = max(1600, 300 * len(board["columns"]) + 80)
                common = [chrome, "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
                          f"--user-data-dir={profile}", "--virtual-time-budget=6000", f"--window-size={width},1000"]
                url = f"http://localhost:{port}/"
                try:
                    dom = subprocess.run(common + ["--dump-dom", url], capture_output=True, timeout=60).stdout.decode("utf-8", "replace")
                    cards = len(re.findall(r'<article class="card ', dom))
                    want = expected_cards(board)
                    check("browser renders the board", "board-title" in dom and "Loading board" not in dom, "page did not finish loading")
                    check(f"browser shows {want} cards", cards == want, f"rendered {cards}")
                    check("no error banner in browser", 'class="banner error"' not in dom or 'id="banner" class="banner error" hidden' in dom)
                    if args.screenshot:
                        shot = Path(args.screenshot).resolve()
                        shot.unlink(missing_ok=True)  # never mistake an old screenshot for this run's
                        shot.parent.mkdir(parents=True, exist_ok=True)
                        subprocess.run(common + [f"--screenshot={shot}", url], capture_output=True, timeout=60)
                        check("screenshot saved", shot.exists(), str(shot))
                except subprocess.TimeoutExpired:
                    check("browser renders the board", False, "headless Chrome timed out")
                run_ui_check(work, tmp, chrome, env, Path(args.screenshot).resolve().parent if args.screenshot else None)

        # With a (dead) HTTP proxy configured, as on many corporate machines: the
        # loopback check must not go through it.
        # IPv6 loopback binding, with --stop finding it.
        v6_data = tmp / "v6-data"
        shutil.copytree(work / "data", v6_data, ignore=shutil.ignore_patterns(".server.json"))
        v6port = free_port()
        v6 = subprocess.Popen([sys.executable, str(work / "server.py"), "--host", "::1", "--port", str(v6port),
                               "--data", str(v6_data)], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, env=env)
        for _ in range(50):
            if (v6_data / ".server.json").exists() or v6.poll() is not None:
                break
            time.sleep(0.1)
        if v6.poll() is not None and b"Could not listen" in (v6.stderr.read() or b""):
            skip("IPv6 loopback", "this machine has no IPv6 loopback")
        else:
            v6stop = subprocess.run([sys.executable, str(work / "server.py"), "--stop", "--data", str(v6_data)],
                                    capture_output=True, text=True, timeout=30)
            try:
                v6.wait(timeout=10)
            except subprocess.TimeoutExpired:
                v6.kill()
            check("server binds to ::1 and --stop finds it", v6stop.returncode == 0, v6stop.stdout + v6stop.stderr)

        # SIGTERM alone (as docker stop sends) must run the server's clean-up.
        sig_data = tmp / "sigterm-data"
        shutil.copytree(work / "data", sig_data, ignore=shutil.ignore_patterns(".server.json"))
        sport = free_port()
        sproc = subprocess.Popen([sys.executable, str(work / "server.py"), "--port", str(sport), "--data", str(sig_data)],
                                 stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=env)
        for _ in range(50):
            if (sig_data / ".server.json").exists():
                break
            time.sleep(0.1)
        sproc.terminate()
        try:
            sproc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            sproc.kill()
        check("SIGTERM shuts the server down cleanly and removes its record",
              sproc.returncode == 0 and not (sig_data / ".server.json").exists(), f"exit {sproc.returncode}")

        stop = subprocess.run([sys.executable, str(work / "server.py"), "--stop", "--data", str(work / "data")],
                              capture_output=True, text=True, timeout=30,
                              env={**{k: v for k, v in env.items() if k.lower() != "no_proxy"},
                                   "http_proxy": "http://127.0.0.1:9", "HTTP_PROXY": "http://127.0.0.1:9"})
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            pass
        check("server.py --stop stops exactly this server, even with a proxy set",
              stop.returncode == 0 and proc.poll() is not None and not (work / "data" / ".server.json").exists(),
              stop.stdout + stop.stderr)
    finally:
        if proc and proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
        shutil.rmtree(tmp, ignore_errors=True)

    failed = [n for n, ok in results if not ok]
    print(f"\n{len(results) - len(failed)} passed, {len(failed)} failed.")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
