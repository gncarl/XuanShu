import React, { createContext, useContext, useState, useEffect } from 'react';

// ---------------- Toast ----------------
const ToastCtx = createContext<(msg: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [msg, setMsg] = useState('');
  const notify = (m: string) => { setMsg(m); };
  useEffect(() => { if (msg) { const t = setTimeout(() => setMsg(''), 2200); return () => clearTimeout(t); } }, [msg]);
  return (
    <ToastCtx.Provider value={notify}>
      {children}
      {msg && <div className="toast">{msg}</div>}
    </ToastCtx.Provider>
  );
}

// ---------------- 标题栏（可拖拽 + 窗口控制按钮）----------------
// 无边框窗口靠这里提供最小化/最大化/关闭。按钮放右上角、带图标，
// 与 Windows 习惯一致（之前左上角三个 12px 小圆点太不显眼，等于没有）。
export function TitleBar({ title }: { title: string }) {
  const [max, setMax] = useState(false);
  const app = (window as any).app;

  useEffect(() => {
    let off: any;
    try { Promise.resolve(app?.isMaximized?.()).then((v) => setMax(!!v)).catch(() => {}); } catch {}
    try { off = app?.onMaximizeChanged?.((v: boolean) => setMax(v)); } catch {}
    return () => { try { typeof off === 'function' && off(); } catch {} };
  }, []);

  const call = (fn: 'minimize' | 'maximize' | 'close') => {
    try { app?.[fn]?.(); } catch {}
  };

  const IconMin = () => (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M2 6h8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
  const IconMax = () => (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <rect x="2.4" y="2.4" width="7.2" height="7.2" rx="1.4" fill="none" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
  const IconRestore = () => (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <rect x="1.6" y="3.6" width="6.4" height="6.4" rx="1.3" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <path d="M4.2 3.6V3a1.4 1.4 0 0 1 1.4-1.4h3.4A1.4 1.4 0 0 1 10.4 3v3.4A1.4 1.4 0 0 1 9 7.8h-.6" fill="none" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
  const IconClose = () => (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );

  return (
    <div className="titlebar" onDoubleClick={() => call('maximize')}>
      <div className="tb-title">{title}</div>
      <div className="win-ctrls">
        <button className="wc" title="最小化" aria-label="最小化" onClick={() => call('minimize')}><IconMin /></button>
        <button className="wc" title={max ? '向下还原' : '最大化'} aria-label="最大化" onClick={() => call('maximize')}>
          {max ? <IconRestore /> : <IconMax />}
        </button>
        <button className="wc close" title="关闭" aria-label="关闭" onClick={() => call('close')}><IconClose /></button>
      </div>
    </div>
  );
}

// ---------------- 错误边界 ----------------
// 单个页面渲染出错时兜住异常，避免整屏白（只影响当前页，侧边栏仍可切换）。
export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { err: Error | null }
> {
  constructor(props: any) {
    super(props);
    this.state = { err: null };
  }
  static getDerivedStateFromError(err: Error) { return { err }; }
  componentDidCatch(err: Error, info: any) {
    // 打印到渲染层控制台，便于在 Electron DevTools 里定位
    console.error('[玄枢] 页面渲染异常', err, info);
  }
  render() {
    if (this.state.err) {
      return (
        <div className="card" style={{ padding: 24 }}>
          <h3 style={{ marginTop: 0 }}>这个页面出错了</h3>
          <p className="muted">其他页面仍可正常使用。以下是错误信息，可反馈给开发者：</p>
          <div className="code mt8" style={{ whiteSpace: 'pre-wrap' }}>
            {String(this.state.err?.message || this.state.err)}
            {'\n\n'}
            {String(this.state.err?.stack || '').split('\n').slice(0, 6).join('\n')}
          </div>
          <div className="modal-actions">
            <button className="btn secondary" onClick={() => this.setState({ err: null })}>重试</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ---------------- 图标（内联 SVG，随主题色变化）----------------
export function IconTrash({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M3 4.2h10M6.4 4.2V3.1c0-.5.4-.9.9-.9h1.4c.5 0 .9.4.9.9v1.1M4.4 4.2l.5 8.1c0 .6.5 1.1 1.1 1.1h4c.6 0 1.1-.5 1.1-1.1l.5-8.1M6.7 6.7v4.2M9.3 6.7v4.2"
        stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"
      />
    </svg>
  );
}
export function IconExternal({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M6.5 3.5H4A1.5 1.5 0 0 0 2.5 5v7A1.5 1.5 0 0 0 4 13.5h7A1.5 1.5 0 0 0 12.5 12V9.5M9.5 2.5h4v4M13 3L7.5 8.5"
        stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"
      />
    </svg>
  );
}

// ---------------- 侧边栏 ----------------
const ICONS: Record<string, string> = {
  Dashboard: '📊', Channels: '🔌', Models: '🧩', Tokens: '🔑', Logs: '📜', Stats: '📈', Settings: '⚙️', About: 'ℹ️',
};
export const PAGES = ['Dashboard', 'Channels', 'Models', 'Tokens', 'Logs', 'Stats', 'Settings', 'About'];
export function Sidebar({ active, onNav, version }: { active: string; onNav: (k: string) => void; version?: string }) {
  const items = PAGES;
  const labels: Record<string, string> = {
    Dashboard: '仪表盘', Channels: '频道', Models: '模型池', Tokens: '令牌', Logs: '日志', Stats: '统计', Settings: '设置', About: '关于',
  };
  return (
    <div className="sidebar">
      <div className="brand">
        <div className="logo">玄</div>
        <div>
          <div className="name">玄枢</div>
          <div className="sub">本地聚合路由网关{version ? ` · v${version}` : ''}</div>
        </div>
      </div>
      {items.map((k) => (
        <button key={k} className={`nav-item ${active === k ? 'active' : ''}`} onClick={() => onNav(k)}>
          <span className="ico">{ICONS[k]}</span>{labels[k]}
        </button>
      ))}
    </div>
  );
}

// ---------------- 基础组件 ----------------
export function Card({ children, className = '', style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return <div className={`card ${className}`} style={style}>{children}</div>;
}
export function Modal({ title, onClose, children, className = '' }: { title: string; onClose: () => void; children: React.ReactNode; className?: string }) {
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className={`modal ${className}`} onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}
export function Switch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="switch">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="slider" />
    </label>
  );
}
export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <div className="hint">{hint}</div>}
    </label>
  );
}
export function Badge({ children, kind = '', title }: { children: React.ReactNode; kind?: string; title?: string }) {
  return <span className={`badge ${kind}`} title={title}>{children}</span>;
}
export function KPI({ label, value, unit, sub }: { label: string; value: React.ReactNode; unit?: string; sub?: React.ReactNode }) {
  return (
    <Card className="kpi">
      <div className="label">{label}</div>
      <div className="value">{value}{unit && <small> {unit}</small>}</div>
      {sub !== undefined && <div className="kpi-sub">{sub}</div>}
    </Card>
  );
}
export function Bar({ value, max = 100 }: { value: number; max?: number }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return <div className="bar-track"><div className="bar-fill" style={{ width: pct + '%' }} /></div>;
}

// 主题应用（light/dark/auto）
export function applyTheme(t: string) {
  let theme = t || 'light';
  if (t === 'auto') {
    theme = window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  document.documentElement.setAttribute('data-theme', theme);
}
