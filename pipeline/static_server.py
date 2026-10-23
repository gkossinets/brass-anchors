#!/usr/bin/env python3
"""Static file server for web/ that honours HTTP Range requests.

Python's built-in http.server ignores Range and always sends the whole file,
and browsers can't seek in <audio> without 206 responses: scrubbing snaps
back to the start.
"""

import argparse
import io
import os
import re
import sys
from functools import partial
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

from pipeline.config import WEB_DIR

RANGE = re.compile(r"^bytes=(\d*)-(\d*)$")


class RangeRequestHandler(SimpleHTTPRequestHandler):
    """SimpleHTTPRequestHandler plus single-range `bytes=a-b` support."""

    def end_headers(self) -> None:
        self.send_header("Accept-Ranges", "bytes")
        # Without this, browsers may reuse a cached script against a newer page after
        # an edit; no-cache revalidates each load (a cheap 304 when nothing changed).
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def send_head(self):  # noqa: ANN201 - mirrors the base class signature
        match = RANGE.match(self.headers.get("Range", "").strip())
        path = self.translate_path(self.path)
        if not match or not os.path.isfile(path):
            return super().send_head()
        size = os.path.getsize(path)
        first, last = match.groups()
        if first:
            start, end = int(first), min(int(last), size - 1) if last else size - 1
        elif last:  # suffix range: the final N bytes
            start, end = max(0, size - int(last)), size - 1
        else:
            start, end = 0, size - 1
        if start > end or start >= size:
            self.send_response(HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
            self.send_header("Content-Range", f"bytes */{size}")
            self.end_headers()
            return None
        with open(path, "rb") as f:
            f.seek(start)
            body = f.read(end - start + 1)
        self.send_response(HTTPStatus.PARTIAL_CONTENT)
        self.send_header("Content-Type", self.guess_type(path))
        self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Last-Modified", self.date_time_string(int(os.path.getmtime(path))))
        self.end_headers()
        return io.BytesIO(body)


def main() -> int:
    """Serve web/ (the game) until interrupted."""
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("-p", "--port", type=int, default=8000)
    args = parser.parse_args()
    try:
        httpd = ThreadingHTTPServer(("127.0.0.1", args.port), partial(RangeRequestHandler, directory=str(WEB_DIR)))
    except OSError as err:
        print(f"Can't serve on port {args.port}: {err.strerror}. Is another server already running there? "
              f"Stop it, or use another port (make serve PORT={args.port + 1}).", file=sys.stderr)
        return 1
    print(f"Game: http://localhost:{args.port}/  (Ctrl-C to stop)", file=sys.stderr)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
