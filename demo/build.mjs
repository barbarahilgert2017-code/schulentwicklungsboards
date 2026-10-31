// Baut den Klick-Dummy nach dist/klickdummy: echte Oberfläche + simulierte API.
//   node demo/build.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist', 'klickdummy');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'demo'), { recursive: true });
fs.cpSync(path.join(root, 'public', 'js'), path.join(out, 'js'), { recursive: true });
fs.cpSync(path.join(root, 'public', 'css'), path.join(out, 'css'), { recursive: true });
fs.copyFileSync(path.join(root, 'public', 'favicon.svg'), path.join(out, 'favicon.svg'));
fs.copyFileSync(path.join(root, 'server', 'templates.js'), path.join(out, 'js', 'templates.js'));
for (const f of ['mock-api.js', 'demo-ui.js', 'demo.css']) fs.copyFileSync(path.join(root, 'demo', f), path.join(out, 'demo', f));
const page = fs.readFileSync(path.join(root, 'demo', 'page.html'), 'utf8');
// index.html = Seiteninhalt (wird beim Veröffentlichen als Artifact in ein HTML-Gerüst gesetzt)
fs.writeFileSync(path.join(out, 'index.html'), page);
// standalone.html = eigenständig im Browser oder über einen beliebigen Webserver nutzbar
fs.writeFileSync(path.join(out, 'standalone.html'), `<!doctype html>\n<html lang="de">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n</head>\n<body>\n${page}</body>\n</html>\n`);
console.log(`Klick-Dummy gebaut: ${path.relative(root, out)}/`);
