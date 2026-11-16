#!/usr/bin/env python3
"""Tiny static server for CampusConnect.

Serves this folder and maps the friendly paths below onto the real pages —
every page runs against Firebase, so signing in is required as usual. Any
other path serves normally (/clubs.html, /events.html, /Dashboard.html, ...).

    /clubs              -> /clubs.html
    /clubs-admin        -> /clubs.html
    /events             -> /events.html
    /events-admin       -> /events.html
    /                   -> /index.html

    python3 preview-server.py [port]      # default 8000
"""

import http.server
import os
import socketserver
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
ROOT = os.path.dirname(os.path.abspath(__file__))


ROUTES = {
    "/": "/index.html",
    "/clubs": "/clubs.html",
    "/clubs-admin": "/clubs.html",
    "/events": "/events.html",
    "/events-admin": "/events.html",
    "/certificates": "/certificates.html",
    "/credits": "/certificates.html",
    "/settings": "/settings.html",
}


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def do_GET(self):
        clean = self.path.split("?")[0].rstrip("/") or "/"
        if clean in ROUTES:
            self.path = ROUTES[clean]
        super().do_GET()

    def end_headers(self):
        # never cache during preview so edits show up instantly
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == "__main__":
    with Server(("0.0.0.0", PORT), Handler) as httpd:
        print(f"CampusConnect → http://localhost:{PORT}/")
        httpd.serve_forever()
