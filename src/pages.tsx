import React, { useEffect, useRef, useState } from 'react';
import { api } from './api';
import type { State, Channel, ModelEntry, Token, RouteRule, RouteStrategy } from './types';
import { Card, Modal, Switch, Field, Badge, KPI, Bar, useToast, applyTheme, IconTrash, IconExternal } from './components';

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
            {stats && (() => {
              // byModel 值为 { count, tokens }（0.2.0 起），按请求数排序展示
              const rows = Object.entries(stats.byModel || {}) as [string, { count: number; tokens: number }][];
              rows.sort((a, b) => b[1].count - a[1].count);
              const max = Math.max(1, ...rows.map(([, v]) => v.count));
              return rows.slice(0, 8).map(([m, v]) => (
                <div key={m} style={{ marginBottom: 10 }}>
                  <div className="flex between" style={{ fontSize: 12 }}>
                    <span>{m}</span>
                    <span className="muted">{v.count} 次 · {fmtCompact(v.tokens)} tokens</span>
                  </div>
                  <div className="mt8"><Bar value={v.count} max={max} /></div>
                </div>
              ));
            })()}
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
const emptyChannel = (): ChForm => ({ protocol: 'openai', enabled: true, priority: 100, name: '', baseUrl: '', apiKey: '', extraHeaders: {} });

