const express = require("express");
const app = express();
const axios = require("axios");
const os = require('os');
const fs = require("fs");
const path = require("path");
const { promisify } = require('util');
const exec = promisify(require('child_process').exec);

// ==================== 環境變數 ====================
const UPLOAD_URL = process.env.UPLOAD_URL || '';
const PROJECT_URL = process.env.PROJECT_URL || '';
const AUTO_ACCESS = process.env.AUTO_ACCESS || false;
const FILE_PATH = process.env.FILE_PATH || '.tmp';
const SUB_PATH = process.env.SUB_PATH || 'sub';
const PORT = process.env.SERVER_PORT || process.env.PORT || 3000;
const UUID = process.env.UUID || '7f43b574-8466-406a-94dd-e418f36eae31';
const NEZHA_SERVER = process.env.NEZHA_SERVER || '';
const NEZHA_PORT = process.env.NEZHA_PORT || '';
const NEZHA_KEY = process.env.NEZHA_KEY || '';
const ARGO_DOMAIN = process.env.ARGO_DOMAIN || '';
const ARGO_AUTH = process.env.ARGO_AUTH || '';
const ARGO_PORT = process.env.ARGO_PORT || 8510;
const CFIP = process.env.CFIP ? JSON.parse(process.env.CFIP) : [["172.64.145.13", 443], ["104.20.17.244", 443]];
const NAME = process.env.NAME || '';
const WEB_USER = process.env.WEB_USER || 'admin';
const WEB_PASS = process.env.WEB_PASS || 'admin123';

// ==================== 工具函數 ====================
function generateRandomName() {
  const chars = 'abcdefghijklmnopqrstuvwxyz';
  let result = '';
  for (let i = 0; i < 6; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
  return result;
}

function getSystemArchitecture() {
  const arch = os.arch();
  if (arch === 'arm' || arch === 'arm64' || arch === 'aarch64') return 'arm';
  return 'amd';
}

// ==================== 全域變數 ====================
const npmName = generateRandomName();
const webName = generateRandomName();
const botName = generateRandomName();
const phpName = generateRandomName();
let npmPath = path.join(FILE_PATH, npmName);
let phpPath = path.join(FILE_PATH, phpName);
let webPath = path.join(FILE_PATH, webName);
let botPath = path.join(FILE_PATH, botName);
let subPath = path.join(FILE_PATH, 'sub.txt');
let listPath = path.join(FILE_PATH, 'list.txt');
let bootLogPath = path.join(FILE_PATH, 'boot.log');
let configPath = path.join(FILE_PATH, 'config.json');
let subTxtCache = '';
let runningStatus = { xray: false, cloudflared: false, nezha: false };
let currentArgoDomain = ARGO_DOMAIN || '';
let currentIP = '';
let currentISP = 'Unknown';

// 創建運行資料夾
if (!fs.existsSync(FILE_PATH)) fs.mkdirSync(FILE_PATH, { recursive: true });

// ==================== 生成 xray 配置 ====================
async function generateXrayConfig() {
  const config = {
    log: { access: '/dev/null', error: '/dev/null', loglevel: 'none' },
    inbounds: [
      { port: parseInt(ARGO_PORT), protocol: 'vless', settings: { clients: [{ id: UUID, flow: 'xtls-rprx-vision' }], decryption: 'none', fallbacks: [{ dest: 3001 }, { path: "/vless-argo", dest: 3002 }, { path: "/vmess-argo", dest: 3003 }, { path: "/trojan-argo", dest: 3004 }] }, streamSettings: { network: 'tcp' } },
      { port: 3001, listen: "127.0.0.1", protocol: "vless", settings: { clients: [{ id: UUID }], decryption: "none" }, streamSettings: { network: "tcp", security: "none" } },
      { port: 3002, listen: "127.0.0.1", protocol: "vless", settings: { clients: [{ id: UUID, level: 0 }], decryption: "none" }, streamSettings: { network: "ws", security: "none", wsSettings: { path: "/vless-argo" } }, sniffing: { enabled: true, destOverride: ["http", "tls", "quic"], metadataOnly: false } },
      { port: 3003, listen: "127.0.0.1", protocol: "vmess", settings: { clients: [{ id: UUID, alterId: 0 }] }, streamSettings: { network: "ws", wsSettings: { path: "/vmess-argo" } }, sniffing: { enabled: true, destOverride: ["http", "tls", "quic"], metadataOnly: false } },
      { port: 3004, listen: "127.0.0.1", protocol: "trojan", settings: { clients: [{ password: UUID }] }, streamSettings: { network: "ws", security: "none", wsSettings: { path: "/trojan-argo" } }, sniffing: { enabled: true, destOverride: ["http", "tls", "quic"], metadataOnly: false } },
    ],
    dns: { servers: ["https+local://8.8.8.8/dns-query"] },
    outbounds: [{ protocol: "freedom", tag: "direct" }, { protocol: "blackhole", tag: "block" }]
  };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  console.log('xray config generated');
}

// ==================== 下載檔案 ====================
function downloadFile(fileName, fileUrl) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(FILE_PATH)) fs.mkdirSync(FILE_PATH, { recursive: true });
    const writer = fs.createWriteStream(fileName);
    axios({ method: 'get', url: fileUrl, responseType: 'stream' })
      .then(response => {
        response.data.pipe(writer);
        writer.on('finish', () => { writer.close(); console.log(`Downloaded ${path.basename(fileName)}`); resolve(fileName); });
        writer.on('error', err => { fs.unlink(fileName, () => {}); reject(err.message); });
      })
      .catch(err => reject(err.message));
  });
}

