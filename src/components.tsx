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

// ---------------- 侧边栏 ----------------
const ICONS: Record<string, string> = {
  Dashboard: '📊', Channels: '🔌', Models: '🧩', Tokens: '🔑', Logs: '📜', Connectors: '🔗', Settings: '⚙️',
};
export function Sidebar({ active, onNav }: { active: string; onNav: (k: string) => void }) {
  const items = ['Dashboard', 'Channels', 'Models', 'Tokens', 'Logs', 'Connectors', 'Settings'];
  const labels: Record<string, string> = {
    Dashboard: '仪表盘', Channels: '频道', Models: '模型池', Tokens: '令牌', Logs: '日志', Connectors: '连接器', Settings: '设置',
  };
  return (
    <div className="sidebar">
      <div className="brand">
        <div className="logo">玄</div>
        <div>
          <div className="name">玄枢</div>
          <div className="sub">本地聚合路由网关</div>
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
export function Badge({ children, kind = '' }: { children: React.ReactNode; kind?: string }) {
  return <span className={`badge ${kind}`}>{children}</span>;
}
export function KPI({ label, value, unit }: { label: string; value: React.ReactNode; unit?: string }) {
  return (
    <Card className="kpi">
      <div className="label">{label}</div>
      <div className="value">{value}{unit && <small> {unit}</small>}</div>
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
