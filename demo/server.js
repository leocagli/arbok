const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8000;
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
    const urlPath = req.url.split('?')[0];
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
        res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain' });
        res.end(data);
    });
}).listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
    console.log('Presiona Ctrl+C para detener');
});
