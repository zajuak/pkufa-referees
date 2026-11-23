import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FileUp, LoaderCircle, X } from 'lucide-react';
import { requestApi, useData } from '../hooks/useData';
import { CURRENT_SEASON, roleName } from '../domain/calculations';
import { competitionEvents } from '../domain/competitions';
import type { CompetitionEvent, Role } from '../domain/types';

interface ImportResult { added: number; updated: number; linked: number; newReferees: number; total: number }
interface Split { role: Role; originalName: string; resumedName: string; originalPercent: number; resumedPercent: number; originalBonus?: number }
interface Candidate { group?: string; id: string; date: string; time: string; home: string; away: string; roles: Split[]; uploadedOriginal?: { weekKey: string; roles: Split[] } }
interface PreviewRow { key: string; sheet: string; row: number; weekKey: string; date: string; time: string; home: string; away: string; action: string; previousSchedule?: { date: string; time: string }; matchCandidates: Candidate[]; colleges?: string[]; unknownColleges: string[]; continuation: boolean; candidates: Candidate[]; additionalAssistants?: boolean; additionalOfficials?: { role: Role; name: string }[] }
interface Preview { revision: number; weeks: { key: string; end: string; semester: string; week: number; count: number }[]; rows: PreviewRow[] }
type SplitInput = Record<'originalPercent' | 'resumedPercent' | 'originalBonus' | 'resumedBonus', string>;
type Decision = { matchId: string; roles: Partial<Record<Role, SplitInput>> };
const validAmount = (value: string) => value.trim() !== '' && Number.isFinite(Number(value)) && Number(value) >= 0;

