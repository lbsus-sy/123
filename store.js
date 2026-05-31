const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DATA_DIR = path.join(__dirname, 'data');
const INBOUNDS_FILE = path.join(DATA_DIR, 'inbounds.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Initialize files if they don't exist
if (!fs.existsSync(INBOUNDS_FILE)) {
  fs.writeFileSync(INBOUNDS_FILE, JSON.stringify([], null, 2));
}
if (!fs.existsSync(SETTINGS_FILE)) {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify({
    port: 3000,
    webPath: '/',
    webUser: 'admin',
    webPass: 'admin123'
  }, null, 2));
}

function readJSON(filePath) {
  try {
    const data = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(data);
  } catch {
    return [];
  }
}

function writeJSON(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

// Client schema
function createClient(name, email, enable = true, tgId = '', subId = '', flow = '') {
  return {
    id: uuidv4(),
    clientId: uuidv4(),
    email,
    name,
    enable,
    tgId,
    subId,
    flow,
    expiryTime: 0,
    totalGB: 0,
    up: 0,
    down: 0,
    enable: true
  };
}

// Inbound schema
function createInbound({
  remark = 'New Inbound',
  port = 443,
  protocol = 'vless',
  listen = '0.0.0.0',
  // TLS settings
  security = 'none',
  sni = '',
  certificateFile = '',
  keyFile = '',
  // Reality settings
  serverNames = ['google.com'],
  privateKey = '',
  shortIds = ['6ba85179e30d4fc2'],
  dest = '',
  // Transport settings
  transport = 'tcp',
  path = '/',
  host = '',
  serviceName = '',
  // gRPC
  grpcMode = 'gun',
  // General
  clients = [],
  sniffing = true,
  allocateStrategy = 'always',
  allocateRefresh = 5,
  allocateConcurrency = 3
} = {}) {
  return {
    id: uuidv4(),
    remark,
    port: parseInt(port),
    protocol,
    listen,
    // Security
    security,
    // TLS
    sni,
    certificateFile,
    keyFile,
    // Reality
    serverNames: typeof serverNames === 'string' ? [serverNames] : serverNames,
    privateKey,
    shortIds: typeof shortIds === 'string' ? [shortIds] : shortIds,
    dest,
    // Transport
    transport,
    path,
    host,
    serviceName,
    // gRPC
    grpcMode,
    // Clients
    clients,
    // Advanced
    sniffing,
    allocate: {
      strategy: allocateStrategy,
      refresh: parseInt(allocateRefresh),
      concurrency: parseInt(allocateConcurrency)
    },
    up: 0,
    down: 0,
    enable: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

module.exports = {
  // Inbounds CRUD
  getInbounds() {
    return readJSON(INBOUNDS_FILE);
  },

  getInbound(id) {
    const inbounds = this.getInbounds();
    return inbounds.find(i => i.id === id) || null;
  },

  addInbound(data) {
    const inbounds = this.getInbounds();
    const inbound = createInbound(data);
    inbound.clients.push(createClient('default', 'default@example.com'));
    inbounds.push(inbound);
    writeJSON(INBOUNDS_FILE, inbounds);
    return inbound;
  },

  updateInbound(id, data) {
    const inbounds = this.getInbounds();
    const index = inbounds.findIndex(i => i.id === id);
    if (index === -1) return null;
    inbounds[index] = { ...inbounds[index], ...data, updatedAt: new Date().toISOString() };
    writeJSON(INBOUNDS_FILE, inbounds);
    return inbounds[index];
  },

  deleteInbound(id) {
    const inbounds = this.getInbounds();
    const filtered = inbounds.filter(i => i.id !== id);
    if (filtered.length === inbounds.length) return false;
    writeJSON(INBOUNDS_FILE, filtered);
    return true;
  },

  // Client management
  addClient(inboundId, clientData) {
    const inbounds = this.getInbounds();
    const inbound = inbounds.find(i => i.id === inboundId);
    if (!inbound) return null;
    const client = createClient(
      clientData.name,
      clientData.email,
      clientData.enable !== false,
      clientData.tgId || '',
      clientData.subId || '',
      clientData.flow || ''
    );
    inbound.clients.push(client);
    inbound.updatedAt = new Date().toISOString();
    writeJSON(INBOUNDS_FILE, inbounds);
    return client;
  },

  updateClient(inboundId, clientId, data) {
    const inbounds = this.getInbounds();
    const inbound = inbounds.find(i => i.id === inboundId);
    if (!inbound) return null;
    const client = inbound.clients.find(c => c.id === clientId);
    if (!client) return null;
    Object.assign(client, data);
    inbound.updatedAt = new Date().toISOString();
    writeJSON(INBOUNDS_FILE, inbounds);
    return client;
  },

  deleteClient(inboundId, clientId) {
    const inbounds = this.getInbounds();
    const inbound = inbounds.find(i => i.id === inboundId);
    if (!inbound) return false;
    const before = inbound.clients.length;
    inbound.clients = inbound.clients.filter(c => c.id !== clientId);
    if (before === inbound.clients.length) return false;
    inbound.updatedAt = new Date().toISOString();
    writeJSON(INBOUNDS_FILE, inbounds);
    return true;
  },

  // Settings
  getSettings() {
    return readJSON(SETTINGS_FILE);
  },

  updateSettings(data) {
    const settings = this.getSettings();
    Object.assign(settings, data);
    writeJSON(SETTINGS_FILE, settings);
    return settings;
  },

  // Helper
  createInbound,
  createClient,

  // Export all inbounds as xray JSON config
  exportConfig(inboundIds) {
    const inbounds = inboundIds
      ? this.getInbounds().filter(i => inboundIds.includes(i.id))
      : this.getInbounds();
    return inbounds;
  }
};