#!/usr/bin/env python3
"""Tiny static preview server for CampusConnect.

Serves this folder and maps the friendly paths below to the built-in preview
mode (?demo=1), so the new Clubs / Events layouts can be reviewed without
signing in. Any other path serves normally
(/clubs.html, /events.html, /Dashboard.html, /profile-demo.html, ...).

    /clubs              -> /clubs.html?demo=1            (student view)
    /clubs/admin        -> /clubs.html?demo=1&role=admin (admin view)
    /events             -> /events.html?demo=1           (student view)
    /events/admin       -> /events.html?demo=1&role=admin(admin view)
    /                   -> /clubs.html?demo=1

    python3 preview-server.py [port]      # default 8000
"""

import http.server
import os
import socketserver
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
ROOT = os.path.dirname(os.path.abspath(__file__))


ROUTES = {
    "/": "/clubs.html?demo=1",
    "/clubs": "/clubs.html?demo=1",
    "/clubs-admin": "/clubs.html?demo=1&role=admin",
    "/events": "/events.html?demo=1",
    "/events-admin": "/events.html?demo=1&role=admin",
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
        print(f"CampusConnect preview → http://localhost:{PORT}/ (clubs preview mode)")
        httpd.serve_forever()
