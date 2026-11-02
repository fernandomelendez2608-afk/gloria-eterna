'use strict';
// Servidor de Gloria Eterna — solo Node.js, sin dependencias.
// Estado por SSE (servidor -> navegador) y POST (navegador -> servidor).
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { Game } = require('./game');

const PORT = parseInt(process.env.PORT, 10) || 3000;
const game = new Game();
const streams = new Map(); // playerId -> Set(res)

function playerByToken(t) { return t ? game.players.find(p => p.token === t) : null; }

function broadcast() {
  for (const p of game.players) {
    const set = streams.get(p.id); if (!set || !set.size) continue;
    const data = 'data: ' + JSON.stringify(game.viewFor(p.id)) + '\n\n';
    for (const res of set) res.write(data);
  }
}

function readBody(req) {
  return new Promise((resolve) => {
    let b = ''; req.on('data', c => { b += c; if (b.length > 1e5) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch { resolve({}); } });
  });
}
function json(res, code, obj) { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); }

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');

  if (url.pathname === '/api/cfg') return json(res, 200, game.config());

  if (url.pathname === '/api/info') {
    const addrs = [];
    for (const list of Object.values(os.networkInterfaces())) for (const i of list || []) if (i.family === 'IPv4' && !i.internal) addrs.push('http://' + i.address + ':' + PORT);
    return json(res, 200, { addresses: addrs, phase: game.phase });
  }

  if (url.pathname === '/api/join' && req.method === 'POST') {
    const b = await readBody(req);
    let p = playerByToken(b.token);
    if (!p) {
      const r = game.addPlayer(b.name, false);
      if (r.error) return json(res, 400, r);
      p = r.player;
    } else if (b.name && game.phase === 'lobby') p.name = String(b.name).slice(0, 16);
    json(res, 200, { token: p.token, id: p.id });
    return broadcast();
  }

  if (url.pathname === '/api/events') {
    const p = playerByToken(url.searchParams.get('token'));
    if (!p) { res.writeHead(401); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    let set = streams.get(p.id); if (!set) { set = new Set(); streams.set(p.id, set); }
    set.add(res); p.connected = true;
    res.write('retry: 2000\n\n');
    res.write('data: ' + JSON.stringify(game.viewFor(p.id)) + '\n\n');
    const ping = setInterval(() => res.write(': ping\n\n'), 20000);
    req.on('close', () => {
      clearInterval(ping); set.delete(res);
      if (!set.size) { p.connected = false; game.checkAllEnded(); }
      broadcast();
    });
    game.checkAllEnded(); broadcast();
    return;
  }

  if (url.pathname === '/api/act' && req.method === 'POST') {
    const b = await readBody(req); const p = playerByToken(b.token);
    if (!p) return json(res, 401, { error: 'Sesión no válida. Recarga la página.' });
    const r = game.act(p.id, b);
    json(res, r.error ? 400 : 200, r.error ? { error: r.error } : { ok: true });
    return broadcast();
  }

  if (url.pathname === '/api/query' && req.method === 'POST') {
    const b = await readBody(req); const p = playerByToken(b.token);
    if (!p) return json(res, 401, { error: 'Sesión no válida.' });
    return json(res, 200, game.query(p.id, b.unitId));
  }

  if (url.pathname === '/api/ping') return json(res, 200, { ok: true, phase: game.phase });

  // estático: solo la página del juego (todo plano, fácil de subir desde el móvil)
  if (url.pathname === '/' || url.pathname === '/index.html') {
    return fs.readFile(path.join(__dirname, 'index.html'), (e, data) => {
      if (e) { res.writeHead(500); return res.end('Falta index.html'); }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(data);
    });
  }
  res.writeHead(404); res.end('No encontrado');
});

if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log('\n  GLORIA ETERNA — servidor listo\n');
    console.log('  En este ordenador:  http://localhost:' + PORT);
    for (const list of Object.values(os.networkInterfaces())) for (const i of list || []) if (i.family === 'IPv4' && !i.internal) console.log('  En tu red local:    http://' + i.address + ':' + PORT);
    console.log('\n  Comparte la dirección de red local con tus amigos (misma wifi),');
    console.log('  o usa un túnel (ver LEEME.md) para jugar por internet.\n');
  });
}
module.exports = { server, game };
