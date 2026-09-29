import React, { useEffect, useRef, useState } from 'react';
import { api } from './api';
import type { State, Channel, ModelEntry, Token, RouteRule, RouteStrategy } from './types';
import { Card, Modal, Switch, Field, Badge, KPI, Bar, useToast, applyTheme } from './components';

function fmtBytes(b: number) {
  if (b < 1024) return b + ' B';
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
  return (b / 1024 / 1024).toFixed(1) + ' MB';
}
function fmtNum(n: number) { return (n || 0).toLocaleString(); }
function timeStr(ts: number) { return new Date(ts).toLocaleString('zh-CN', { hour12: false }); }
function CopyBtn({ text, label = '复制' }: { text: string; label?: string }) {
  const toast = useToast();
  return <button className="btn ghost sm" onClick={() => { navigator.clipboard?.writeText(text); toast('已复制'); }}>{label}</button>;
}

// =================== Dashboard ===================
export function Dashboard({ state, refresh }: { state: State; refresh: () => void }) {
  const [stats, setStats] = useState<any>(null);
  const load = () => api.logStats().then(setStats).catch(() => {});
  useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t); }, []);

  const proxy = `http://127.0.0.1:${state.settings.proxyPort}`;
  const t = stats?.trend;
  const W = 520, H = 120;
  let path = '', failPath = '';
  if (t) {
    const max = Math.max(1, ...t.success, ...t.failed);
    const step = W / (t.success.length - 1);
    path = t.success.map((v: number, i: number) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${(H - (v / max) * H).toFixed(1)}`).join(' ');
    failPath = t.failed.map((v: number, i: number) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${(H - (v / max) * H).toFixed(1)}`).join(' ');
  }

  return (
    <div>
      <h1>仪表盘</h1>
      <p className="lead">本地 AI 聚合路由网关的运行概览。所有数据仅存于本机，不做任何备份。</p>

      <div className="grid cols-4">
        <KPI label="总请求" value={fmtNum(stats?.total)} />
        <KPI label="成功率" value={((stats?.successRate || 0) * 100).toFixed(1)} unit="%" />
        <KPI label="失败" value={fmtNum(stats?.failed)} />
        <KPI label="Token 用量" value={fmtNum((stats?.totalTokens || 0))} />
      </div>

      <div className="grid cols-2 mt24">
        <Card>
          <div className="flex between center">
            <strong>近 24 小时趋势</strong>
            <span className="muted" style={{ fontSize: 12 }}>绿=成功 · 红=失败</span>
          </div>
          <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H + 10} style={{ marginTop: 8 }}>
            <path d={failPath} fill="none" stroke="var(--red)" strokeWidth="2" />
            <path d={path} fill="none" stroke="var(--green)" strokeWidth="2" />
          </svg>
        </Card>
        <Card>
          <strong>模型分布</strong>
          <div className="mt16">
            {stats && Object.keys(stats.byModel || {}).length === 0 && <div className="muted">暂无数据</div>}
            {stats && Object.entries(stats.byModel || {}).map(([m, c]: any) => (
              <div key={m} style={{ marginBottom: 10 }}>
                <div className="flex between" style={{ fontSize: 12 }}><span>{m}</span><span className="muted">{c}</span></div>
                <div className="mt8"><Bar value={c} max={Math.max(...(Object.values(stats.byModel) as number[]))} /></div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card className="mt24">
        <strong>客户端接入点</strong>
        <p className="muted mt8">把任意 AI 工具（Claude Code / OpenCode / Codex / Zed 等）的 Base URL 指向下面这个地址即可：</p>
        <div className="flex gap8 center mt8">
          <code className="code" style={{ flex: 1 }}>{proxy}/v1/chat/completions</code>
          <CopyBtn text={`${proxy}/v1/chat/completions`} />
        </div>
        <p className="muted mt8">当前已配置 {state.channels.filter((c) => c.enabled).length} 个启用频道、{state.models.filter((m) => m.enabled).length} 个启用模型。</p>
      </Card>
    </div>
  );
}

// =================== Channels ===================
type ChForm = Partial<Channel> & { id?: string };
const emptyChannel = (): ChForm => ({ protocol: 'openai', enabled: true, priority: 100, name: '', baseUrl: '', apiKey: '' });

export function Channels({ state, refresh }: { state: State; refresh: () => void }) {
  const toast = useToast();
  const [probe, setProbe] = useState<Record<string, any>>({});
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<ChForm>(emptyChannel());
  const [busy, setBusy] = useState(false);
  // 拉取到的模型 + 勾选状态（只把勾中的加入模型池，不再"全部加入"）
  const [fetched, setFetched] = useState<string[]>([]);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [filter, setFilter] = useState('');
  const [addGroup, setAddGroup] = useState(state.settings.autoGroup);
  const pickRef = useRef<HTMLDivElement | null>(null);

  // 拉取完成后把结果列表滚进视野（弹窗比屏幕高时，否则要手动往下拉才看得到）
  useEffect(() => {
    if (fetched.length) pickRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [fetched.length]);

  const isEdit = !!form.id;
  const inPool = (name: string) => state.models.some((m) => m.channelId === form.id && (m.upstreamModel || m.name) === name);

  const openNew = () => {
    setForm(emptyChannel()); setFetched([]); setPicked({}); setFilter('');
    setAddGroup(state.settings.autoGroup); setOpen(true);
  };
  const openEdit = (c: Channel) => {
    setForm({ ...c }); setFetched([]); setPicked({}); setFilter('');
    setAddGroup(state.settings.autoGroup); setOpen(true);
  };

  // 保存表单（新建则创建），返回频道 id。
  // 拉取模型前先落库，否则用的还是旧的 baseUrl / apiKey。
  const persist = async (): Promise<string | null> => {
    if (!form.name || !form.baseUrl) { toast('请先填写名称与 Base URL'); return null; }
    if (form.id) { await api.updateChannel(form.id, form); await refresh(); return form.id; }
    const c: any = await api.addChannel(form);
    setForm((f) => ({ ...f, id: c.id }));
    await refresh();
    return c.id;
  };

  const doProbe = async (id: string) => {
    setProbe((p) => ({ ...p, [id]: { loading: true } }));
    const r = await api.probeChannel(id); setProbe((p) => ({ ...p, [id]: r }));
  };

  const doFetch = async () => {
    const id = await persist();
    if (!id) return;
    setBusy(true);
    try {
      const r: any = await api.fetchModels(id);
      if (!r.ok) { toast('拉取失败：' + (r.error || '未知错误')); return; }
      const uniq: string[] = Array.from(new Set(r.models as string[])).sort();
      const pool = new Set(state.models.filter((m) => m.channelId === id).map((m) => m.upstreamModel || m.name));
      const p: Record<string, boolean> = {};
      for (const m of uniq) p[m] = !pool.has(m);   // 已在池里的默认不勾
      setFetched(uniq); setPicked(p);
      toast(`拉取到 ${uniq.length} 个模型，勾选要加入的`);
    } catch (e: any) { toast('拉取失败：' + (e?.message || e)); }
    finally { setBusy(false); }
  };

  const pickAll = (v: boolean) => {
    const n: Record<string, boolean> = {};
    for (const m of fetched) n[m] = v && !inPool(m);
    setPicked(n);
  };
  const pickNotInPool = () => {
    const n: Record<string, boolean> = {};
    for (const m of fetched) n[m] = !inPool(m);
    setPicked(n);
  };

  const addPicked = async () => {
    const id = form.id || (await persist());
    if (!id) return;
    const list = fetched.filter((m) => picked[m]);
    if (!list.length) { toast('请先勾选要加入的模型'); return; }
    setBusy(true);
    try {
      for (const m of list) {
        await api.addModel({
          name: m, channelId: id, upstreamModel: m,
          group: addGroup || state.settings.autoGroup,
          priority: Number(form.priority) || 100, enabled: true,
        });
      }
      setPicked((prev) => { const n = { ...prev }; for (const m of list) n[m] = false; return n; });
      toast(`已加入 ${list.length} 个模型到模型池`);
      await refresh();
    } finally { setBusy(false); }
  };

  const saveOnly = async () => {
    const id = await persist();
    if (!id) return;
    toast(isEdit ? '已保存' : '已添加频道');
    setOpen(false);
  };

  const shown = fetched.filter((m) => !filter || m.toLowerCase().includes(filter.toLowerCase()));
  const pickedCount = fetched.filter((m) => picked[m]).length;
  const notInPool = fetched.filter((m) => !inPool(m)).length;

  return (
    <div>
      <div className="flex between center">
        <div><h1>频道</h1><p className="lead">上游服务商（OpenAI / Claude / Gemini / Azure …）。点「编辑」可改配置并拉取模型。</p></div>
        <button className="btn" onClick={openNew}>+ 新建频道</button>
      </div>

      <Card>
        <table>
          <thead><tr><th>名称</th><th>协议</th><th>Base URL</th><th>优先级</th><th>状态</th><th>探测</th><th></th></tr></thead>
          <tbody>
            {state.channels.map((c) => {
              const cnt = state.models.filter((m) => m.channelId === c.id).length;
              return (
                <tr key={c.id}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{c.name}</div>
                    <div className="muted" style={{ fontSize: 12 }}>{cnt} 个模型</div>
                  </td>
                  <td><Badge>{state.protocolLabels[c.protocol]}</Badge></td>
                  <td className="muted" style={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.baseUrl}</td>
                  <td>{c.priority}</td>
                  <td><Switch checked={c.enabled} onChange={(v) => { api.updateChannel(c.id, { enabled: v }); refresh(); }} /></td>
                  <td style={{ fontSize: 12 }}>
                    <button className="btn ghost sm" onClick={() => doProbe(c.id)}>探测</button>{' '}
                    {probe[c.id]?.loading && '…'}
                    {probe[c.id]?.ok && <Badge kind="green">{probe[c.id].latencyMs}ms</Badge>}
                    {probe[c.id] && probe[c.id].ok === false && <Badge kind="red">{probe[c.id].error}</Badge>}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button className="btn ghost sm" onClick={() => openEdit(c)}>编辑 / 拉模型</button>{' '}
                    <button className="btn ghost sm" onClick={() => { if (confirm('删除该频道及其模型？')) { api.deleteChannel(c.id); refresh(); } }}>删</button>
                  </td>
                </tr>
              );
            })}
            {state.channels.length === 0 && <tr><td colSpan={7} className="empty">还没有频道，点右上角新建</td></tr>}
          </tbody>
        </table>
      </Card>

      {open && (
        <Modal className="wide" title={isEdit ? '编辑频道（供应商）' : '新建频道（供应商）'} onClose={() => setOpen(false)}>
          <Field label="名称"><input value={form.name || ''} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="例如：我的 OpenAI" /></Field>
          <Field label="协议">
            <select value={form.protocol} onChange={(e) => setForm({ ...form, protocol: e.target.value as any })}>
              {Object.entries(state.protocolLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <div className="row">
            <Field label="Base URL" hint="上游 API 根地址。带不带版本段都行：https://api.openai.com 或 https://api.siliconflow.cn/v1"><input value={form.baseUrl || ''} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} placeholder="https://api.openai.com/v1" /></Field>
            <Field label="API Key"><input value={form.apiKey || ''} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} placeholder="sk-..." /></Field>
          </div>
          {form.protocol === 'azure' && (
            <div className="row">
              <Field label="Deployment"><input value={form.deployment || ''} onChange={(e) => setForm({ ...form, deployment: e.target.value })} /></Field>
              <Field label="API Version"><input value={form.apiVersion || ''} onChange={(e) => setForm({ ...form, apiVersion: e.target.value })} placeholder="2024-02-15-preview" /></Field>
            </div>
          )}
          <div className="row">
            <Field label="优先级"><input type="number" value={form.priority ?? 100} onChange={(e) => setForm({ ...form, priority: +e.target.value })} /></Field>
            <Field label="启用"><div className="mt8"><Switch checked={!!form.enabled} onChange={(v) => setForm({ ...form, enabled: v })} /></div></Field>
          </div>

          <div className="mt16" style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
            <div className="flex between center">
              <div>
                <strong style={{ fontSize: 13 }}>模型</strong>
                <div className="hint" style={{ marginTop: 2 }}>拉取上游可用模型，自己勾选要加入模型池的（不必全加）。拉取前会自动保存本页配置。</div>
              </div>
              <button className="btn secondary sm" disabled={busy} onClick={doFetch}>{busy ? '处理中…' : '拉取模型'}</button>
            </div>

            {fetched.length > 0 && (
              <>
                <div className="flex between center mt16" style={{ gap: 8, alignItems: 'center' }}>
                  <span className="muted" style={{ fontSize: 12 }}>共 {fetched.length} 个 · 已选 {pickedCount} 个 · 未加入 {notInPool} 个</span>
                  <div className="flex gap8">
                    <button className="btn ghost sm" onClick={() => pickAll(true)}>全选</button>
                    <button className="btn ghost sm" onClick={() => pickAll(false)}>全不选</button>
                    <button className="btn ghost sm" onClick={pickNotInPool}>只选未加入</button>
                  </div>
                </div>

                <div className="pick-box mt8">
                  <div className="pick-head">
                    <input type="text" placeholder="搜索模型名…" value={filter} onChange={(e) => setFilter(e.target.value)} />
                  </div>
                  <div className="pick-list">
                    {shown.map((m) => {
                      const done = inPool(m);
                      return (
                        <label key={m} className={`pick-item ${done ? 'done' : ''}`}>
                          <input
                            type="checkbox"
                            checked={!!picked[m]}
                            disabled={done}
                            onChange={(e) => setPicked((p) => ({ ...p, [m]: e.target.checked }))}
                          />
                          <span className="nm">{m}</span>
                          {done && <Badge kind="gray">已在模型池</Badge>}
                        </label>
                      );
                    })}
                    {shown.length === 0 && <div className="empty" style={{ padding: 22 }}>没有匹配的模型</div>}
                  </div>
                </div>

                <div className="row mt8">
                  <Field label="加入的分组">
                    <select value={addGroup} onChange={(e) => setAddGroup(e.target.value)}>
                      {state.groups.map((g) => <option key={g.name} value={g.name}>{g.name}</option>)}
                    </select>
                  </Field>
                  <Field label="加入后的优先级" hint="与上面「优先级」一致"><input type="number" value={form.priority ?? 100} onChange={(e) => setForm({ ...form, priority: +e.target.value })} /></Field>
                </div>
              </>
            )}
          </div>

          <div className="modal-actions">
            <button className="btn secondary" onClick={() => setOpen(false)}>取消</button>
            {fetched.length > 0 && (
              <button className="btn secondary" disabled={busy || !pickedCount} onClick={addPicked}>
                加入选中的 {pickedCount} 个
              </button>
            )}
            <button className="btn" disabled={busy} onClick={saveOnly}>保存</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// =================== Models ===================
// 路由策略：故障转移 / 轮询 / 加权
const ROUTE_STRATEGIES: { value: RouteStrategy; label: string; short: string }[] = [
  { value: 'failover', label: '故障转移（按顺序依次尝试）', short: '故障转移' },
  { value: 'roundrobin', label: '轮询（依次分配，失败顺延）', short: '轮询' },
  { value: 'weighted', label: '加权（按权重随机，权重大的优先）', short: '加权' },
];
const strategyShort = (s: string) => ROUTE_STRATEGIES.find((x) => x.value === s)?.short || s;
const emptyRoute = (): any => ({ name: '', strategy: 'failover', enabled: true, targets: [] });

export function Models({ state, refresh }: { state: State; refresh: () => void }) {
  const toast = useToast();
  const [show, setShow] = useState(false);
  const [form, setForm] = useState<any>({ group: state.settings.autoGroup, enabled: true, priority: 100 });
  // 路由规则
  const [rOpen, setROpen] = useState(false);
  const [rEditId, setREditId] = useState<string | null>(null);
  const [rForm, setRForm] = useState<any>(emptyRoute());
  const [rFilter, setRFilter] = useState('');

  const save = async () => {
    if (!form.name || !form.channelId) return toast('请填写模型名并选择频道');
    await api.addModel(form); toast('已添加模型'); setShow(false); setForm({ group: state.settings.autoGroup, enabled: true, priority: 100 }); refresh();
  };
  const reset = async (id: string) => { await api.resetModel(id); toast('已重置冷却/熔断'); refresh(); };

  // ---- 路由规则操作 ----
  const openNewRoute = () => { setREditId(null); setRForm(emptyRoute()); setRFilter(''); setROpen(true); };
  const openEditRoute = (r: RouteRule) => {
    setREditId(r.id);
    setRForm({
      name: r.name, strategy: r.strategy, enabled: r.enabled,
      targets: (r.targets || []).map((t) => ({ ...t })),
    });
    setRFilter('');
    setROpen(true);
  };
  // 路由目标多选：直接用 targets 数组作为已选项与顺序来源
  const rToggle = (m: ModelEntry, v: boolean) => setRForm((f: any) => {
    const has = f.targets.some((t: any) => t.modelId === m.id);
    if (v && !has) return { ...f, targets: [...f.targets, { modelId: m.id, weight: 1 }] };
    if (!v && has) return { ...f, targets: f.targets.filter((t: any) => t.modelId !== m.id) };
    return f;
  });
  const rSetWeight = (m: ModelEntry, w: number) => setRForm((f: any) => ({
    ...f, targets: f.targets.map((t: any) => (t.modelId === m.id ? { ...t, weight: w } : t)),
  }));
  const rShown = state.models.filter((m: ModelEntry) => {
    if (!rFilter) return true;
    const ch = state.channels.find((c: any) => c.id === m.channelId);
    const s = rFilter.toLowerCase();
    return (m.name + ' ' + m.upstreamModel + ' ' + (ch?.name || '')).toLowerCase().includes(s);
  });
  const rPickShown = (v: boolean) => setRForm((f: any) => {
    const byId = new Map(f.targets.map((t: any) => [t.modelId, t]));
    let out = [...f.targets];
    for (const m of rShown) {
      if (v && !byId.has(m.id)) out.push({ modelId: m.id, weight: 1 });
      if (!v) out = out.filter((t: any) => t.modelId !== m.id);
    }
    return { ...f, targets: out };
  });
  const rInvertShown = () => setRForm((f: any) => {
    const byId = new Map(f.targets.map((t: any) => [t.modelId, t]));
    let out = [...f.targets];
    for (const m of rShown) {
      if (byId.has(m.id)) out = out.filter((t: any) => t.modelId !== m.id);
      else out.push({ modelId: m.id, weight: 1 });
    }
    return { ...f, targets: out };
  });
  const saveRoute = async () => {
    if (!rForm.name.trim()) return toast('请填写客户端模型名');
    const targets = rForm.targets.filter((t: any) => t.modelId);
    if (!targets.length) return toast('请至少添加一个上游目标');
    const payload = { name: rForm.name.trim(), strategy: rForm.strategy, enabled: rForm.enabled, targets };
    try {
      if (rEditId) await api.updateRoute(rEditId, payload); else await api.addRoute(payload);
      toast(rEditId ? '已保存路由' : '已新建路由');
      setROpen(false); refresh();
    } catch (e: any) { toast('保存失败：' + (e?.message || e)); }
  };
  const targetSummary = (r: RouteRule) => {
    const all = r.targets || [];
    const parts = all.slice(0, 4).map((t) => {
      const m = state.models.find((x) => x.id === t.modelId);
      const nm = m ? `${m.name}→${m.upstreamModel}` : '(已失效)';
      return r.strategy === 'weighted' ? `${nm}(w${t.weight})` : nm;
    });
    if (!parts.length) return '（无目标）';
    return parts.join(' · ') + (all.length > 4 ? ` … 等 ${all.length} 个` : '');
  };

  return (
    <div>
      <h1>模型池</h1>
      <p className="lead">给客户端用的模型名 → 上游模型的映射。可建「路由规则」把一个名字（如 auto、local）路由到一个或多个上游，并选择策略。</p>

      <Card>
        <div className="flex between center">
          <div>
            <strong>路由规则（虚拟模型）</strong>
            <div className="hint" style={{ marginTop: 2 }}>
              自己起个客户端模型名（如 auto、local），把它路由到下面模型池里的一个或多个上游；可选故障转移 / 轮询 / 加权
            </div>
          </div>
          <button className="btn secondary sm" onClick={openNewRoute}>+ 新建路由</button>
        </div>
        <table className="mt8">
          <thead><tr><th>客户端模型名</th><th>策略</th><th>上游目标</th><th>状态</th><th></th></tr></thead>
          <tbody>
            {state.routes.map((r) => (
              <tr key={r.id}>
                <td><code>{r.name}</code></td>
                <td><Badge kind="gray">{strategyShort(r.strategy)}</Badge></td>
                <td className="muted" style={{ fontSize: 12, maxWidth: 380 }}>{targetSummary(r)}</td>
                <td>{r.enabled ? <Badge kind="green">启用</Badge> : <Badge kind="gray">停用</Badge>}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn ghost sm" onClick={() => openEditRoute(r)}>编辑</button>{' '}
                  <button className="btn ghost sm" onClick={() => { if (confirm('删除该路由？')) { api.deleteRoute(r.id); refresh(); } }}>删</button>
                </td>
              </tr>
            ))}
            {state.routes.length === 0 && <tr><td colSpan={5} className="empty">还没有路由规则。示例：名称 auto，策略「轮询」，目标选几个上游模型。</td></tr>}
          </tbody>
        </table>
      </Card>

      <Card className="mt16">
        <div className="flex between center">
          <div>
            <strong>上游模型（模型池）</strong>
            <div className="hint" style={{ marginTop: 2 }}>每条 = 一个「客户端模型名 → 某频道的一个上游模型」的映射。批量加入请到「频道」点「编辑 / 拉模型」。</div>
          </div>
          <button className="btn secondary sm" onClick={() => setShow(true)}>+ 新建模型</button>
        </div>
        <table className="mt8">
          <thead><tr><th>客户端模型名</th><th>上游模型</th><th>频道</th><th>分组</th><th>别名</th><th>优先级</th><th>状态</th><th></th></tr></thead>
          <tbody>
            {state.models.map((m) => {
              const ch = state.channels.find((c) => c.id === m.channelId);
              const cooled = m.cooldownUntil > Date.now();
              return (
                <tr key={m.id}>
                  <td><code>{m.name}</code></td>
                  <td className="muted">{m.upstreamModel}</td>
                  <td>{ch?.name || '—'}</td>
                  <td><Badge kind="gray">{m.group}</Badge></td>
                  <td className="muted">{m.alias || '—'}</td>
                  <td>{m.priority}</td>
                  <td>
                    {!m.enabled && <Badge kind="gray">停用</Badge>}
                    {m.enabled && m.disabled && <Badge kind="red">禁用</Badge>}
                    {m.enabled && !m.disabled && cooled && <Badge kind="yellow">冷却中</Badge>}
                    {m.enabled && !m.disabled && !cooled && <Badge kind="green">就绪</Badge>}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {(m.disabled || cooled) && <button className="btn ghost sm" onClick={() => reset(m.id)}>重置</button>}{' '}
                    <button className="btn ghost sm" onClick={() => { if (confirm('删除该模型？')) { api.deleteModel(m.id); refresh(); } }}>删</button>
                  </td>
                </tr>
              );
            })}
            {state.models.length === 0 && <tr><td colSpan={8} className="empty">还没有模型，去「频道」点「编辑 / 拉模型」勾选加入，或在这里手动新建</td></tr>}
          </tbody>
        </table>
      </Card>

      {show && (
        <Modal title="新建模型" onClose={() => setShow(false)}>
          <Field label="客户端模型名" hint="工具里填的 model 字段，例如 gpt-4o"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="上游模型名" hint="实际发给上游的模型 ID"><input value={form.upstreamModel} onChange={(e) => setForm({ ...form, upstreamModel: e.target.value })} /></Field>
          <Field label="所属频道">
            <select value={form.channelId} onChange={(e) => setForm({ ...form, channelId: e.target.value })}>
              <option value="">请选择</option>
              {state.channels.map((c) => <option key={c.id} value={c.id}>{c.name}（{state.protocolLabels[c.protocol]}）</option>)}
            </select>
          </Field>
          <div className="row">
            <Field label="分组">
              <select value={form.group} onChange={(e) => setForm({ ...form, group: e.target.value })}>
                {state.groups.map((g) => <option key={g.name} value={g.name}>{g.name}</option>)}
              </select>
            </Field>
            <Field label="别名"><input value={form.alias} onChange={(e) => setForm({ ...form, alias: e.target.value })} placeholder="可选" /></Field>
          </div>
          <div className="row">
            <Field label="优先级"><input type="number" value={form.priority} onChange={(e) => setForm({ ...form, priority: +e.target.value })} /></Field>
            <Field label="启用"><div className="mt8"><Switch checked={!!form.enabled} onChange={(v) => setForm({ ...form, enabled: v })} /></div></Field>
          </div>
          <div className="modal-actions">
            <button className="btn secondary" onClick={() => setShow(false)}>取消</button>
            <button className="btn" onClick={save}>保存</button>
          </div>
        </Modal>
      )}

      {rOpen && (
        <Modal title={rEditId ? '编辑路由规则' : '新建路由规则'} onClose={() => setROpen(false)} className="wide">
          <Field label="客户端模型名" hint="客户端请求里填的 model 名，例如 auto、local、gpt-fast">
            <input value={rForm.name} onChange={(e) => setRForm({ ...rForm, name: e.target.value })} placeholder="auto" />
          </Field>
          <Field label="路由策略" hint={ROUTE_STRATEGIES.find((x) => x.value === rForm.strategy)?.label}>
            <select value={rForm.strategy} onChange={(e) => setRForm({ ...rForm, strategy: e.target.value })}>
              {ROUTE_STRATEGIES.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
            </select>
          </Field>

          <div className="mt16" style={{ borderTop: '1px solid var(--border)', paddingTop: 14 }}>
            <div>
              <strong style={{ fontSize: 13 }}>上游目标（可多选）</strong>
              <div className="hint" style={{ marginTop: 2 }}>勾选要加入的模型，支持一次全选；故障转移 / 轮询按勾选（添加）顺序生效，加权按权重随机。</div>
            </div>
            {state.models.length === 0 ? (
              <div className="empty mt8" style={{ padding: 18 }}>模型池是空的，先到下方「上游模型（模型池）」把模型加进来，再建路由。</div>
            ) : (
              <>
                <div className="flex between center mt8" style={{ gap: 8, alignItems: 'center' }}>
                  <span className="muted" style={{ fontSize: 12 }}>
                    共 {state.models.length} 个 · 已选 {rForm.targets.length} 个{rFilter ? ` · 筛选出 ${rShown.length} 个` : ''}
                  </span>
                  <div className="flex gap8">
                    <button className="btn ghost sm" onClick={() => rPickShown(true)}>{rFilter ? `全选筛选结果（${rShown.length}）` : '全选'}</button>
                    <button className="btn ghost sm" onClick={() => rPickShown(false)}>全不选</button>
                    <button className="btn ghost sm" onClick={rInvertShown}>反选</button>
                  </div>
                </div>
                <div className="pick-box mt8">
                  <div className="pick-head">
                    <input type="text" placeholder="搜索模型名 / 频道…" value={rFilter} onChange={(e) => setRFilter(e.target.value)} />
                  </div>
                  <div className="pick-list" style={{ maxHeight: 280 }}>
                    {rShown.map((m: ModelEntry) => {
                      const idx = rForm.targets.findIndex((t: any) => t.modelId === m.id);
                      const t = idx >= 0 ? rForm.targets[idx] : null;
                      return (
                        <label key={m.id} className="pick-item">
                          <input
                            type="checkbox"
                            checked={!!t}
                            onChange={(e) => rToggle(m, e.target.checked)}
                          />
                          <span className="nm">{m.name} → {m.upstreamModel}</span>
                          {t && rForm.strategy !== 'weighted' && rForm.targets.length > 1 && (
                            <span className="muted" style={{ fontSize: 11 }}>#{idx + 1}</span>
                          )}
                          {t && rForm.strategy === 'weighted' && (
                            <input
                              type="number" min={1} value={t.weight} title="权重"
                              onChange={(e) => rSetWeight(m, Math.max(1, +e.target.value || 1))}
                              onClick={(e) => e.stopPropagation()}
                              style={{ width: 74 }}
                            />
                          )}
                        </label>
                      );
                    })}
                    {rShown.length === 0 && <div className="empty" style={{ padding: 22 }}>没有匹配的模型</div>}
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="row mt16">
            <Field label="启用"><div className="mt8"><Switch checked={!!rForm.enabled} onChange={(v) => setRForm({ ...rForm, enabled: v })} /></div></Field>
          </div>

          <div className="modal-actions">
            <button className="btn secondary" onClick={() => setROpen(false)}>取消</button>
            <button className="btn" onClick={saveRoute}>保存</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// =================== Tokens ===================
export function Tokens({ state, refresh }: { state: State; refresh: () => void }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [created, setCreated] = useState<Token | null>(null);

  const add = async () => {
    const t = await api.addToken({ name: name || 'token' }); setCreated(t); setName(''); refresh();
  };

  return (
    <div>
      <h1>客户端令牌</h1>
      <p className="lead">开启「强制令牌」后，客户端请求必须携带这里的 Access Key。</p>
      <div className="flex gap8 center" style={{ marginBottom: 16 }}>
        <input placeholder="令牌名称" value={name} onChange={(e) => setName(e.target.value)} style={{ maxWidth: 240 }} />
        <button className="btn" onClick={add}>+ 生成</button>
      </div>

      {created && (
        <Card className="mt16" style={{ borderColor: 'var(--green)' }}>
          <strong>已生成，请复制保存（仅显示一次）：</strong>
          <div className="flex gap8 center mt8">
            <code className="code" style={{ flex: 1 }}>{created.key}</code>
            <CopyBtn text={created.key} />
          </div>
        </Card>
      )}

      <Card className="mt16">
        <table>
          <thead><tr><th>名称</th><th>Key</th><th>状态</th><th>创建时间</th><th></th></tr></thead>
          <tbody>
            {state.tokens.map((t) => (
              <tr key={t.id}>
                <td>{t.name}</td>
                <td>
                  <div className="flex gap8 center">
                    <code>{t.key.slice(0, 10)}…{t.key.slice(-4)}</code>
                    <CopyBtn text={t.key} label="复制" />
                  </div>
                </td>
                <td>{t.enabled ? <Badge kind="green">启用</Badge> : <Badge kind="gray">停用</Badge>}</td>
                <td className="muted">{timeStr(t.createdAt)}</td>
                <td><button className="btn ghost sm" onClick={() => { if (confirm('删除该令牌？')) { api.deleteToken(t.id); refresh(); } }}>删</button></td>
              </tr>
            ))}
            {state.tokens.length === 0 && <tr><td colSpan={5} className="empty">还没有令牌</td></tr>}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

// =================== Logs ===================
export function Logs({ state, refresh }: { state: State; refresh: () => void }) {
  const [rows, setRows] = useState<any>({ rows: [], total: 0 });
  const [page, setPage] = useState(1);
  const [success, setSuccess] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = () => {
    const q: any = { page, pageSize: 30 };
    if (success === 'true' || success === 'false') q.success = success;
    api.logs(q).then(setRows).catch(() => {});
  };
  useEffect(() => { load(); }, [page, success]);

  return (
    <div>
      <div className="flex between center">
        <div><h1>请求日志</h1><p className="lead">滚动存储，上限由设置控制，绝不无限膨胀。</p></div>
        <button className="btn danger sm" onClick={() => { if (confirm('清空日志？')) { api.clearLogs(); setPage(1); load(); } }}>清空日志</button>
      </div>

      <div className="flex gap8 center mt16">
        <select value={success} onChange={(e) => { setSuccess(e.target.value); setPage(1); }}>
          <option value="">全部</option>
          <option value="true">仅成功</option>
          <option value="false">仅失败</option>
        </select>
        <span className="muted">共 {rows.total} 条</span>
      </div>

      <Card className="mt16">
        <table>
          <thead><tr><th>时间</th><th>结果</th><th>模型</th><th>频道</th><th>协议</th><th>状态</th><th>耗时</th><th>Token</th></tr></thead>
          <tbody>
            {rows.rows.map((r: any, i: number) => (
              <React.Fragment key={i}>
                <tr onClick={() => setExpanded(expanded === r.ts + '' + i ? null : r.ts + '' + i)} style={{ cursor: 'pointer' }}>
                  <td className="muted">{timeStr(r.ts)}</td>
                  <td>{r.success ? <Badge kind="green">成功</Badge> : <Badge kind="red">失败</Badge>}</td>
                  <td><code>{r.model}</code></td>
                  <td>{r.channelName || '—'}</td>
                  <td className="muted">{r.protocol}</td>
                  <td>{r.status || '—'}</td>
                  <td className="muted">{r.latencyMs}ms</td>
                  <td className="muted">{r.totalTokens || 0}</td>
                </tr>
                {expanded === r.ts + '' + i && (
                  <tr><td colSpan={8} style={{ background: 'var(--panel-2)' }}>
                    <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>上游尝试路径：</div>
                    <div className="code">{(r.attempts || []).map((a: any) => `${a.channel} / ${a.model} → ${a.skipped ? '跳过(' + a.reason + ')' : (a.status ? 'HTTP ' + a.status + (a.fatal ? ' 致命' : '') : '错误: ' + (a.error || ''))}`).join('\n') || '（无）'}</div>
                  </td></tr>
                )}
              </React.Fragment>
            ))}
            {rows.rows.length === 0 && <tr><td colSpan={8} className="empty">暂无日志</td></tr>}
          </tbody>
        </table>
        <div className="flex between center mt16">
          <button className="btn secondary sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>上一页</button>
          <span className="muted">第 {page} 页</span>
          <button className="btn secondary sm" disabled={rows.rows.length < 30} onClick={() => setPage((p) => p + 1)}>下一页</button>
        </div>
      </Card>
    </div>
  );
}

// =================== Connectors ===================
export function Connectors({ state }: { state: State }) {
  const [snippet, setSnippet] = useState<any>(null);
  const tools = ['claude', 'opencode', 'codex', 'zed'];
  const open = async (t: string) => { const s = await api.connector(t); setSnippet({ t, s }); };
  return (
    <div>
      <h1>App 连接器</h1>
      <p className="lead">一键生成常见 AI 工具的接入配置，把流量导到本网关。</p>
      <div className="grid cols-2 mt16">
        {tools.map((t) => (
          <Card key={t} className="flex between center">
            <div><strong>{t}</strong><div className="muted" style={{ fontSize: 12 }}>生成 {t} 接入片段</div></div>
            <button className="btn" onClick={() => open(t)}>生成</button>
          </Card>
        ))}
      </div>
      {snippet && (
        <Modal title={`${snippet.t} 接入配置`} onClose={() => setSnippet(null)}>
          <p className="muted">{snippet.s.note}</p>
          {snippet.s.env && <div className="mt8"><div className="muted" style={{ fontSize: 12 }}>环境变量</div><div className="code mt8">{JSON.stringify(snippet.s.env, null, 2)}</div></div>}
          {snippet.s.config && <div className="mt8"><div className="muted" style={{ fontSize: 12 }}>配置</div><div className="code mt8">{JSON.stringify(snippet.s.config, null, 2)}</div></div>}
          <div className="modal-actions"><CopyBtn text={JSON.stringify(snippet.s.env || snippet.s.config, null, 2)} label="复制配置" /></div>
        </Modal>
      )}
    </div>
  );
}

// =================== Settings ===================
export function Settings({ state, refresh, setState }: { state: State; refresh: () => void; setState: any }) {
  const toast = useToast();
  const [s, setS] = useState({ ...state.settings });

  const save = async (patch: any) => {
    const ns = { ...s, ...patch }; setS(ns); setState((prev: State) => ({ ...prev, settings: ns }));
    await api.saveSettings(patch);
    if ('theme' in patch) applyTheme(ns.theme);
    toast('已保存'); refresh();
  };

  return (
    <div>
      <h1>设置</h1>
      <p className="lead">端口修改后需重启应用生效。</p>

      <Card>
        <h3 style={{ marginTop: 0 }}>端口</h3>
        <div className="row">
          <Field label="代理端口（客户端接入）"><input type="number" value={s.proxyPort} onChange={(e) => setS({ ...s, proxyPort: +e.target.value })} /></Field>
          <Field label="管理端口（Web Admin）"><input type="number" value={s.adminPort} onChange={(e) => setS({ ...s, adminPort: +e.target.value })} /></Field>
        </div>
        <div className="flex gap8">
          <button className="btn secondary sm" onClick={() => save({ proxyPort: s.proxyPort })}>保存端口</button>
        </div>
      </Card>

      <Card className="mt16">
        <h3 style={{ marginTop: 0 }}>安全</h3>
        <div className="flex between center mt8">
          <div><div>强制客户端令牌</div><div className="muted" style={{ fontSize: 12 }}>开启后客户端必须带 Access Key</div></div>
          <Switch checked={s.enforceToken} onChange={(v) => save({ enforceToken: v })} />
        </div>
        <Field label="Web Admin 管理口令" hint="留空则浏览器访问也无需登录"><input value={s.adminToken} onChange={(e) => setS({ ...s, adminToken: e.target.value })} placeholder="建议设置一个" /></Field>
        <button className="btn secondary sm" onClick={() => save({ adminToken: s.adminToken })}>保存口令</button>
      </Card>

      <Card className="mt16">
        <h3 style={{ marginTop: 0 }}>容错参数</h3>
        <div className="row">
          <Field label="模型冷却时长(ms)"><input type="number" value={s.cooldownMs} onChange={(e) => setS({ ...s, cooldownMs: +e.target.value })} /></Field>
          <Field label="熔断阈值(次)"><input type="number" value={s.breakerThreshold} onChange={(e) => setS({ ...s, breakerThreshold: +e.target.value })} /></Field>
        </div>
        <div className="row">
          <Field label="熔断半开(ms)"><input type="number" value={s.breakerResetMs} onChange={(e) => setS({ ...s, breakerResetMs: +e.target.value })} /></Field>
          <Field label="频道冻结(ms)"><input type="number" value={s.channelFreezeMs} onChange={(e) => setS({ ...s, channelFreezeMs: +e.target.value })} /></Field>
        </div>
        <Field label="空流保护超时(ms)" hint="上游 200 但迟迟不出字，判定失败并切换"><input type="number" value={s.emptyStreamTimeoutMs} onChange={(e) => setS({ ...s, emptyStreamTimeoutMs: +e.target.value })} /></Field>
        <button className="btn secondary sm" onClick={() => save({ cooldownMs: s.cooldownMs, breakerThreshold: s.breakerThreshold, breakerResetMs: s.breakerResetMs, channelFreezeMs: s.channelFreezeMs, emptyStreamTimeoutMs: s.emptyStreamTimeoutMs })}>保存容错参数</button>
      </Card>

      <Card className="mt16">
        <h3 style={{ marginTop: 0 }}>日志与外观</h3>
        <div className="row">
          <Field label="日志上限(字节)"><input type="number" value={s.logCapBytes} onChange={(e) => setS({ ...s, logCapBytes: +e.target.value })} /></Field>
          <Field label="日志上限(行)"><input type="number" value={s.logCapLines} onChange={(e) => setS({ ...s, logCapLines: +e.target.value })} /></Field>
        </div>
        <div className="row">
          <Field label="主题">
            <select value={s.theme} onChange={(e) => setS({ ...s, theme: e.target.value as any })}>
              <option value="light">浅色</option><option value="dark">深色</option><option value="auto">跟随系统</option>
            </select>
          </Field>
          <Field label="排序模式">
            <select value={s.orderMode} onChange={(e) => setS({ ...s, orderMode: e.target.value as any })}>
              <option value="custom">自定义优先级</option><option value="newest">最新优先</option><option value="fastest">最快优先</option>
            </select>
          </Field>
        </div>
        <div className="flex gap8">
          <button className="btn secondary sm" onClick={() => save({ logCapBytes: s.logCapBytes, logCapLines: s.logCapLines })}>保存日志上限</button>
          <button className="btn sm" onClick={() => save({ theme: s.theme, orderMode: s.orderMode })}>保存外观</button>
        </div>
      </Card>
      <p className="muted mt16">当前日志上限约 {fmtBytes(s.logCapBytes)}，相比原版动辄 30G 的整库备份，从设计上已杜绝膨胀。</p>
    </div>
  );
}
