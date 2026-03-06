import http.server
import socketserver
import webbrowser
import os

PORT = 3000

os.chdir(os.path.dirname(os.path.abspath(__file__)))

Handler = http.server.SimpleHTTPRequestHandler
Handler.extensions_map.update({
    '.js': 'application/javascript',
})

with socketserver.TCPServer(("", PORT), Handler) as httpd:
    print(f"Servidor corriendo en http://localhost:{PORT}")
    print("Presiona Ctrl+C para detener")
    webbrowser.open(f'http://localhost:{PORT}')
    httpd.serve_forever()