function getFilesForArchitecture(architecture) {
  let baseFiles = architecture === 'arm'
    ? [{ fileName: webPath, fileUrl: "https://arm64.ssss.nyc.mn/web" }, { fileName: botPath, fileUrl: "https://arm64.ssss.nyc.mn/bot" }]
    : [{ fileName: webPath, fileUrl: "https://amd64.ssss.nyc.mn/web" }, { fileName: botPath, fileUrl: "https://amd64.ssss.nyc.mn/bot" }];

  if (NEZHA_SERVER && NEZHA_KEY) {
    const url = architecture === 'arm'
      ? (NEZHA_PORT ? "https://arm64.ssss.nyc.mn/agent" : "https://arm64.ssss.nyc.mn/v1")
      : (NEZHA_PORT ? "https://amd64.ssss.nyc.mn/agent" : "https://amd64.ssss.nyc.mn/v1");
    const p = NEZHA_PORT ? npmPath : phpPath;
    baseFiles.unshift({ fileName: p, fileUrl: url });
  }
  return baseFiles;
}

// ==================== 下載並運行 ====================
async function downloadAndRun() {
  const arch = getSystemArchitecture();
  const files = getFilesForArchitecture(arch);
  try { await Promise.all(files.map(f => downloadFile(f.fileName, f.fileUrl))); }
  catch (err) { console.error('Download error:', err); return; }

  files.forEach(f => { if (fs.existsSync(f.fileName)) fs.chmodSync(f.fileName, 0o775); });

  // 運行哪吒
  if (NEZHA_SERVER && NEZHA_KEY) {
    if (!NEZHA_PORT) {
      const port = NEZHA_SERVER.includes(':') ? NEZHA_SERVER.split(':').pop() : '';
      const tlsPorts = new Set(['443', '8443', '2096', '2087', '2083', '2053']);
      const nezhatls = tlsPorts.has(port) ? 'true' : 'false';
      const yaml = `client_secret: ${NEZHA_KEY}\ndebug: false\ndisable_auto_update: true\ndisable_command_execute: false\ndisable_force_update: true\ndisable_nat: false\ndisable_send_query: false\ngpu: false\ninsecure_tls: true\nip_report_period: 1800\nreport_delay: 4\nserver: ${NEZHA_SERVER}\nskip_connection_count: true\nskip_procs_count: true\ntemperature: false\ntls: ${nezhatls}\nuse_gitee_to_upgrade: false\nuse_ipv6_country_code: false\nuuid: ${UUID}`;
      fs.writeFileSync(path.join(FILE_PATH, 'config.yaml'), yaml);
      try { await exec(`nohup ${phpPath} -c "${FILE_PATH}/config.yaml" >/dev/null 2>&1 &`); console.log('nezha v1 running'); runningStatus.nezha = true; } catch (e) { console.error('nezha error:', e.message); }
    } else {
      const tls = ['443', '8443', '2096', '2087', '2083', '2053'].includes(NEZHA_PORT) ? '--tls' : '';
      try { await exec(`nohup ${npmPath} -s ${NEZHA_SERVER}:${NEZHA_PORT} -p ${NEZHA_KEY} ${tls} --disable-auto-update --report-delay 4 --skip-conn --skip-procs >/dev/null 2>&1 &`); console.log('nezha v0 running'); runningStatus.nezha = true; } catch (e) { console.error('nezha error:', e.message); }
    }
  }

  // 運行 xray
  try {
    await exec(`nohup ${webPath} -c ${configPath} >/dev/null 2>&1 &`);
    console.log('xray running');
    runningStatus.xray = true;
    await new Promise(r => setTimeout(r, 1000));
  } catch (e) { console.error('xray error:', e.message); }

  // 運行 cloudflared
  if (fs.existsSync(botPath)) {
    let args;
    if (ARGO_AUTH && ARGO_AUTH.match(/^[A-Z0-9a-z=]{120,250}$/)) {
      args = `tunnel --edge-ip-version auto --no-autoupdate --protocol http2 run --token ${ARGO_AUTH}`;
    } else if (ARGO_AUTH && ARGO_AUTH.match(/TunnelSecret/)) {
      const tunnelJson = ARGO_AUTH;
      fs.writeFileSync(path.join(FILE_PATH, 'tunnel.json'), tunnelJson);
      const tunnelYaml = `tunnel: ${ARGO_AUTH.split('"')[11]}\ncredentials-file: ${path.join(FILE_PATH, 'tunnel.json')}\nprotocol: http2\ningress:\n  - hostname: ${ARGO_DOMAIN}\n    service: http://localhost:${ARGO_PORT}\n    originRequest:\n      noTLSVerify: true\n  - service: http_status:404`;
      fs.writeFileSync(path.join(FILE_PATH, 'tunnel.yml'), tunnelYaml);
      args = `tunnel --edge-ip-version auto --config ${FILE_PATH}/tunnel.yml run`;
    } else {
      args = `tunnel --edge-ip-version auto --no-autoupdate --protocol http2 --logfile ${bootLogPath} --loglevel info --url http://localhost:${ARGO_PORT}`;
    }
    try {
      await exec(`nohup ${botPath} ${args} >/dev/null 2>&1 &`);
      console.log('cloudflared running');
      runningStatus.cloudflared = true;
      await new Promise(r => setTimeout(r, 2000));
    } catch (e) { console.error('cloudflared error:', e.message); }
  }
  await new Promise(r => setTimeout(r, 5000));
}

