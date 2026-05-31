/**
 * Generates xray JSON configuration from panel inbounds
 * Supports:
 *   Protocols: vless, vmess, trojan, shadowsocks, socks
 *   Transports: tcp, kcp, ws, httpupgrade, xhttp, grpc, quic
 *   Security: none, tls, reality, vision
 */

function generateStreamSettings(inbound) {
  const streamSettings = {
    network: inbound.transport || 'tcp',
    security: inbound.security || 'none'
  };

  // TLS settings
  if (inbound.security === 'tls') {
    streamSettings.tlsSettings = {
      certificates: [{
        certificateFile: inbound.certificateFile || '',
        keyFile: inbound.keyFile || ''
      }],
      alpn: ['h2', 'http/1.1'],
      minVersion: '1.2',
      cipherSuites: ''
    };
    if (inbound.sni) {
      streamSettings.tlsSettings.serverName = inbound.sni;
    }
  }

  // Reality settings
  if (inbound.security === 'reality') {
    streamSettings.realitySettings = {
      show: false,
      xver: 0,
      dest: inbound.dest || '',
      serverNames: inbound.serverNames || ['google.com'],
      privateKey: inbound.privateKey || '',
      shortIds: inbound.shortIds || ['6ba85179e30d4fc2']
    };
  }

  // Vision (can be combined with tls or reality)
  if (inbound.security === 'vision' || inbound.flow === 'xtls-rprx-vision') {
    streamSettings.security = inbound.security === 'reality' ? 'reality' : 'tls';
    if (!streamSettings.realitySettings) {
      streamSettings.realitySettings = {
        show: false,
        xver: 0,
        dest: inbound.dest || '',
        serverNames: inbound.serverNames || ['google.com'],
        privateKey: inbound.privateKey || '',
        shortIds: inbound.shortIds || ['6ba85179e30d4fc2']
      };
    }
  }

  // Transport settings
  switch (inbound.transport) {
    case 'tcp':
      if (inbound.host || inbound.path) {
        streamSettings.tcpSettings = {
          header: {
            type: 'http',
            request: {
              path: [inbound.path || '/'],
              headers: {
                Host: [inbound.host || ''],
                'User-Agent': ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'],
                Accept: ['text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'],
                'Accept-Language': ['en-US,en;q=0.8']
              }
            }
          }
        };
      }
      break;

    case 'kcp':
      streamSettings.kcpSettings = {
        mtu: 1350,
        tti: 20,
        uplinkCapacity: 5,
        downlinkCapacity: 20,
        congestion: false,
        readBufferSize: 2,
        writeBufferSize: 2,
        header: {
          type: 'none'
        },
        seed: inbound.path || ''
      };
      break;

    case 'ws':
      streamSettings.wsSettings = {
        path: inbound.path || '/',
        headers: {}
      };
      if (inbound.host) {
        streamSettings.wsSettings.headers.Host = inbound.host;
      }
      break;

    case 'httpupgrade':
      streamSettings.httpupgradeSettings = {
        path: inbound.path || '/',
        host: inbound.host || ''
      };
      break;

    case 'xhttp':
      streamSettings.xhttpSettings = {
        path: inbound.path || '/',
        host: inbound.host || ''
      };
      break;

    case 'grpc':
      streamSettings.grpcSettings = {
        serviceName: inbound.serviceName || 'gun',
        multiMode: inbound.grpcMode === 'multi'
      };
      break;

    case 'quic':
      streamSettings.quicSettings = {
        security: 'none',
        key: '',
        header: {
          type: 'none'
        }
      };
      break;

    case 'splithttp':
      streamSettings.splithttpSettings = {
        path: inbound.path || '/',
        host: inbound.host || ''
      };
      break;

    default:
      break;
  }

  return streamSettings;
}

function generateInboundConfig(inbound) {
  // Base settings per protocol
  let settings;

  switch (inbound.protocol) {
    case 'vless':
      settings = {
        clients: inbound.clients.map(c => ({
          id: c.id,
          flow: c.flow || (inbound.security === 'vision' ? 'xtls-rprx-vision' : '')
        })),
        decryption: 'none',
        fallbacks: []
      };
      break;

    case 'vmess':
      settings = {
        clients: inbound.clients.map(c => ({
          id: c.id,
          level: 0,
          alterId: 0,
          email: c.email || c.name
        })),
        disableInsecureEncryption: true
      };
      break;

    case 'trojan':
      settings = {
        clients: inbound.clients.map(c => ({
          password: c.id,
          level: 0,
          email: c.email || c.name,
          flow: c.flow || ''
        })),
        fallbacks: []
      };
      break;

    case 'shadowsocks':
      settings = {
        method: 'aes-128-gcm',
        password: inbound.clients[0]?.clientId || 'password',
        email: inbound.clients[0]?.email || 'user@example.com',
        network: 'tcp,udp',
        clients: inbound.clients.map(c => ({
          method: 'aes-128-gcm',
          password: c.clientId,
          email: c.email || c.name,
          level: 0
        }))
      };
      break;

    case 'socks':
      settings = {
        auth: 'password',
        accounts: inbound.clients.map(c => ({
          user: c.name || c.email,
          pass: c.clientId
        })),
        udp: true,
        ip: '0.0.0.0'
      };
      break;

    default:
      settings = {
        clients: inbound.clients.map(c => ({
          id: c.id,
          level: 0
        })),
        decryption: 'none'
      };
  }

  // Build full inbound object
  const inboundConfig = {
    listen: inbound.listen || '0.0.0.0',
    port: inbound.port,
    protocol: inbound.protocol,
    settings: JSON.parse(JSON.stringify(settings)),
    streamSettings: generateStreamSettings(inbound),
    sniffing: inbound.sniffing !== false ? {
      enabled: true,
      destOverride: ['http', 'tls', 'quic'],
      metadataOnly: false
    } : undefined,
    allocate: inbound.allocate || {
      strategy: 'always',
      refresh: 5,
      concurrency: 3
    }
  };

  if (inbound.tag) {
    inboundConfig.tag = inbound.tag;
  }

  return inboundConfig;
}

