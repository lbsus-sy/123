const express = require('express');
const path = require('path');
const store = require('./store');
const configGen = require('./config-generator');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;
const WEB_USER = process.env.WEB_USER || 'admin';
const WEB_PASS = process.env.WEB_PASS || 'admin123';

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Simple auth middleware
function auth(req, res, next) {
  // Skip auth for login endpoint
  if (req.path === '/api/login') return next();
  if (req.path === '/') return next();
  if (req.path.startsWith('/static/')) return next();

  const authHeader = req.headers.authorization;
  if (authHeader) {
    const token = authHeader.split(' ')[1];
    try {
      const decoded = Buffer.from(token, 'base64').toString();
      const [user, pass] = decoded.split(':');
      if (user === WEB_USER && pass === WEB_PASS) {
        return next();
      }
    } catch {}
  }
  res.status(401).json({ error: 'Unauthorized' });
}
app.use(auth);

// ==================== Auth ====================
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (username === WEB_USER && password === WEB_PASS) {
    const token = Buffer.from(`${WEB_USER}:${WEB_PASS}`).toString('base64');
    return res.json({ token, user: WEB_USER });
  }
  res.status(401).json({ error: 'Invalid credentials' });
});

// ==================== Settings ====================
app.get('/api/settings', (req, res) => {
  res.json(store.getSettings());
});

app.put('/api/settings', (req, res) => {
  store.updateSettings(req.body);
  res.json({ success: true });
});

// ==================== Inbounds ====================
app.get('/api/inbounds', (req, res) => {
  res.json(store.getInbounds());
});

app.get('/api/inbounds/:id', (req, res) => {
  const inbound = store.getInbound(req.params.id);
  if (!inbound) return res.status(404).json({ error: 'Not found' });
  res.json(inbound);
});

app.post('/api/inbounds', (req, res) => {
  const inbound = store.addInbound(req.body);
  res.json(inbound);
});

app.put('/api/inbounds/:id', (req, res) => {
  const inbound = store.updateInbound(req.params.id, req.body);
  if (!inbound) return res.status(404).json({ error: 'Not found' });
  res.json(inbound);
});

app.delete('/api/inbounds/:id', (req, res) => {
  const deleted = store.deleteInbound(req.params.id);
  if (!deleted) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true });
});

// ==================== Clients ====================
app.post('/api/inbounds/:id/clients', (req, res) => {
  const client = store.addClient(req.params.id, req.body);
  if (!client) return res.status(404).json({ error: 'Inbound not found' });
  res.json(client);
});

app.put('/api/inbounds/:inboundId/clients/:clientId', (req, res) => {
  const client = store.updateClient(req.params.inboundId, req.params.clientId, req.body);
  if (!client) return res.status(404).json({ error: 'Client or inbound not found' });
  res.json(client);
});

app.delete('/api/inbounds/:inboundId/clients/:clientId', (req, res) => {
  const deleted = store.deleteClient(req.params.inboundId, req.params.clientId);
  if (!deleted) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true });
});

// ==================== Config Export ====================
app.get('/api/config/export', (req, res) => {
  const inbounds = store.getInbounds();
  const ids = req.query.ids ? req.query.ids.split(',') : null;
  const selectedInbounds = ids
    ? inbounds.filter(i => ids.includes(i.id))
    : inbounds;
  const config = configGen.generateFullConfig(selectedInbounds);
  res.json(config);
});

app.get('/api/config/download', (req, res) => {
  const inbounds = store.getInbounds();
  const ids = req.query.ids ? req.query.ids.split(',') : null;
  const selectedInbounds = ids
    ? inbounds.filter(i => ids.includes(i.id))
    : inbounds;
  const config = configGen.generateFullConfig(selectedInbounds);
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', 'attachment; filename=xray-config.json');
  res.send(JSON.stringify(config, null, 2));
});