// ==================== 獲取 Argo Domain ====================
async function extractDomain() {
  if (ARGO_DOMAIN) {
    currentArgoDomain = ARGO_DOMAIN;
    console.log('ARGO_DOMAIN:', currentArgoDomain);
    await generateLinks(currentArgoDomain);
    return;
  }
  try {
    if (!fs.existsSync(bootLogPath)) { console.log('boot.log not found yet'); return; }
    const content = fs.readFileSync(bootLogPath, 'utf-8');
    const match = content.match(/https?:\/\/([^ ]*trycloudflare\.com)\/?/);
    if (match) {
      currentArgoDomain = match[1];
      console.log('ArgoDomain:', currentArgoDomain);
      await generateLinks(currentArgoDomain);
    } else {
      console.log('ArgoDomain not found yet, will retry...');
    }
  } catch (e) { console.error('extractDomain error:', e.message); }
}

// ==================== 獲取 IP/ISP ====================
async function getMetaInfo() {
  try {
    const r = await axios.get('https://api.ip.sb/geoip', { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 5000 });
    if (r.data && r.data.ip) currentIP = r.data.ip;
    if (r.data && r.data.country_code && r.data.isp) return `${r.data.country_code}-${r.data.isp}`.replace(/\s+/g, '_');
  } catch (e) {
    try {
      const r2 = await axios.get('http://ip-api.com/json', { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 5000 });
      if (r2.data && r2.data.query) currentIP = r2.data.query;
      if (r2.data && r2.data.status === 'success' && r2.data.countryCode && r2.data.org) return `${r2.data.countryCode}-${r2.data.org}`.replace(/\s+/g, '_');
    } catch (e2) {}
  }
  return 'Unknown';
}

// ==================== 生成節點連結 ====================
async function generateLinks(argoDomain) {
  currentISP = await getMetaInfo();
  const nodeName = NAME ? `${NAME}-${currentISP}` : currentISP;
  await new Promise(resolve => setTimeout(async () => {
    let subTxt = '';
    CFIP.forEach(entry => {
      const cfip = entry[0];
      const cfport = entry[1];
      const vmess = { v: '2', ps: nodeName, add: cfip, port: cfport, id: UUID, aid: '0', scy: 'auto', net: 'ws', type: 'none', host: argoDomain, path: '/vmess-argo?ed=2560', tls: 'tls', sni: argoDomain, alpn: '', fp: 'firefox' };
      subTxt += `vless://${UUID}@${cfip}:${cfport}?encryption=none&security=tls&sni=${argoDomain}&fp=firefox&type=ws&host=${argoDomain}&path=%2Fvless-argo%3Fed%3D2560#${nodeName}\n\nvmess://${Buffer.from(JSON.stringify(vmess)).toString('base64')}\n\ntrojan://${UUID}@${cfip}:${cfport}?security=tls&sni=${argoDomain}&fp=firefox&type=ws&host=${argoDomain}&path=%2Ftrojan-argo%3Fed%3D2560#${nodeName}\n`;
    });
    subTxtCache = subTxt;
    const encoded = Buffer.from(subTxt).toString('base64');
    console.log(encoded);
    fs.writeFileSync(subPath, encoded);
    console.log('sub.txt saved');
    resolve();
  }, 2000));
}