function generateFullConfig(inbounds, options = {}) {
  const config = {
    log: {
      access: options.logAccess || '/var/log/xray/access.log',
      error: options.logError || '/var/log/xray/error.log',
      loglevel: options.logLevel || 'warning',
      dnsLog: false
    },
    inbounds: inbounds.map(inbound => generateInboundConfig(inbound)),
    outbounds: options.outbounds || [
      {
        protocol: 'freedom',
        tag: 'direct',
        settings: {}
      },
      {
        protocol: 'blackhole',
        tag: 'block',
        settings: {
          response: {
            type: 'http'
          }
        }
      }
    ],
    routing: options.routing || {
      domainStrategy: 'AsIs',
      rules: [
        {
          type: 'field',
          inboundTag: ['block'],
          outboundTag: 'block'
        }
      ]
    },
    dns: options.dns || {
      servers: [
        'https+local://dns.google/dns-query',
        'localhost'
      ]
    },
    policy: options.policy || {
      levels: {
        '0': {
          handshake: 4,
          connIdle: 300,
          uplinkOnly: 2,
          downlinkOnly: 5,
          statsUserUplink: true,
          statsUserDownlink: true
        }
      },
      system: {
        statsInboundUplink: true,
        statsInboundDownlink: true,
        statsOutboundUplink: true,
        statsOutboundDownlink: true
      }
    },
    stats: options.stats !== false ? {} : undefined,
    api: options.api || {
      tag: 'api',
      services: ['HandlerService', 'LoggerService', 'StatsService', 'RoutingService']
    }
  };

  // Add API inbound if stats enabled
  if (config.stats) {
    config.inbounds.push({
      listen: '127.0.0.1',
      port: 62789,
      protocol: 'dokodemo-door',
      settings: {
        address: '127.0.0.1'
      },
      tag: 'api'
    });
  }

  return config;
}

/**
 * Generate share links from inbound + client
 */
function generateShareLink(inbound, client, serverIp, serverNames) {
  const serverName = serverNames || inbound.serverNames?.[0] || inbound.host || serverIp || 'localhost';
  const port = inbound.port;
  const remark = encodeURIComponent(`${inbound.remark || 'node'} - ${client.name || client.email}`);
  const security = inbound.security || 'none';
  const transport = inbound.transport || 'tcp';
  const path = inbound.path || '/';

  switch (inbound.protocol) {
    case 'vless': {
      const params = new URLSearchParams();
      params.set('encryption', 'none');
      if (security === 'tls') params.set('security', 'tls');
      if (security === 'reality' || security === 'vision') params.set('security', 'reality');
      if (client.flow) params.set('flow', client.flow);
      if (transport !== 'tcp') params.set('type', transport);
      if (inbound.host) params.set('host', inbound.host);
      if (path) params.set('path', path);
      if (inbound.serviceName) params.set('serviceName', inbound.serviceName);
      if (inbound.sni) params.set('sni', inbound.sni);
      if (inbound.serverNames?.[0]) params.set('sni', inbound.serverNames[0]);
      if (inbound.privateKey) params.set('pbk', inbound.privateKey);
      if (inbound.shortIds?.[0]) params.set('sid', inbound.shortIds[0]);
      if (inbound.dest) params.set('spx', '/');
      params.set('fp', 'chrome');

      return `vless://${client.id}@${serverName}:${port}?${params.toString()}#${remark}`;
    }

    case 'vmess': {
      const vmessObj = {
        v: '2',
        ps: remark,
        add: serverName,
        port: port,
        id: client.id,
        aid: '0',
        scy: 'auto',
        net: transport,
        type: 'none',
        host: inbound.host || '',
        path: path,
        tls: security === 'tls' || security === 'reality' || security === 'vision' ? 'tls' : '',
        sni: inbound.sni || inbound.serverNames?.[0] || '',
        alpn: 'h2,http/1.1',
        fp: 'chrome'
      };

      if (transport === 'grpc') {
        vmessObj.serviceName = inbound.serviceName || 'gun';
      }

      return `vmess://${Buffer.from(JSON.stringify(vmessObj)).toString('base64')}`;
    }

    case 'trojan': {
      const params = new URLSearchParams();
      if (security === 'tls' || security === 'reality' || security === 'vision') {
        params.set('security', 'tls');
      }
      if (inbound.sni) params.set('sni', inbound.sni);
      if (inbound.serverNames?.[0]) params.set('sni', inbound.serverNames[0]);
      if (transport !== 'tcp') params.set('type', transport);
      if (inbound.host) params.set('host', inbound.host);
      if (path) params.set('path', path);
      if (inbound.serviceName) params.set('serviceName', inbound.serviceName);
      params.set('fp', 'chrome');
      if (client.flow) params.set('flow', client.flow);

      const queryStr = params.toString();
      return `trojan://${client.id}@${serverName}:${port}?${queryStr}#${remark}`;
    }

    case 'shadowsocks': {
      const method = 'aes-128-gcm';
      const password = client.clientId || client.id;
      return `ss://${Buffer.from(`${method}:${password}`).toString('base64')}@${serverName}:${port}#${remark}`;
    }

    case 'socks': {
      return `socks://${client.name}:${client.clientId}@${serverName}:${port}#${remark}`;
    }

    default:
      return '';
  }
}

module.exports = {
  generateStreamSettings,
  generateInboundConfig,
  generateFullConfig,
  generateShareLink
};