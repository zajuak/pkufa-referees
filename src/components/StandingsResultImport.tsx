import { useEffect, useState } from 'react';
import { api, useData } from '../hooks/useData';
import type { CompetitionEvent } from '../domain/types';
import type { ResultPreview } from '../domain/standings-import';

export default function StandingsResultImport({ event, season }: { event: CompetitionEvent; season: string }) {
  const { refresh } = useData();
  const [records, setRecords] = useState<unknown>(null);
  const [pendingPreview, setPreview] = useState<ResultPreview | null>(null);
  const preview = pendingPreview?.event === event && pendingPreview.season === season ? pendingPreview : null;
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  useEffect(() => { setPreview(null); setMessage(''); }, [event, season]);
  const inspect = async (document: unknown) => {
    setRecords(document);
    const result = await api<ResultPreview>('/api/standings-results/preview', { method: 'POST', body: JSON.stringify({ records: document, event, season }) });
    setPreview(result);
  };
  const load = async () => {
    setBusy(true); setMessage(''); setPreview(null);
    try { const result = await api<{ records: unknown; source: string }>('/api/standings-results'); await inspect(result.records); setMessage(`已读取${result.source}，请核对下方预览后导入。`); }
    catch (error) { setMessage(error instanceof Error ? error.message : '读取失败'); }
    finally { setBusy(false); }
  };
  const save = async () => {
    if (!preview) return;
    setBusy(true); setMessage('');
    try {
      const result = await api<ResultPreview>('/api/standings-results/import', { method: 'POST', headers: { 'If-Match': String(preview.revision) }, body: JSON.stringify({ records, event, season }) });
      await refresh(); setPreview(null); setMessage(`已导入 ${result.matched.length} 场赛果，晋级和回避判定已更新。`);
    } catch (error) { setMessage(error instanceof Error ? error.message : '导入失败'); }
    finally { setBusy(false); }
  };
  return <section className="standing-order" aria-label="从积分榜获取赛果">
    <h3>从积分榜获取赛果</h3>
    <p className="adjustment-help">按当前赛事、赛季、阶段和主客队匹配。GitHub 版读取线上积分榜，服务器版读取本机积分榜。仅导入可唯一对应且尚未填比分的比赛；已有不同比分、重复对阵和多回合比赛会提示人工核对。</p>
    <div className="form-actions"><button type="button" className="button secondary" disabled={busy} onClick={() => void load()}>{busy ? '处理中…' : '读取积分榜并预览'}</button>
      <label className="button secondary">上传积分榜 JSON<input type="file" accept=".json,application/json" disabled={busy} style={{ display: 'none' }} onChange={async (e) => {
        const file = e.target.files?.[0]; e.target.value = ''; if (!file) return;
        setBusy(true); setMessage(''); setPreview(null);
        try { if (file.size > 5 * 1024 * 1024) throw new Error('文件不能超过 5 MB'); await inspect(JSON.parse(await file.text())); }
        catch (error) { setMessage(error instanceof Error ? error.message : '文件读取失败'); }
        finally { setBusy(false); }
      }} /></label></div>
    {preview && <div><p>可导入 {preview.matched.length} 场 · 已一致 {preview.unchanged} 场 · 比分冲突 {preview.conflicts.length} 场 · 待核对 {preview.skipped.length} 场</p>
      <ul>{preview.matched.map((item) => <li key={item.matchId}>{item.label}：{item.result.home} : {item.result.away}{item.result.homePenalties !== undefined ? `（点球 ${item.result.homePenalties} : ${item.result.awayPenalties}）` : ''}</li>)}</ul>
      {preview.conflicts.concat(preview.skipped).length > 0 && <details><summary>查看冲突及未匹配原因</summary><ul>{preview.conflicts.concat(preview.skipped).map((item, i) => <li key={i}>{item.label}：{item.reason}</li>)}</ul></details>}
      <button type="button" className="button primary" disabled={busy || !preview.matched.length} onClick={() => void save()}>确认导入 {preview.matched.length} 场赛果</button></div>}
    {message && <p className="form-message" role="status">{message}</p>}
  </section>;
}
