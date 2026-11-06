import { useEffect, useState, type FormEvent } from 'react';
import { Download, RotateCcw, Trash2 } from 'lucide-react';
import { api, useData } from '../hooks/useData';
import { downloadBlob } from '../domain/downloads';
import type { DataStore } from '../domain/types';

type Backup = { revision: number; at: string; action: string; matches: number; referees: number };
const actionName = (action: string) => {
  if (action === '初始数据') return action;
  const [method, url] = action.split(' ');
  const kind = url?.includes('unavailability') ? '请假记录' : url?.includes('restore') ? '备份恢复' : url?.includes('import') ? '选派导入' : url?.includes('wage') ? '工资标准' : url?.includes('rules') ? '管理办法' : url?.includes('referees') ? '裁判档案' : url?.includes('adjustments') ? '奖惩记录' : '比赛选派';
  return `${method === 'DELETE' ? '删除' : method === 'PUT' ? '修改' : '保存'}${kind}`;
};

export default function OperationsManager() {
  const { data, refresh } = useData();
  const [refereeId, setRefereeId] = useState('');
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(today);
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [backups, setBackups] = useState<Backup[]>([]);
  const [candidate, setCandidate] = useState<{ data: DataStore; label: string } | null>(null);
  useEffect(() => { api<Backup[]>('/api/backups').then(setBackups).catch((e) => setMessage(e.message)); }, [data?.revision]);
  const run = async (task: () => Promise<void>) => {
    setBusy(true); setMessage('');
    try { await task(); } catch (e) { setMessage(e instanceof Error ? e.message : '操作失败'); } finally { setBusy(false); }
  };
  const addLeave = (event: FormEvent) => {
    event.preventDefault(); void run(async () => { await api('/api/unavailability', { method: 'POST', body: JSON.stringify({ refereeId, start, end, reason }) }); await refresh(); setReason(''); setMessage('请假已登记。如已有选派发生冲突，请到工作台处理。'); });
  };
  const download = (snapshot: unknown, label: string) => downloadBlob(`裁判平台备份-${label}.json`, JSON.stringify(snapshot, null, 2));
  const importFile = (file?: File) => {
    if (!file) return;
    void run(async () => {
      if (file.size > 5 * 1024 * 1024) throw new Error('备份文件不能超过 5 MB');
      const value = JSON.parse(await file.text());
      const snapshot = value.data || value;
      if (snapshot.version !== 1 || !Array.isArray(snapshot.referees) || !Array.isArray(snapshot.matches) || !Array.isArray(snapshot.adjustments)) throw new Error('不是有效的平台备份文件');
      setCandidate({ data: snapshot, label: file.name });
    });
  };
  return <section className="admin-section">
    <div className="admin-section-heading"><div><h2>请假与可用时间</h2><p>按北京时间登记整日不可用日期。新增请假会提醒已有选派冲突，后续选派自动拦截。</p></div></div>
    <form className="admin-form" onSubmit={addLeave}><div className="form-grid two-cols"><label>裁判员<select aria-label="请假裁判员" required value={refereeId} onChange={(e) => setRefereeId(e.target.value)}><option value="">请选择裁判员</option>{[...data!.referees].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></label><label>请假事由<input value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder="可选，如课程冲突、考试" /></label><label>开始日期<input required type="date" value={start} onChange={(e) => { setStart(e.target.value); if (e.target.value > end) setEnd(e.target.value); }} /></label><label>结束日期<input required type="date" min={start} value={end} onChange={(e) => setEnd(e.target.value)} /></label></div><div className="form-actions"><button className="button primary" disabled={busy}>登记请假</button></div></form>
    <div className="leave-list">{[...(data!.unavailability || [])].sort((a, b) => b.start.localeCompare(a.start)).map((l) => <div className="operation-row" key={l.id}><div><strong>{data!.referees.find((r) => r.id === l.refereeId)?.name}</strong><p>{l.start} 至 {l.end} · {l.reason || '未填写事由'}</p></div><button className="icon-button danger-text" disabled={busy} aria-label="删除请假" onClick={() => { if (confirm('确定删除这条请假记录？')) void run(async () => { await api(`/api/unavailability/${l.id}`, { method: 'DELETE' }); await refresh(); }); }}><Trash2 size={16} /></button></div>)}{!data!.unavailability?.length && <p className="inline-empty">暂无请假记录</p>}</div>
    <div className="admin-section-heading backup-heading"><div><h2>数据备份与操作历史</h2><p>每次保存自动保留完整版本。恢复会创建新版本，原有历史仍然保留。</p></div><div className="admin-heading-actions"><button className="button secondary" onClick={() => download({ format: 'pkufa-referees-v1', exportedAt: new Date().toISOString(), data }, new Date().toISOString().slice(0, 10))}><Download size={16} />下载完整备份</button><label className="button secondary file-button">导入备份<input type="file" accept=".json,application/json" hidden disabled={busy} onChange={(e) => { importFile(e.target.files?.[0]); e.target.value = ''; }} /></label></div></div>
    {candidate && <div className="restore-review"><h3>恢复预览：{candidate.label}</h3><p>当前 {data!.referees.length} 名裁判 / {data!.matches.length} 场比赛 / {data!.adjustments.length} 条奖惩</p><p>备份 {candidate.data.referees.length} 名裁判 / {candidate.data.matches.length} 场比赛 / {candidate.data.adjustments.length} 条奖惩</p><p>确认后将用该备份替换当前业务数据，系统保留恢复前的完整版本。</p><div className="form-actions"><button className="button secondary" disabled={busy} onClick={() => setCandidate(null)}>取消</button><button className="button primary" disabled={busy} onClick={() => void run(async () => { await api('/api/restore', { method: 'POST', body: JSON.stringify({ data: candidate.data }) }); await refresh(); setCandidate(null); setMessage('恢复完成，已创建新版本。'); })}><RotateCcw size={16} />确认恢复</button></div></div>}
    <div className="backup-table-wrap"><table className="records-table"><thead><tr><th>版本</th><th>北京时间</th><th>操作</th><th>内容</th><th>备份操作</th></tr></thead><tbody>{backups.map((b) => <tr key={b.revision}><td>v{b.revision}</td><td>{new Date(b.at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</td><td>{actionName(b.action)}</td><td>{b.referees} 人 / {b.matches} 场</td><td><div className="backup-actions"><button className="button secondary" disabled={busy} onClick={() => void run(async () => { const snapshot = await api<{ data: DataStore }>(`/api/backups/${b.revision}`); download(snapshot, `v${b.revision}`); })}>下载</button><button className="button secondary" disabled={busy} onClick={() => void run(async () => { const snapshot = await api<{ data: DataStore }>(`/api/backups/${b.revision}`); setCandidate({ data: snapshot.data, label: `版本 v${b.revision}` }); })}>恢复预览</button></div></td></tr>)}</tbody></table></div>
    <p className="data-footnote">表格可左右滑动查看备份操作。此处显示最近 50 次操作，历史版本不自动删除。完整备份包含业务数据，操作历史按版本分别下载。</p>
    {message && <p className="form-message" role="status">{message}</p>}
  </section>;
}
