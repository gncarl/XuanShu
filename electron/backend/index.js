// 后端入口：装配各模块，启动代理端口与管理(Web Admin)端口。
// 既能被 Electron 主进程调用，也能用 `node electron/backend/index.js` 单独跑（headless）。
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { DataStore } from './store.js';
import { LogStore } from './logstore.js';
import { Resilience } from './resilience.js';
import { Router } from './router.js';
import { ProxyServer } from './proxy.js';
import { createAdminApp } from './adminApi.js';
import { SessionManager } from './tokens.js';

function resolveDataDir(opts) {
  if (opts?.dataDir) return opts.dataDir;
  if (process.env.AI_GATEWAY_DATA_DIR) return process.env.AI_GATEWAY_DATA_DIR;
  return path.join(process.cwd(), 'data');
}

// 兜底：一个请求出错绝不能把整个网关带崩（本地网关崩了等于所有 AI 工具全断）。
process.on('unhandledRejection', (e) => {
  console.error('[unhandledRejection]', (e && e.stack) || e);
});
process.on('uncaughtException', (e) => {
  console.error('[uncaughtException]', (e && e.stack) || e);
});

async function listenAvailable(createServer, port, host = '127.0.0.1') {
  for (let p = port; p < port + 20; p++) {
    const server = createServer();
    try {
      await new Promise((resolve, reject) => {
        server.listen(p, host, () => resolve());
        server.once('error', reject);
      });
      return { server, port: p };
    } catch { /* 端口被占，尝试下一个 */ }
  }
  throw new Error('no available port');
}

export async function startBackend(opts = {}) {
  const dataDir = resolveDataDir(opts);
  fs.mkdirSync(dataDir, { recursive: true });
  const store = new DataStore(dataDir).init();
  const logstore = new LogStore(dataDir, store.settings);
  const resilience = new Resilience(store);
  const router = new Router(store, resilience);
  const session = new SessionManager();

  // 管理/Web Admin 端口
  const adminApp = createAdminApp({
    store, resilience, router, logstore, session,
    desktopMode: !!opts.isDesktop,
    version: opts.version || '',
  });
  const { server: adminServer, port: adminPort } = await listenAvailable(() => http.createServer(adminApp), store.settings.adminPort);

  // 代理端口
  const proxy = new ProxyServer({ store, resilience, router, logstore, settings: store.settings });
  const pres = await listenAvailable(() => proxy.createServer(), store.settings.proxyPort);
  proxy.server = pres.server;
  const proxyPort = pres.port;

  // 把实际端口写回设置（供 UI / 连接器使用）
  store.updateSettings({ adminPort, proxyPort });

  // 0.2.6：启动预热 + 空闲保活（DNS 预解析 / 建热连接 / 探测可达性，不可达者自动剔除）
  proxy.startWarmup();

  console.log(`[玄枢] 代理端口    : http://127.0.0.1:${proxyPort}`);
  console.log(`[玄枢] 管理/WebAdmin: http://127.0.0.1:${adminPort}`);
  console.log(`[玄枢] 数据目录    : ${dataDir}`);

  return { proxyPort, adminPort, store, logstore, proxy, adminServer };
}

// 直接运行时（headless）：仅启动后端，不拉 Electron。
// 注意：打包成桌面应用后，主进程是以 app 包启动的，process.argv[1] 并不存在
// （为 undefined），直接传给 pathToFileURL 会抛 ERR_INVALID_ARG_TYPE 并让主进程崩溃。
// 因此必须先判断 argv[1] 是字符串。
import { pathToFileURL } from 'node:url';
const invokedDirectly =
  typeof process.argv[1] === 'string' &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  startBackend({ isDesktop: false }).catch((e) => {
    console.error('启动失败:', e);
    process.exit(1);
  });
}