export default function AssignmentUpload() {
  const { refresh } = useData();
  const input = useRef<HTMLInputElement>(null), dialog = useRef<HTMLDialogElement>(null);
  const [event, setEvent] = useState<CompetitionEvent>('freshmen-cup');
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState('');
  const [pending, setPending] = useState<{ file: File; event: CompetitionEvent; preview: Preview } | null>(null);
  const [weeks, setWeeks] = useState<string[]>([]);
  const [matchTargets, setMatchTargets] = useState<Record<string, string>>({});
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  useEffect(() => { if (pending && !dialog.current?.open) dialog.current?.showModal(); }, [pending]);
  const upload = async (file: File | undefined) => {
    if (!file) return;
    setError(''); setResult(null);
    if (!file.name.toLowerCase().endsWith('.xlsx')) { setError('请上传 .xlsx 格式文件'); return; }
    if (file.size > 5 * 1024 * 1024) { setError('文件不能超过 5MB'); return; }
    setUploading(true);
    try {
      const response = await requestApi(`/api/import-assignments/preview?season=${encodeURIComponent(CURRENT_SEASON)}&event=${encodeURIComponent(event)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }, body: file,
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || '预览失败');
      setWeeks(body.weeks.length ? [body.weeks[0].key] : []); setDecisions({}); setMatchTargets({});
      setPending({ file, event, preview: body });
    } catch (reason) { setError(reason instanceof Error ? reason.message : '预览失败'); }
    finally { setUploading(false); if (input.current) input.current.value = ''; }
  };
  const selected = pending?.preview.rows.filter(row => weeks.includes(row.weekKey)) || [];
  const continuations = selected.filter(row => row.continuation);
  const roleChanges = (candidate: Candidate) => candidate.uploadedOriginal && weeks.includes(candidate.uploadedOriginal.weekKey) ? candidate.uploadedOriginal.roles : candidate.roles;
  const invalid = !selected.length || selected.some(row => row.action === 'confirm' && !matchTargets[row.key]) || selected.some(row => row.unknownColleges.length) || continuations.some(row => {
    const decision = decisions[row.key], candidate = row.candidates.find(c => c.id === decision?.matchId);
    return !candidate || roleChanges(candidate).some(role => !decision.roles[role.role] || Object.values(decision.roles[role.role]!).some(v => !validAmount(v)));
  });
  const chooseOriginal = (row: PreviewRow, id: string) => {
    const candidate = row.candidates.find(c => c.id === id);
    setDecisions(current => ({ ...current, [row.key]: { matchId: id, roles: Object.fromEntries((candidate ? roleChanges(candidate) : []).map(role => [role.role, { originalPercent: String(role.originalPercent), resumedPercent: String(role.resumedPercent), originalBonus: role.originalBonus === undefined ? '' : String(role.originalBonus), resumedBonus: '' }])) } }));
  };
  const confirm = async () => {
    if (!pending || invalid) return;
    setUploading(true); setError('');
    try {
      const options = { revision: pending.preview.revision, weeks, matchTargets: Object.fromEntries(selected.filter(row => matchTargets[row.key]).map(row => [row.key, matchTargets[row.key]])), continuations: Object.fromEntries(continuations.map(row => {
        const decision = decisions[row.key];
        return [row.key, { matchId: decision.matchId, roles: Object.fromEntries(Object.entries(decision.roles).map(([role, values]) => [role, Object.fromEntries(Object.entries(values!).map(([key, value]) => [key, Number(value)]))])) }];
      })) };
      const response = await requestApi(`/api/import-assignments?season=${encodeURIComponent(CURRENT_SEASON)}&event=${encodeURIComponent(pending.event)}&options=${encodeURIComponent(JSON.stringify(options))}`, {
        method: 'POST', headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }, body: pending.file,
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || '导入失败');
      setResult(body); setPending(null); await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : '导入失败'); }
    finally { setUploading(false); }
  };
  return <div className="upload-control">
    <label className="upload-event-select">上传赛事<select disabled={uploading || Boolean(pending)} value={event} onChange={change => setEvent(change.target.value as CompetitionEvent)}>{competitionEvents.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    <input ref={input} type="file" accept=".xlsx" onChange={change => void upload(change.target.files?.[0])} aria-label="上传裁判选派 Excel" hidden />
    <button className="button secondary" disabled={uploading || Boolean(pending)} onClick={() => input.current?.click()}>{uploading ? <LoaderCircle className="spin" size={17} /> : <FileUp size={17} />}{uploading ? '正在处理…' : '上传选派 Excel'}</button>
    {result && <p className="upload-result">导入完成：新增 {result.added} 场，更新 {result.updated} 场，关联续赛 {result.linked || 0} 场，新增渠道档案 {result.newReferees} 个。</p>}
    {error && !pending && <p className="form-error" role="alert">{error}</p>}
    {pending && createPortal(<dialog ref={dialog} className="assignment-import-dialog" aria-labelledby="assignment-import-title" onCancel={e => { e.preventDefault(); if (!uploading) setPending(null); }}>
      <form onSubmit={e => { e.preventDefault(); void confirm(); }}>
        <div className="import-dialog-heading"><div><h2 id="assignment-import-title">确认导入选派表</h2><p>{pending.file.name} · {competitionEvents.find(item => item.id === pending.event)?.name}</p></div><button type="button" className="icon-button" aria-label="关闭导入预览" disabled={uploading} onClick={() => setPending(null)}><X size={22} /></button></div>
        <fieldset className="import-week-options"><legend>选择需要更新的周次</legend><p>默认只选择文件中最新的一周。仅导入勾选周次，其他周在网站上的设置保留。</p>{pending.preview.weeks.map(week => <label key={week.key}><input type="checkbox" disabled={uploading} checked={weeks.includes(week.key)} onChange={e => { setWeeks(current => e.target.checked ? [...current, week.key] : current.filter(key => key !== week.key)); setDecisions({}); setMatchTargets({}); }} />{week.semester === 'spring' ? '春季' : '秋季'}第 {week.week} 周 · {week.key} 至 {week.end}（{week.count} 场）</label>)}</fieldset>
        <h3>本次选择 {selected.length} 行</h3>
        <p className="adjustment-help">表中填写的“回避”将作为本场完整名单保存；空白或没有该列时保留原设置。十一人制半决赛、决赛及男足北大杯升降级附加赛自动启用两名附加助理；支持“附加助理1／附加助理2”列，旧表缺列保留网站已有选派。选中周次的赛程与选派将按表更新，已有赛果、晋级来源及工资分配设置会保留。改期会显示原时间与新时间；跨周或有多个候选时须确认原场。</p>
        <div className="import-table-scroll"><table className="import-preview-table"><thead><tr><th>日期／时间</th><th>对阵</th><th>处理</th><th>附加助理</th><th>表中回避</th></tr></thead><tbody>{selected.map(row => <tr key={row.key}><td>{row.date}<br />{row.time}<small>{row.sheet} · 第 {row.row} 行</small></td><td>{row.home}—{row.away}</td><td>{row.continuation ? '接续比赛 · 待确认' : row.action === 'reschedule' ? <>改期更新<small>{row.previousSchedule?.date} {row.previousSchedule?.time}<br />→ {row.date} {row.time}</small></> : row.action === 'update' ? '更新' : row.action === 'confirm' ? <label className="import-match-target">确认比赛<select aria-label={`${row.key}更新目标`} disabled={uploading} value={matchTargets[row.key] || ''} onChange={e => setMatchTargets(current => ({ ...current, [row.key]: e.target.value }))}><option value="">请选择更新目标</option>{row.matchCandidates.map(candidate => <option key={candidate.id} value={candidate.id}>更新 {candidate.date} {candidate.time}{candidate.group ? ` · ${candidate.group}` : ''}</option>)}<option value="new">作为另一场新比赛导入</option></select><small>同对阵有多个或跨周候选，确认后保留原比赛编号与关联资料。</small></label> : '新增'}</td><td>{row.additionalAssistants ? <><strong>需要 2 人</strong>{(row.additionalOfficials || []).map(official => <small key={official.role}>{roleName(official.role)}：{official.name || '待选派'}</small>)}</> : '不需要'}</td><td>{row.colleges === undefined ? '保留原设置／自动计算' : row.colleges.length ? row.colleges.join('、') : '无回避'}{row.unknownColleges.length > 0 && <p className="form-error">未登记学院：{row.unknownColleges.join('、')}。请先在学院名录中登记。</p>}</td></tr>)}</tbody></table></div>
        {continuations.length > 0 && <section className="import-continuations"><h3>接续比赛确认</h3><p>关联后沿用原比赛编号，不新增计费场次。已导入且尚无选派、赛果及引用的空白续赛记录会合并。空白裁判栏保留原选派；后续可在比赛设定中调整换裁。</p>{continuations.map(row => {
          const decision = decisions[row.key], candidate = row.candidates.find(c => c.id === decision?.matchId);
          return <fieldset key={row.key}><legend>{row.date} {row.time} · {row.home}—{row.away}</legend><label>确认关联原场<select aria-label={`${row.key}原场`} disabled={uploading} value={decision?.matchId || ''} onChange={e => chooseOriginal(row, e.target.value)}><option value="">请选择并确认原场</option>{row.candidates.map(c => <option key={c.id} value={c.id}>{c.date} {c.time} · {c.home}—{c.away}</option>)}</select></label>{!row.candidates.length && <p className="form-error">未找到同赛事、同赛季的较早同对阵比赛，请先导入原场或核对队名。</p>}{(candidate ? roleChanges(candidate) : []).map(role => <div className="import-split" key={role.role}><strong>{roleName(role.role)}换裁：{role.originalName} → {role.resumedName}</strong><p>双方各计 0.5 场。积分与基础工资按独立比例计算，合计可超过 100%；积分保留一位小数，实际补贴须确认。</p><div className="form-grid two-cols">{(['originalPercent', 'resumedPercent', 'originalBonus', 'resumedBonus'] as const).map(key => <label key={key}>{({ originalPercent: '原场分配比例（%）', resumedPercent: '续赛分配比例（%）', originalBonus: '原场实际补贴（元）', resumedBonus: '续赛实际补贴（元）' })[key]}<input required min="0" step="any" type="number" disabled={uploading} value={decision.roles[role.role]![key]} onChange={e => setDecisions(current => ({ ...current, [row.key]: { ...current[row.key], roles: { ...current[row.key].roles, [role.role]: { ...current[row.key].roles[role.role]!, [key]: e.target.value } } } }))} /></label>)}</div></div>)}</fieldset>;
        })}</section>}
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="form-actions"><button type="button" className="button secondary" disabled={uploading} onClick={() => setPending(null)}>取消</button><button className="button primary" disabled={uploading || Boolean(invalid)}>{uploading ? '正在导入…' : '确认导入所选周次'}</button></div>
      </form>
    </dialog>, document.body)}
  </div>;
}
