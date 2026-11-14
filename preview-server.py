#!/usr/bin/env python3
"""Tiny static preview server for the Student Records page.

Serves this folder and maps "/" to profile-demo.html so the live preview opens
on the new student-profile flow. Any other path serves normally
(/students.html, /directory-demo.html, /Dashboard.html, ...).

    python3 preview-server.py [port]      # default 8000
"""

import http.server
import os
import socketserver
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
ROOT = os.path.dirname(os.path.abspath(__file__))


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def do_GET(self):
        if self.path in ("/", "/index.html", ""):
            self.path = "/profile-demo.html"
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
        print(f"CampusConnect preview → http://localhost:{PORT}/ (maps to students.html)")
        httpd.serve_forever()