// ==================== 註冊訂閱路由 ====================
function setupSubRoute() {
  app.get(`/${SUB_PATH}`, (req, res) => {
    if (subTxtCache) {
      res.set('Content-Type', 'text/plain; charset=utf-8');
      res.send(Buffer.from(subTxtCache).toString('base64'));
    } else if (fs.existsSync(subPath)) {
      res.send(fs.readFileSync(subPath, 'utf-8'));
    } else {
      res.status(404).send('No nodes available yet');
    }
  });
}

// ==================== 啟動 ====================
async function startServer() {
  console.log('Starting Xray Panel with Argo tunnel...');
  await generateXrayConfig();
  await downloadAndRun();
  // 持續嘗試獲取 Argo domain
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 3000));
    await extractDomain();
    if (currentArgoDomain && currentArgoDomain !== ARGO_DOMAIN) break;
  }
  if (!currentIP) { const info = await getMetaInfo(); currentISP = info; }
  console.log('Server initialization complete');
  console.log('Argo Domain:', currentArgoDomain);
  console.log('IP:', currentIP);
  setupSubRoute();
}

startServer().catch(e => console.error('Startup error:', e));

// ==================== Auth Middleware ====================
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
function auth(req, res, next) {
  if (req.path === '/api/login') return next();
  if (req.path === '/' || req.path.startsWith('/static/')) return next();
  if (req.path === `/${SUB_PATH}`) return next();
  const h = req.headers.authorization;
  if (h) {
    try {
      const [u, p] = Buffer.from(h.split(' ')[1], 'base64').toString().split(':');
      if (u === WEB_USER && p === WEB_PASS) return next();
    } catch {}
  }
  res.status(401).json({ error: 'Unauthorized' });
}
app.use(auth);

// ==================== API Routes ====================
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (username === WEB_USER && password === WEB_PASS) {
    return res.json({ token: Buffer.from(`${WEB_USER}:${WEB_PASS}`).toString('base64'), user: WEB_USER });
  }
  res.status(401).json({ error: 'Invalid credentials' });
});

app.get('/api/status', (req, res) => {
  res.json({
    running: runningStatus,
    argoDomain: currentArgoDomain || '',
    ip: currentIP,
    isp: currentISP,
    port: PORT,
    subPath: SUB_PATH,
    uuid: UUID,
    cfip: CFIP,
    nodeName: NAME || currentISP
  });
});

app.get('/api/nodes', (req, res) => {
  try {
    if (subTxtCache) {
      const nodes = subTxtCache.split('\n').filter(l => /(vless|vmess|trojan|hysteria2|tuic):\/\//.test(l));
      return res.json({ nodes, raw: subTxtCache });
    }
    if (fs.existsSync(subPath)) {
      const decoded = Buffer.from(fs.readFileSync(subPath, 'utf-8'), 'base64').toString('utf-8');
      const nodes = decoded.split('\n').filter(l => /(vless|vmess|trojan|hysteria2|tuic):\/\//.test(l));
      return res.json({ nodes, raw: decoded });
    }
    res.json({ nodes: [], raw: '' });
  } catch (e) {
    res.json({ nodes: [], raw: '' });
  }
});

app.get('/api/restart', async (req, res) => {
  res.json({ message: 'Restart initiated (re-deploy required on Railway)' });
});

// ==================== 前台頁面 ====================
app.get('/', async (req, res) => {
  try {
    const data = await fs.promises.readFile(path.join(__dirname, 'public', 'index.html'), 'utf8');
    res.send(data);
  } catch {
    res.send('Hello! Access /sub to get nodes.');
  }
});
app.use('/static', express.static(path.join(__dirname, 'public')));

// ==================== 啟動 HTTP Server ====================
app.listen(PORT, () => {
  console.log(`http server running on port:${PORT}`);
  console.log(`WEB_USER=${WEB_USER} WEB_PASS=${WEB_PASS}`);
});