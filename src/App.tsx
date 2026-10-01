import React, { useEffect, useState } from 'react';
import { ToastProvider, TitleBar, Sidebar, Card, ErrorBoundary, applyTheme } from './components';
import { api } from './api';
import type { State } from './types';
import { Dashboard, Channels, Models, Tokens, Logs, Stats, Settings } from './pages';

const TITLES: Record<string, string> = {
  Dashboard: '仪表盘', Channels: '频道管理', Models: '模型池', Tokens: '客户端令牌',
  Logs: '请求日志', Stats: '统计', Settings: '设置',
};

export default function App() {
  const [state, setState] = useState<State | null>(null);
  // 支持 ?page= 直达某页（Web Admin 收藏/分享用），如 /?page=Stats
  const [page, setPage] = useState(() => {
    try {
      const p = new URLSearchParams(window.location.search).get('page') || 'Dashboard';
      return ['Dashboard', 'Channels', 'Models', 'Tokens', 'Logs', 'Stats', 'Settings'].includes(p) ? p : 'Dashboard';
    } catch { return 'Dashboard'; }
  });
  const [loading, setLoading] = useState(true);
  const [needLogin, setNeedLogin] = useState(false);

  const load = async () => {
    try {
      const s = await api.state();
      setState(s);
      applyTheme(s.settings.theme);
      setNeedLogin(false);
    } catch (e: any) {
      if (String(e.message).includes('401') || String(e.message).includes('unauthorized')) setNeedLogin(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  if (needLogin) {
    return (
      <ToastProvider>
        <div className="app">
          <TitleBar title="玄枢" />
          <div className="content" style={{ maxWidth: 360, margin: '80px auto' }}>
            <Card>
              <h2>登录 Web Admin</h2>
              <p className="muted">请输入管理口令（在「设置」中设置）。桌面端通常无需登录。</p>
              <LoginForm onOk={() => { setNeedLogin(false); load(); }} />
            </Card>
          </div>
        </div>
      </ToastProvider>
    );
  }

  return (
    <ToastProvider>
      <div className="app">
        <TitleBar title="玄枢" />
        <div className="body">
          <Sidebar active={page} onNav={setPage} />
          <div className="content">
            {loading && <div className="empty">加载中…</div>}
            {!loading && state && (
              <ErrorBoundary key={page}>
                <Inner page={page} state={state} refresh={load} setState={setState} />
              </ErrorBoundary>
            )}
          </div>
        </div>
      </div>
    </ToastProvider>
  );
}

function Inner({ page, state, refresh, setState }: { page: string; state: State; refresh: () => void; setState: any }) {  const props = { state, refresh, setState };
  switch (page) {
    case 'Channels': return <Channels {...props} />;
    case 'Models': return <Models {...props} />;
    case 'Tokens': return <Tokens {...props} />;
    case 'Logs': return <Logs {...props} />;
    case 'Stats': return <Stats {...props} />;
    case 'Settings': return <Settings {...props} />;
    default: return <Dashboard {...props} />;
  }
}

function LoginForm({ onOk }: { onOk: () => void }) {
  const [tok, setTok] = useState('');
  const submit = async () => {
    try { await api.login(tok); localStorage.setItem('adminToken', tok); onOk(); }
    catch (e: any) { alert('口令错误：' + e.message); }
  };
  return (
    <div className="mt16">
      <input placeholder="管理口令" value={tok} onChange={(e) => setTok(e.target.value)} />
      <div className="modal-actions">
        <button className="btn" onClick={submit}>登录</button>
      </div>
    </div>
  );
}
