import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = 8000;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEMO_ROOT = __dirname;
const PROJECT_ROOT = path.resolve(__dirname, '..');

const mimeTypes = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.mjs': 'application/javascript',
    '.json': 'application/json'
};

http.createServer((req, res) => {
    const urlPath = (req.url || '/').split('?')[0];
    let filePath;

    if (urlPath === '/') {
        filePath = path.join(DEMO_ROOT, 'index.html');
    } else if (urlPath.startsWith('/dist/')) {
        filePath = path.join(PROJECT_ROOT, urlPath);
    } else {
        filePath = path.join(DEMO_ROOT, urlPath);
    }
    
    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404);
            res.end('404 Not Found');
            return;
        }
        const ext = path.extname(filePath);
        res.writeHead(200, {
            'Content-Type': mimeTypes[ext] || 'text/plain',
            'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
            'Pragma': 'no-cache',
            'Expires': '0',
        });
        res.end(data);
    });
}).listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
    console.log('Presiona Ctrl+C para detener');
});