// ==================== Share Links ====================
app.get('/api/share/:inboundId/:clientId', (req, res) => {
  const inbound = store.getInbound(req.params.inboundId);
  if (!inbound) return res.status(404).json({ error: 'Inbound not found' });
  const client = inbound.clients.find(c => c.id === req.params.clientId);
  if (!client) return res.status(404).json({ error: 'Client not found' });
  const serverIp = req.query.server || inbound.serverNames?.[0] || 'localhost';
  const link = configGen.generateShareLink(inbound, client, serverIp);
  res.json({ link });
});

app.get('/api/share/all/:inboundId', (req, res) => {
  const inbound = store.getInbound(req.params.inboundId);
  if (!inbound) return res.status(404).json({ error: 'Inbound not found' });
  const serverIp = req.query.server || inbound.serverNames?.[0] || 'localhost';
  const links = inbound.clients.map(c => ({
    client: c.name || c.email,
    id: c.id,
    link: configGen.generateShareLink(inbound, c, serverIp)
  }));
  res.json({ links, remark: inbound.remark });
});

// ==================== Subscription ====================
app.get('/api/sub/:inboundId', (req, res) => {
  const inbound = store.getInbound(req.params.inboundId);
  if (!inbound || !inbound.enable) return res.status(404).send('Not found');
  const serverIp = req.query.server || inbound.serverNames?.[0] || 'localhost';
  const links = inbound.clients
    .filter(c => c.enable !== false)
    .map(c => configGen.generateShareLink(inbound, c, serverIp))
    .filter(Boolean)
    .join('\n');
  const encoded = Buffer.from(links).toString('base64');
  res.set('Content-Type', 'text/plain; charset=utf-8');
  res.send(encoded);
});

// ==================== Server Info ====================
app.get('/api/server/info', (req, res) => {
  const os = require('os');
  const uptime = os.uptime();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const cpus = os.cpus().length;
  const loadAvg = os.loadavg ? os.loadavg() : [0, 0, 0];

  const inbounds = store.getInbounds();
  const totalClients = inbounds.reduce((sum, i) => sum + i.clients.length, 0);

  res.json({
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    uptime: Math.floor(uptime / 3600) + 'h ' + Math.floor((uptime % 3600) / 60) + 'm',
    cpu: cpus + ' cores',
    load: loadAvg.slice(0, 3),
    memory: {
      total: (totalMem / 1024 / 1024 / 1024).toFixed(2) + ' GB',
      free: (freeMem / 1024 / 1024 / 1024).toFixed(2) + ' GB',
      used: ((totalMem - freeMem) / 1024 / 1024 / 1024).toFixed(2) + ' GB',
      percent: ((1 - freeMem / totalMem) * 100).toFixed(1) + '%'
    },
    inbounds: inbounds.length,
    clients: totalClients
  });
});

// ==================== Stats (mock) ====================
app.get('/api/stats', (req, res) => {
  const inbounds = store.getInbounds();
  const stats = {
    totalInbounds: inbounds.length,
    totalClients: inbounds.reduce((sum, i) => sum + i.clients.length, 0),
    enabledInbounds: inbounds.filter(i => i.enable !== false).length,
    uptime: Math.floor(require('os').uptime() / 3600) + 'h',
    inbounds: inbounds.map(i => ({
      id: i.id,
      remark: i.remark,
      protocol: i.protocol,
      port: i.port,
      transport: i.transport,
      security: i.security,
      clients: i.clients.length,
      up: i.up || 0,
      down: i.down || 0,
      enable: i.enable
    }))
  };
  res.json(stats);
});

// ==================== Serve Frontend ====================
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.use('/static', express.static(path.join(__dirname, 'public')));

// Start server
app.listen(PORT, () => {
  console.log(`╔══════════════════════════════════════════╗`);
  console.log(`║       Xray Panel v1.0.0                  ║`);
  console.log(`╠══════════════════════════════════════════╣`);
  console.log(`║  Panel: http://localhost:${PORT}          ║`);
  console.log(`║  User:  ${WEB_USER}                       ║`);
  console.log(`║  Pass:  ${WEB_PASS}                       ║`);
  console.log(`╚══════════════════════════════════════════╝`);
});