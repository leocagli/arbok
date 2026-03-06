import http.server
import os
import socketserver
import webbrowser

PORT = int(os.environ.get("PORT", "8010"))
DEMO_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.abspath(os.path.join(DEMO_DIR, ".."))


class ReusableTCPServer(socketserver.TCPServer):
    allow_reuse_address = True

class DemoHandler(http.server.SimpleHTTPRequestHandler):
    extensions_map = http.server.SimpleHTTPRequestHandler.extensions_map.copy()
    extensions_map.update({
        ".js": "application/javascript",
        ".mjs": "application/javascript",
    })

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=PROJECT_ROOT, **kwargs)

with ReusableTCPServer(("", PORT), DemoHandler) as httpd:
    url = f"http://localhost:{PORT}/demo/"
    print(f"Servidor corriendo en {url}")
    print("Presiona Ctrl+C para detener")
    webbrowser.open(url)
    httpd.serve_forever()