// 额外请求头编辑器（键值对）。用于给「要求自定义转发密钥」的上游补 header。
function ExtraHeadersEditor({ rows, onChange }: { rows: { k: string; v: string }[]; onChange: (r: { k: string; v: string }[]) => void }) {
  const upd = (i: number, patch: Partial<{ k: string; v: string }>) =>
    onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  return (
    <div>
      {rows.map((r, i) => (
        <div key={i} className="hdr-row">
          <input className="hdr-k" placeholder="请求头名称，如 x-forward-secret" value={r.k} onChange={(e) => upd(i, { k: e.target.value })} />
          <input className="hdr-v" placeholder="值" value={r.v} onChange={(e) => upd(i, { v: e.target.value })} />
          <button
            type="button" className="btn icon danger" title="删除该请求头" aria-label="删除该请求头"
            onClick={() => onChange(rows.filter((_, idx) => idx !== i))}
          >
            <IconTrash />
          </button>
        </div>
      ))}
      <button type="button" className="btn ghost sm" onClick={() => onChange([...rows, { k: '', v: '' }])}>+ 添加请求头</button>
    </div>
  );
}

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
  const [headerRows, setHeaderRows] = useState<{ k: string; v: string }[]>([]);
  const [fetchError, setFetchError] = useState<any>(null);
  const pickRef = useRef<HTMLDivElement | null>(null);

  // 拉取完成后把结果列表滚进视野（弹窗比屏幕高时，否则要手动往下拉才看得到）
  useEffect(() => {
    if (fetched.length) pickRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [fetched.length]);

  const isEdit = !!form.id;
  const inPool = (name: string) => state.models.some((m) => m.channelId === form.id && (m.upstreamModel || m.name) === name);

  const openNew = () => {
    setForm(emptyChannel()); setFetched([]); setPicked({}); setFilter('');
    setHeaderRows([]); setFetchError(null);
    setAddGroup(state.settings.autoGroup); setOpen(true);
  };
  const openEdit = (c: Channel) => {
    setForm({ ...c }); setFetched([]); setPicked({}); setFilter('');
    setHeaderRows(Object.entries(c.extraHeaders || {}).map(([k, v]) => ({ k, v })));
    setFetchError(null);
    setAddGroup(state.settings.autoGroup); setOpen(true);
  };

  // 把「额外请求头」编辑行合并进表单（忽略空键）
  const withHeaders = (f: ChForm): ChForm => ({
    ...f,
    extraHeaders: Object.fromEntries(headerRows.filter((h) => h.k.trim()).map((h) => [h.k.trim(), h.v])),
  });

  // 保存表单（新建则创建），返回频道 id。
  // 拉取模型前先落库，否则用的还是旧的 baseUrl / apiKey。
  const persist = async (): Promise<string | null> => {
    const payload = withHeaders(form);
    if (!payload.name || !payload.baseUrl) { toast('请先填写名称与 Base URL'); return null; }
    if (payload.id) { await api.updateChannel(payload.id, payload); await refresh(); return payload.id; }
    const c: any = await api.addChannel(payload);
    setForm((f) => ({ ...f, id: c.id }));
    await refresh();
    return c.id;
  };

  const doProbe = async (id: string) => {
    setProbe((p) => ({ ...p, [id]: { loading: true } }));
    const r = await api.probeChannel(id);
    setProbe((p) => ({ ...p, [id]: r }));
    if (r && r.ok === false) {
      toast(`探测失败：${r.error || '未知错误'}${r.hint ? '（' + r.hint + '）' : ''}`);
    }
  };

  const doFetch = async () => {
    const id = await persist();
    if (!id) return;
    setBusy(true);
    setFetchError(null);
    try {
      const r: any = await api.fetchModels(id);
      if (!r.ok) {
        setFetchError(r);
        toast('拉取失败：' + (r.error || '未知错误'));
        return;
      }
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
                  <td>
                    <div className="probe-cell">
                      <button className="btn ghost sm" onClick={() => doProbe(c.id)}>{probe[c.id]?.loading ? '探测中…' : '探测'}</button>
                      {probe[c.id]?.ok && !probe[c.id]?.loading && <Badge kind="green">{probe[c.id].latencyMs}ms</Badge>}
                      {probe[c.id] && probe[c.id].ok === false && !probe[c.id]?.loading && (
                        <Badge kind={probe[c.id].authFail ? 'yellow' : 'red'} title={[probe[c.id].error, probe[c.id].hint].filter(Boolean).join(' ')}>
                          {probe[c.id].authFail ? '鉴权失败' : '不通'}
                        </Badge>
                      )}
                    </div>
                  </td>
                  <td>
                    <div className="row-actions">
                      <button className="btn ghost sm" onClick={() => openEdit(c)}>编辑 / 拉模型</button>
                      <button
                        className="btn icon danger" title="删除该频道及其模型" aria-label="删除频道"
                        onClick={() => { if (confirm('删除该频道及其模型？')) { api.deleteChannel(c.id); refresh(); } }}
                      >
                        <IconTrash size={15} />
                      </button>
                    </div>
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

          <div className="mt16">
            <strong style={{ fontSize: 13 }}>额外请求头（可选）</strong>
            <div className="hint" style={{ marginTop: 2 }}>
              部分中转站（如 Modal、One API 系）要求额外的转发密钥头。只填 Authorization 会返回 401「missing forward secret」，
              在下面补上该站点要求的请求头即可正常探测与拉取模型。
            </div>
            <div className="mt8">
              <ExtraHeadersEditor rows={headerRows} onChange={setHeaderRows} />
            </div>
          </div>

          <div className="mt16" style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
            <div className="flex between center">
              <div>
                <strong style={{ fontSize: 13 }}>模型</strong>
                <div className="hint" style={{ marginTop: 2 }}>拉取上游可用模型，自己勾选要加入模型池的（不必全加）。拉取前会自动保存本页配置。</div>
              </div>
              <button className="btn secondary sm" disabled={busy} onClick={doFetch}>{busy ? '处理中…' : '拉取模型'}</button>
            </div>

            {fetchError && (
              <div className={`inline-error mt8 ${fetchError.authFail ? 'warn' : ''}`}>
                <strong>{fetchError.authFail ? '鉴权失败，拉不到模型' : '拉取失败'}</strong>
                <div>{fetchError.error}</div>
                {fetchError.authFail && <div className="hint">可在上方「额外请求头」补上该中转站要求的转发密钥头，再点「拉取模型」重试。</div>}
              </div>
            )}

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
                <td>
                  <div className="row-actions">
                    <button className="btn ghost sm" onClick={() => openEditRoute(r)}>编辑</button>
                    <button className="btn icon danger" title="删除该路由" aria-label="删除路由" onClick={() => { if (confirm('删除该路由？')) { api.deleteRoute(r.id); refresh(); } }}><IconTrash /></button>
                  </div>
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
                  <td>
                    <div className="row-actions">
                      {(m.disabled || cooled) && <button className="btn ghost sm" onClick={() => reset(m.id)}>重置</button>}
                      <button className="btn icon danger" title="删除该模型" aria-label="删除模型" onClick={() => { if (confirm('删除该模型？')) { api.deleteModel(m.id); refresh(); } }}><IconTrash /></button>
                    </div>
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
                <td>
                  <div className="row-actions">
                    <button className="btn icon danger" title="删除该令牌" aria-label="删除令牌" onClick={() => { if (confirm('删除该令牌？')) { api.deleteToken(t.id); refresh(); } }}><IconTrash /></button>
                  </div>
                </td>
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

// =================== Stats（统计）==================
function fmtCompact(n: number) {
  const v = n || 0;
  if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
  if (v >= 1e3) return (v / 1e3).toFixed(2) + 'K';
  return String(v);
}

// 热力图颜色档位（按请求数）：0 / 少 / 中 / 多 / 很多
function heatLevel(count: number) {
  if (!count) return 0;
  if (count < 5) return 1;
  if (count < 20) return 2;
  if (count < 60) return 3;
  return 4;
}

export function Stats({ state }: { state: State }) {
  const [stats, setStats] = useState<any>(null);
  const [tab, setTab] = useState<'year' | '30d'>('year');
  const [metric, setMetric] = useState<'count' | 'tokens'>('count');
  const [provTab, setProvTab] = useState<'provider' | 'model'>('provider');
  const load = () => api.logStats().then(setStats).catch(() => {});
  useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t); }, []);

  const hm = stats?.heatmap || [];
  const t30 = stats?.trend30 || [];

  // 热力图按周组织：第一列补齐到周日开始，之后每 7 天一列
  const weeks: { date: string; count: number; tokens: number }[][] = [];
  let cur: { date: string; count: number; tokens: number }[] = [];
  hm.forEach((d: any) => {
    const dow = (new Date(d.date + 'T00:00:00').getDay() + 6) % 7; // 周一=0
    if (cur.length === 0 && dow > 0) { for (let i = 0; i < dow; i++) cur.push({ date: '', count: -1, tokens: 0 }); }
    cur.push(d);
    if (cur.length === 7) { weeks.push(cur); cur = []; }
  });
  if (cur.length) weeks.push(cur);

  // 月份标签：每月第一列的位置
  const monthLabels: { idx: number; label: string }[] = [];
  let lastMonth = -1;
  weeks.forEach((w, i) => {
    const first = w.find((d) => d.date);
    if (!first) return;
    const m = new Date(first.date + 'T00:00:00').getMonth();
    if (m !== lastMonth) { monthLabels.push({ idx: i, label: `${m + 1}月` }); lastMonth = m; }
  });
  const DOW = ['一', '三', '五', '日'];

  const providerRows = Object.entries(stats?.byChannel || {}).sort((a: any, b: any) => b[1].tokens - a[1].tokens);
  const modelRows = Object.entries(stats?.byModel || {}).sort((a: any, b: any) => b[1].tokens - a[1].tokens);

  return (
    <div>
      <h1>统计</h1>
      <p className="lead">请求与 Token 用量的长期统计，全部基于本机日志计算。</p>

      {/* 今日统计 */}
      <Card className="today-card">
        <div className="today-label">今日统计</div>
        <div className="today-grid">
          <div className="today-item">
            <div className="tv">{fmtNum(stats?.today?.count)}</div>
            <div className="tl">今日调用次数</div>
          </div>
          <div className="today-item">
            <div className="tv">{fmtCompact(stats?.today?.tokens)}</div>
            <div className="tl">今日 Token</div>
          </div>
        </div>
        <div className="all-grid">
          <div className="today-item">
            <div className="tv">{fmtNum(stats?.total)}</div>
            <div className="tl">总请求数</div>
          </div>
          <div className="today-item">
            <div className="tv">{fmtCompact(stats?.totalTokens)}</div>
            <div className="tl">TOKEN 消耗</div>
          </div>
          <div className="today-item">
            <div className="tv">{fmtNum(stats?.avgPerDay)}</div>
            <div className="tl">日均请求</div>
          </div>
        </div>
        <div className="pc-row">
          <span>Prompt <b className="accent">{fmtCompact(stats?.promptTokens)}</b></span>
          <span>Completion <b className="accent">{fmtCompact(stats?.completionTokens)}</b></span>
        </div>
      </Card>

      {/* 热力图 / 30 天趋势 */}
      <Card className="mt16">
        <div className="seg-tabs">
          <button className={`seg-tab ${tab === 'year' ? 'active' : ''}`} onClick={() => setTab('year')}>全年热力图</button>
          <button className={`seg-tab ${tab === '30d' ? 'active' : ''}`} onClick={() => setTab('30d')}>30 天趋势</button>
        </div>

        {tab === 'year' && (
          <>
            <div className="seg-pills mt8">
              <button className={`pill ${metric === 'count' ? 'active' : ''}`} onClick={() => setMetric('count')}>请求数</button>
              <button className={`pill ${metric === 'tokens' ? 'active' : ''}`} onClick={() => setMetric('tokens')}>Token</button>
            </div>
            <div className="heatmap-wrap">
              <div className="hm-months">
                {weeks.map((_, i) => {
                  const lab = monthLabels.find((m) => m.idx === i);
                  return <span key={i}>{lab ? lab.label : ''}</span>;
                })}
              </div>
              <div className="hm-flex">
                <div className="hm-dow">
                  {DOW.map((d) => <span key={d}>{d}</span>)}
                </div>
                <div className="hm-scroll">
                  <div className="hm-grid">
                    {weeks.map((w, wi) => (
                      <div key={wi} className="hm-col">
                        {w.map((d, di) => (
                          <div
                            key={di}
                            className={`hm-cell lv${d.count < 0 ? 'x' : heatLevel(metric === 'count' ? d.count : d.tokens)}`}
                            title={d.date ? `${d.date} · ${d.count} 次 · ${d.tokens} tokens` : ''}
                          />
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div className="hm-legend">少 <span className="hm-cell lv0" /><span className="hm-cell lv1" /><span className="hm-cell lv2" /><span className="hm-cell lv3" /><span className="hm-cell lv4" /> 多</div>
            </div>
          </>
        )}

        {tab === '30d' && (
          <div className="trend30 mt8">
            {t30.map((d: any) => {
              const max = Math.max(1, ...t30.map((x: any) => (metric === 'count' ? x.count : x.tokens)));
              const h = Math.round(((metric === 'count' ? d.count : d.tokens) / max) * 72);
              return (
                <div key={d.date} className="t30-col" title={`${d.date} · ${d.count} 次 · ${d.tokens} tokens`}>
                  <div className="t30-bar" style={{ height: Math.max(2, h) }} />
                  <div className="t30-day">{new Date(d.date + 'T00:00:00').getDate()}</div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* 提供商 / 模型 */}
      <Card className="mt16">
        <div className="seg-tabs">
          <button className={`seg-tab ${provTab === 'provider' ? 'active' : ''}`} onClick={() => setProvTab('provider')}>提供商</button>
          <button className={`seg-tab ${provTab === 'model' ? 'active' : ''}`} onClick={() => setProvTab('model')}>模型</button>
        </div>
        <div className="mt8">
          {(provTab === 'provider' ? providerRows : modelRows).map(([name, v]: any) => (
            <div key={name} className="stat-row">
              <span className="stat-name">{name}</span>
              <span className="stat-nums">
                <b className="accent">{fmtCompact(v.tokens)}</b>
                <span className="muted">{fmtNum(v.count)} 次</span>
              </span>
            </div>
          ))}
          {(provTab === 'provider' ? providerRows : modelRows).length === 0 && (
            <div className="empty">暂无数据，先去发几个请求</div>
          )}
        </div>
      </Card>
    </div>
  );
}

// =================== Settings ===================
// 行式设置布局：左侧标签 + 描述，右侧控件，行间分隔线（参照主流桌面客户端设置页）
function Row({ label, desc, children, borderBottom = true }: { label: string; desc?: string; children: React.ReactNode; borderBottom?: boolean }) {
  return (
    <div className={`set-row ${borderBottom ? 'bordered' : ''}`}>
      <div className="set-left">
        <div className="set-label">{label}</div>
        {desc && <div className="set-desc">{desc}</div>}
      </div>
      <div className="set-right">{children}</div>
    </div>
  );
}

// 橙色方形勾选框（勾选态填充 accent 色）
function CheckBox({ checked, onChange, disabled }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className={`cbx ${disabled ? 'dis' : ''}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="cbx-box">{checked && (
        <svg width="11" height="11" viewBox="0 0 12 12"><path d="M2 6.2 4.8 9 10 3.4" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
      )}</span>
    </label>
  );
}

export function Settings({ state, refresh, setState }: { state: State; refresh: () => void; setState: any }) {
  const toast = useToast();
  const [s, setS] = useState({ ...state.settings });
  const [autoLaunch, setAutoLaunch] = useState(false);
  const [ioBusy, setIoBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const isDesktop = !!(window as any).app;

  useEffect(() => {
    if (isDesktop) {
      (window as any).app.getAutoLaunch().then((r: any) => { if (r?.ok) setAutoLaunch(!!r.enabled); }).catch(() => {});
    }
  }, []);

  const save = async (patch: any) => {
    const ns = { ...s, ...patch }; setS(ns); setState((prev: State) => ({ ...prev, settings: ns }));
    await api.saveSettings(patch);
    if ('theme' in patch) applyTheme(ns.theme);
    toast('已保存'); refresh();
  };

  const toggleAutoLaunch = async (v: boolean) => {
    try {
      const r = await (window as any).app.setAutoLaunch(v);
      if (r?.ok) { setAutoLaunch(v); toast(v ? '已开启开机启动（下次开机自动后台运行）' : '已关闭开机启动'); }
      else toast('设置失败：' + (r?.error || '未知错误'));
    } catch (e: any) { toast('设置失败：' + (e?.message || e)); }
  };

  // 导出：把频道 + API Key + 模型池等打包下载为 JSON
  const doExport = async () => {
    setIoBusy(true);
    try {
      const data = await api.exportConfig();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `xuanshu-config-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      toast('已导出配置文件（含 API Key，请妥善保管）');
    } catch (e: any) { toast('导出失败：' + (e?.message || e)); }
    finally { setIoBusy(false); }
  };

  // 导入：支持玄枢导出（全量恢复）与 One API / New API 频道导出（追加）
  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    setIoBusy(true);
    try {
      const text = await f.text();
      let payload: any;
      try { payload = JSON.parse(text); } catch { toast('文件不是合法的 JSON'); return; }
      const isNative = payload?.app === 'xuanshu' || payload?.kind === 'config';
      const label = isNative ? '玄枢配置（全量恢复：替换现有频道/模型/令牌/路由）' : 'One API / New API 频道（追加导入）';
      if (!confirm(`将导入：${label}\n\n导入前会自动备份当前配置到 config.json.bak。继续？`)) return;
      const r: any = await api.importConfig(payload);
      if (r?.ok) {
        const c = r.counts || {};
        toast(`导入成功：${r.mode === 'replace' ? '已恢复' : '已追加'} · 频道 ${c.channels ?? 0}｜模型 ${c.models ?? 0}`);
        await refresh();
      } else {
        toast('导入失败：' + (r?.error || '未知错误'));
      }
    } catch (e: any) { toast('导入失败：' + (e?.message || e)); }
    finally { setIoBusy(false); }
  };

  return (
    <div>
      <h1>设置</h1>
      <p className="lead">勾选项与下拉框即时生效；输入框修改后自动保存，端口修改需重启应用。</p>

      <Card style={{ padding: '4px 18px' }}>
        <Row label="外观" desc="浅色 / 深色 / 跟随系统">
          <select value={s.theme} onChange={(e) => save({ theme: e.target.value })} className="set-ctl">
            <option value="light">浅色</option><option value="dark">深色</option><option value="auto">跟随系统</option>
          </select>
        </Row>

        <Row label="排序模式" desc="上游候选的挑选顺序">
          <select value={s.orderMode} onChange={(e) => save({ orderMode: e.target.value })} className="set-ctl">
            <option value="custom">自定义优先级</option><option value="newest">最新优先</option><option value="fastest">最快优先</option>
          </select>
        </Row>

        {isDesktop && (
          <Row label="开机启动" desc="开机后自动在后台运行，仅显示托盘图标，不弹窗口">
            <CheckBox checked={autoLaunch} onChange={toggleAutoLaunch} />
          </Row>
        )}

        <Row label="强制客户端令牌" desc="开启后客户端请求必须携带 Access Key">
          <CheckBox checked={s.enforceToken} onChange={(v) => save({ enforceToken: v })} />
        </Row>

        <Row label="Web Admin 管理口令" desc="浏览器访问管理页时需要；留空则免登录">
          <input value={s.adminToken} onChange={(e) => setS({ ...s, adminToken: e.target.value })} onBlur={() => save({ adminToken: s.adminToken })} placeholder="建议设置一个" className="set-ctl" style={{ maxWidth: 260 }} />
        </Row>

        <Row label="代理端口" desc="客户端接入端口，如 http://127.0.0.1:9090/v1">
          <input type="number" value={s.proxyPort} onChange={(e) => setS({ ...s, proxyPort: +e.target.value })} onBlur={() => save({ proxyPort: s.proxyPort })} className="set-ctl num" />
        </Row>

        <Row label="管理端口" desc="Web Admin / 桌面界面端口">
          <input type="number" value={s.adminPort} onChange={(e) => setS({ ...s, adminPort: +e.target.value })} onBlur={() => save({ adminPort: s.adminPort })} className="set-ctl num" />
        </Row>

        <Row label="接口重试" desc="上游返回可重试状态码时自动重试；429（欠费/限流）等无需重试的状态码请勿加入">
          <CheckBox checked={s.retryEnabled !== false} onChange={(v) => save({ retryEnabled: v })} />
        </Row>

        {s.retryEnabled !== false && (
          <>
            <Row label="可重试的状态码" desc="逗号分隔，仅对这些状态码做同目标重试">
              <input value={s.retryStatusCodes || ''} onChange={(e) => setS({ ...s, retryStatusCodes: e.target.value })} onBlur={() => save({ retryStatusCodes: s.retryStatusCodes })} placeholder="500, 502, 503, 504" className="set-ctl" style={{ maxWidth: 320 }} />
            </Row>
            <Row label="最大重试次数" desc="同一上游目标最多原地重试的次数">
              <input type="number" min={0} max={10} value={s.maxRetries ?? 3} onChange={(e) => setS({ ...s, maxRetries: +e.target.value })} onBlur={() => save({ maxRetries: s.maxRetries })} className="set-ctl num" />
            </Row>
            <Row label="重试间隔" desc="两次重试之间的等待时间">
              <div className="flex center gap8">
                <input type="number" min={0} max={60} value={s.retryIntervalSec ?? 2} onChange={(e) => setS({ ...s, retryIntervalSec: +e.target.value })} onBlur={() => save({ retryIntervalSec: s.retryIntervalSec })} className="set-ctl num" style={{ width: 110 }} />
                <span className="muted">秒</span>
              </div>
            </Row>
          </>
        )}

        <Row label="模型冷却时长" desc="请求失败后该模型暂停参与路由的时间">
          <div className="flex center gap8">
            <input type="number" value={s.cooldownMs} onChange={(e) => setS({ ...s, cooldownMs: +e.target.value })} onBlur={() => save({ cooldownMs: s.cooldownMs })} className="set-ctl num" style={{ width: 130 }} />
            <span className="muted">ms</span>
          </div>
        </Row>

        <Row label="熔断阈值" desc="连续失败达到该次数后打开熔断" borderBottom={false}>
          <input type="number" value={s.breakerThreshold} onChange={(e) => setS({ ...s, breakerThreshold: +e.target.value })} onBlur={() => save({ breakerThreshold: s.breakerThreshold })} className="set-ctl num" />
        </Row>
      </Card>

      <Card className="mt16" style={{ padding: '4px 18px' }}>
        <Row label="空流保护超时" desc="上游 200 但迟迟不出字，判定失败并切换">
          <div className="flex center gap8">
            <input type="number" value={s.emptyStreamTimeoutMs} onChange={(e) => setS({ ...s, emptyStreamTimeoutMs: +e.target.value })} onBlur={() => save({ emptyStreamTimeoutMs: s.emptyStreamTimeoutMs })} className="set-ctl num" style={{ width: 130 }} />
            <span className="muted">ms</span>
          </div>
        </Row>
        <Row label="熔断半开" desc="熔断后多久进入半开探测">
          <div className="flex center gap8">
            <input type="number" value={s.breakerResetMs} onChange={(e) => setS({ ...s, breakerResetMs: +e.target.value })} onBlur={() => save({ breakerResetMs: s.breakerResetMs })} className="set-ctl num" style={{ width: 130 }} />
            <span className="muted">ms</span>
          </div>
        </Row>
        <Row label="频道冻结" desc="空流触发后整个频道暂停的时间">
          <div className="flex center gap8">
            <input type="number" value={s.channelFreezeMs} onChange={(e) => setS({ ...s, channelFreezeMs: +e.target.value })} onBlur={() => save({ channelFreezeMs: s.channelFreezeMs })} className="set-ctl num" style={{ width: 130 }} />
            <span className="muted">ms</span>
          </div>
        </Row>
        <Row label="日志上限（大小）" desc="超出后自动滚动截断，只保留最近部分">
          <div className="flex center gap8">
            <input type="number" value={s.logCapBytes} onChange={(e) => setS({ ...s, logCapBytes: +e.target.value })} onBlur={() => save({ logCapBytes: s.logCapBytes })} className="set-ctl num" style={{ width: 130 }} />
            <span className="muted">字节（当前约 {fmtBytes(s.logCapBytes)}）</span>
          </div>
        </Row>
        <Row label="日志上限（行数）" desc="滚动截断时保留的行数" borderBottom={false}>
          <input type="number" value={s.logCapLines} onChange={(e) => setS({ ...s, logCapLines: +e.target.value })} onBlur={() => save({ logCapLines: s.logCapLines })} className="set-ctl num" />
        </Row>
      </Card>

      <Card className="mt16" style={{ padding: '4px 18px' }}>
        <Row label="导出配置" desc="把频道（含 Base URL / API Key）、模型池、分组、令牌、路由导出为 JSON，便于备份或迁移到另一台机器">
          <button className="btn secondary sm" disabled={ioBusy} onClick={doExport}>导出为 JSON</button>
        </Row>
        <Row label="导入配置" desc="支持玄枢导出的 JSON（全量恢复），以及 One API / New API 的频道导出（自动转换后追加）；导入前会备份当前配置" borderBottom={false}>
          <div className="flex center gap8">
            <input ref={fileRef} type="file" accept="application/json,.json" style={{ display: 'none' }} onChange={onPickFile} />
            <button className="btn secondary sm" disabled={ioBusy} onClick={() => fileRef.current?.click()}>选择 JSON 文件…</button>
          </div>
        </Row>
      </Card>
    </div>
  );
}

// =================== About（关于）==================
export function About({ state }: { state: State }) {
  const [about, setAbout] = useState<any>(null);
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<any>(null);

  useEffect(() => { api.about().then(setAbout).catch(() => {}); }, []);

  // 桌面端走系统浏览器打开；Web Admin 下退回 window.open
  const open = (url: string) => {
    const app = (window as any).app;
    if (app?.openExternal) app.openExternal(url);
    else window.open(url, '_blank', 'noopener');
  };

  const check = async () => {
    setChecking(true); setResult(null);
    try { setResult(await api.checkUpdate()); }
    catch (e: any) { setResult({ ok: false, error: e?.message || String(e) }); }
    finally { setChecking(false); }
  };

  const version = about?.version || state.version || '—';
  const repo = about?.repo || 'https://github.com/gncarl/XuanShu';
  const releases = about?.releases || `${repo}/releases`;

  return (
    <div>
      <h1>关于</h1>
      <p className="lead">玄枢 · 本地 AI 聚合路由网关</p>

      <Card className="about-card">
        <div className="about-head">
          <div className="about-logo">玄</div>
          <div>
            <div className="about-name">玄枢 <span className="about-ver">v{version}</span></div>
            <div className="muted" style={{ fontSize: 13 }}>把多个上游 AI 服务聚合成一个本地入口，带故障转移、重试与用量统计。</div>
          </div>
        </div>

        <div className="about-links">
          <button className="btn secondary sm" onClick={() => open(repo)}>GitHub 仓库 <IconExternal /></button>
          <button className="btn secondary sm" onClick={() => open(releases)}>发布页面 <IconExternal /></button>
          <button className="btn sm" disabled={checking} onClick={check}>{checking ? '检查中…' : '检查更新'}</button>
        </div>

        {result && (
          <div className={`about-result ${result.ok && result.hasUpdate ? 'has' : ''}`}>
            {!result.ok && <span>⚠️ 检查更新失败：{result.error}</span>}
            {result.ok && result.hasUpdate && (
              <span>
                发现新版本 <b>v{result.latest}</b>（当前 v{result.current}）。
                <button className="btn ghost sm" onClick={() => open(result.url || releases)}>前往下载</button>
              </span>
            )}
            {result.ok && !result.hasUpdate && (
              <span>✓ 已是最新版本（v{result.current}）{result.note ? ' · ' + result.note : ''}</span>
            )}
          </div>
        )}
      </Card>

      <Card className="mt16">
        <strong>运行信息</strong>
        <div className="kv mt8">
          <div className="kv-row"><span>软件版本</span><b>v{version}</b></div>
          <div className="kv-row"><span>代理端口</span><b>{state.settings.proxyPort}</b></div>
          <div className="kv-row"><span>管理端口</span><b>{state.settings.adminPort}</b></div>
          <div className="kv-row"><span>配置文件</span><b className="muted">%APPDATA%\ai-gateway\ai-gateway-data\config.json</b></div>
        </div>
      </Card>

      <Card className="mt16">
        <strong>隐私说明</strong>
        <p className="muted mt8" style={{ marginBottom: 0 }}>
          玄枢为本地自托管工具：所有频道配置、API Key、请求日志均只保存在你本机，不做任何云端上传。
        </p>
      </Card>
    </div>
  );
}
