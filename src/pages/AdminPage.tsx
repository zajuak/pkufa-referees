import { formatPoints } from '../domain/calculations';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BookOpen, CalendarPlus, CheckCircle2, Download, KeyRound, ListOrdered, LogOut, Plus, RotateCcw, Save, Settings2, ShieldCheck, Trash2, UserPlus, UsersRound, WalletCards } from 'lucide-react';
import { api, useData } from '../hooks/useData';
import { channelName, defaultWageStandards, effectiveMatchStatus, formatDate, getChannelSummary, getUpgradeRecommendation } from '../domain/calculations';
import { competitionEvents, eventName, getMatchEvent } from '../domain/competitions';
import type { Channel, CompetitionEvent, Level, Match, RuleBlock, RulesData, WageStandards } from '../domain/types';
import { ChannelBadge, PageHeader, StatusBadge } from '../components/ui';
import AdminMatchForm from '../components/AdminMatchForm';
import TeamManager from '../components/TeamManager';
import AvoidanceManager from '../components/AvoidanceManager';
import TournamentManager from '../components/TournamentManager';
import OverviewPage from './OverviewPage';
import OperationsManager from '../components/OperationsManager';
import PenaltyManager from '../components/PenaltyManager';
import AssignmentUpload from '../components/AssignmentUpload';
import { defaultRules } from './RulesPage';
import { downloadSeasonWorkbook } from '../domain/season-export';

export default function AdminPage() {
  const { refresh } = useData();
  const [authenticated, setAuthenticated] = useState(false);
  const [development, setDevelopment] = useState(false);
  const [checking, setChecking] = useState(true);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    api<{ authenticated: boolean; development: boolean }>('/api/session').then((session) => { setAuthenticated(session.authenticated); setDevelopment(session.development); }).catch((e) => setError(e.message)).finally(() => setChecking(false));
  }, []);
  const login = async (event: FormEvent) => {
    event.preventDefault(); setError('');
    try { await api('/api/login', { method: 'POST', body: JSON.stringify({ password }) }); await refresh(); setAuthenticated(true); setPassword(''); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '登录失败'); }
  };
  const logout = async () => { await api('/api/logout', { method: 'POST' }); setAuthenticated(false); await refresh(); };

  return (
    <div className="page admin-page">
      <PageHeader eyebrow="ADMIN CONSOLE" title="管理后台" description="维护赛程与裁判选派，登记处罚，自动更新积分和工资表。" actions={authenticated ? <button className="button secondary" onClick={() => void logout()}><LogOut size={16} />退出登录</button> : <span className="season-pill"><ShieldCheck size={16} />管理员专用</span>} />
      {checking ? <div className="panel admin-loading">正在检查登录状态…</div> : authenticated ? <AdminWorkspace /> : (
        <div className="login-layout">
          <section className="panel login-intro"><span className="login-icon"><Settings2 size={28} /></span><p className="eyebrow">SECURE WORKSPACE</p><h2>裁判部工作入口</h2><p>在这里发布每周赛程、调整裁判岗位，并在比赛完成后一键生成工资与积分明细。</p><ul><li><CheckCircle2 size={17} />服务端持久化保存</li><li><CheckCircle2 size={17} />五人制与十一人制独立核算</li><li><CheckCircle2 size={17} />按赛季归档工资记录</li></ul></section>
          <form className="panel login-form" onSubmit={(event) => void login(event)}><KeyRound size={25} /><h2>管理员登录</h2><p>请输入裁判部管理员密码</p><label>密码<input type="password" autoFocus required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="输入管理员密码" /></label>{error && <p className="form-error">{error}</p>}<button className="button primary full">登录管理平台</button>{development && <small className="dev-hint">本地开发初始密码：pkufa-admin<br />部署时请通过 ADMIN_PASSWORD 环境变量修改。</small>}</form>
        </div>
      )}
    </div>
  );
}

function AdminWorkspace() {
  const { data } = useData();
  const [tab, setTab] = useState<'matches' | 'adjustments' | 'wages' | 'referees' | 'rules' | 'operations' | 'overview' | 'teams' | 'tournament'>('matches');
  const [penaltyMatchId, setPenaltyMatchId] = useState('');
  const [exportError, setExportError] = useState('');
  const [exportEvent, setExportEvent] = useState<CompetitionEvent | 'all'>('all');
  const exportWorkbook = () => { setExportError(''); try { downloadSeasonWorkbook(data!, data!.meta.season, exportEvent === 'all' ? undefined : exportEvent); } catch (error) { setExportError(error instanceof Error ? error.message : '导出失败'); } };
  const completed = data!.matches.filter((match) => effectiveMatchStatus(match) === 'completed').length;
  return (
    <>
      <div className="admin-summary"><span><strong>{data!.matches.length}</strong> 场赛程</span><span><strong>{completed}</strong> 场已结算</span><span><strong>{data!.adjustments.filter(a=>a.type==='penalty'&&!a.voidedAt).length}</strong> 条处罚／事件</span><p>保存后，前台积分与工资会自动重算。</p><div className="season-export-controls"><select aria-label="工资表导出赛事" value={exportEvent} onChange={e=>setExportEvent(e.target.value as typeof exportEvent)}><option value="all">全部赛事（分别成表）</option><option value="freshmen-cup">新生杯</option><option value="mens-pku-cup">男足北大杯</option><option value="womens-pku-cup">女足北大杯</option></select><button className="button secondary season-export-button" onClick={exportWorkbook}><Download size={16} />导出积分工资表</button></div></div>
      {exportError && <p className="form-error" role="alert">{exportError}</p>}
      <div className="admin-tabs" role="group" aria-label="后台管理功能"><button className={tab === 'overview' ? 'active' : ''} onClick={() => setTab('overview')}><ShieldCheck size={18} />工作总览</button><button className={tab === 'matches' ? 'active' : ''} onClick={() => setTab('matches')}><CalendarPlus size={18} />赛程与选派</button><button className={tab === 'tournament' ? 'active' : ''} onClick={() => setTab('tournament')}><ListOrdered size={18} />积分榜与晋级</button><button className={tab === 'adjustments' ? 'active' : ''} onClick={() => setTab('adjustments')}><Settings2 size={18} />处罚登记</button><button className={tab === 'wages' ? 'active' : ''} onClick={() => setTab('wages')}><WalletCards size={18} />工资修改</button><button className={tab === 'referees' ? 'active' : ''} onClick={() => setTab('referees')}><UsersRound size={18} />裁判员档案</button><button className={tab === 'rules' ? 'active' : ''} onClick={() => setTab('rules')}><BookOpen size={18} />管理办法</button><button className={tab === 'operations' ? 'active' : ''} onClick={() => setTab('operations')}><ShieldCheck size={18} />请假与备份</button><button className={tab === 'teams' ? 'active' : ''} onClick={() => setTab('teams')}><UsersRound size={18} />球队与球衣</button></div>
      {tab === 'matches' && <MatchManager onPenalty={match=>{setPenaltyMatchId(match.id);setTab('adjustments');}} />}
      {tab === 'tournament' && <TournamentManager />}
      {tab === 'adjustments' && <PenaltyManager key={penaltyMatchId} initialMatchId={penaltyMatchId} />}
      {tab === 'wages' && <WageManager />}
      {tab === 'referees' && <RefereeWorkspace />}
      {tab === 'rules' && <RulesManager />}
      {tab === 'operations' && <OperationsManager />}
      {tab === 'overview' && <OverviewPage />}
      {tab === 'teams' && <TeamManager />}
    </>
  );
}

function MatchManager({ onPenalty }: { onPenalty: (match: Match) => void }) {
  const { data } = useData();
  const [params, setParams] = useSearchParams();
  const matchId = params.get('match');
  const editing = data!.matches.find(match => match.id === matchId) || null;
  const [creating, setCreating] = useState(false);
  const formOpen = creating || Boolean(editing);
  const editorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!matchId && !creating) return;
    const frame = requestAnimationFrame(() => editorRef.current?.scrollIntoView({ block: 'start' }));
    return () => cancelAnimationFrame(frame);
  }, [matchId, creating]);
  const [query, setQuery] = useState('');
  const requestedEvent = params.get('event');
  const event = competitionEvents.some(item => item.id === requestedEvent) ? requestedEvent! : 'all';
  const matches = data!.matches.filter(match => event === 'all' || getMatchEvent(match) === event).filter((match) => `${match.competition}${match.home}${match.away}${match.date}${match.resumption?.date || ''}${match.officials.map((item) => item.name).join('')}`.includes(query.trim())).sort((a, b) => b.date.localeCompare(a.date));
  const open = (match: Match | null) => { const next = new URLSearchParams(params); if (match) next.set('match', match.id); else next.delete('match'); setCreating(!match); setParams(next); };
  const close = () => { const next = new URLSearchParams(params); next.delete('match'); setCreating(false); setParams(next, { replace: true }); };
  return (
    <section className="admin-section">
      <div className="admin-section-heading"><div><h2>比赛管理</h2><p>新增赛程、调整岗位；比赛结束后自动完成并计入工资和积分。</p></div><div className="admin-heading-actions"><AssignmentUpload /><button className="button primary" onClick={() => open(null)}><Plus size={17} />新增赛程</button></div></div>
      <p className="upload-hint">组别可省略整列或留空，更新时保留已有组别；比赛阶段可填写在“比赛类别”列。五人制支持“一裁、二裁、三裁”或“第一裁判、第二裁判、第三裁判”三列，兼容旧“主裁／副裁”表。上传后先选择需要更新的周次并确认；“回避”列可导入本场名单，备注“接续比赛”需确认关联原场。</p>
      {matchId && !editing && <p className="form-error" role="alert">未找到该比赛，可能已被删除。可从下方比赛列表重新选择。</p>}
      {formOpen && <div ref={editorRef} className="match-editor-anchor"><AdminMatchForm key={editing?.id || 'new'} match={editing} onClose={close} onPenalty={editing ? () => onPenalty(editing) : undefined} /></div>}
      <div className="admin-list-tools admin-match-tools"><label className="admin-match-event-filter">赛事<select aria-label="比赛管理赛事筛选" value={event} onChange={change => { const next = new URLSearchParams(params); if (change.target.value === 'all') next.delete('event'); else next.set('event', change.target.value); setParams(next, { replace: true }); }}><option value="all">全部赛事</option>{competitionEvents.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索赛事、球队或裁判员" aria-label="搜索比赛" /><span>{matches.length} 场</span></div>
      <div className="admin-match-list">{matches.map((match) => <button className="admin-match-row" key={match.id} onClick={() => open(match)}><span className="admin-match-date"><strong>{formatDate(match.date)}</strong><small>第 {match.week} 周 · {match.time}</small>{match.resumption && <small>接续：{match.resumption.date} {match.resumption.time}</small>}</span><span className="admin-match-title"><strong>{match.home || match.group}{match.home && match.away ? ' vs ' : ''}{match.away}</strong><small>{match.competition} · {channelName(match.channel)} · {match.venue}</small></span><span className="admin-match-officials">{match.status === 'cancelled' ? '无需选派' : `${match.officials.filter((item) => item.name).length}/${match.officials.length} 已选派`}</span><StatusBadge status={effectiveMatchStatus(match)} /><span className="edit-text">编辑</span></button>)}</div>
      {!matches.length && <p className="inline-empty">没有符合筛选条件的比赛。</p>}
    </section>
  );
}


function WageManager() {
  const { data, refresh } = useData();
  const [draft, setDraft] = useState<WageStandards>(() => ({ ...structuredClone(defaultWageStandards), ...structuredClone(data!.wageStandards || {}) }));
  const [selected, setSelected] = useState<CompetitionEvent>('freshmen-cup');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const levels = selected === 'womens-pku-cup' ? (['A', 'B', 'C'] as const) : (['A', 'B', 'C', 'D', 'E'] as const);
  const roles = selected === 'womens-pku-cup' ? ['第一 / 第二裁判员', '第三裁判员'] : ['主裁判', '助理裁判员', '第四官员'];
  const updateRate = (level: Level, roleIndex: number, value: number) => setDraft((current) => ({
    ...current,
    [selected]: { ...current[selected], [level]: (current[selected]?.[level] || []).map((rate, index) => index === roleIndex ? value : rate) },
  }));
  const save = async () => {
    setSaving(true); setMessage('');
    try { await api('/api/wage-standards', { method: 'PUT', body: JSON.stringify(draft) }); await refresh(); setMessage(`${eventName(selected)}工资标准已保存，当前赛季工资已自动重算。`); }
    catch (error) { setMessage(error instanceof Error ? error.message : '工资标准保存失败'); }
    finally { setSaving(false); }
  };
  const restore = async () => {
    if (!window.confirm('确定恢复全部赛事的初始工资标准？')) return;
    await api('/api/wage-standards', { method: 'DELETE' }); await refresh(); setDraft(structuredClone(defaultWageStandards)); setMessage('已恢复全部赛事的初始工资标准。');
  };
  return (
    <section className="admin-section wage-standards-admin">
      <div className="admin-section-heading"><div><h2>赛事工资标准</h2><p>按赛事统一设置各等级、各岗位的单场基础工资，保存后自动重算当前赛季工资。</p></div><div className="admin-heading-actions"><button className="button secondary" onClick={() => void restore()}><RotateCcw size={16} />恢复初始标准</button><button className="button primary" disabled={saving} onClick={() => void save()}><Save size={16} />保存工资标准</button></div></div>
      <label className="wage-event-select">赛事<select aria-label="工资标准赛事" value={selected} onChange={(event) => setSelected(event.target.value as CompetitionEvent)}><option value="freshmen-cup">男足新生杯 · 秋季学期</option><option value="mens-pku-cup">男足北大杯 · 春季学期</option><option value="womens-pku-cup">女足北大杯 · 全学年</option></select></label>
      <div className="wage-standard-table-wrap"><table className="wage-standard-table"><thead><tr><th>等级</th>{roles.map((role) => <th key={role}>{role}（元 / 场）</th>)}</tr></thead><tbody>{levels.map((level) => <tr key={level}><th><b className={`level level-${level}`}>{level} 级</b></th>{roles.map((role, roleIndex) => <td key={role}><input aria-label={`${eventName(selected)} ${level}级 ${role}工资`} type="number" min="0" step="0.5" required value={draft[selected]?.[level]?.[roleIndex] ?? 0} onChange={(event) => updateRate(level, roleIndex, Number(event.target.value))} /></td>)}</tr>)}</tbody></table></div>
      <p className="adjustment-help">2025–26 已审核历史工资不受新标准影响。</p>
      {message && <p className="form-message">{message}</p>}
      <div className="form-actions"><button className="button primary" disabled={saving} onClick={() => void save()}><WalletCards size={16} />保存并重新核算</button></div>
    </section>
  );
}

function RulesManager() {
  const { data, refresh } = useData();
  const [draft, setDraft] = useState<RulesData>(() => structuredClone(data!.rules || defaultRules));
  const [selected, setSelected] = useState(0);
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const chapter = draft.chapters[selected];
  const updateChapter = (patch: Partial<RulesData['chapters'][number]>) => setDraft((current) => ({ ...current, chapters: current.chapters.map((item, index) => index === selected ? { ...item, ...patch } : item) }));
  const updateBlock = (index: number, block: RuleBlock) => updateChapter({ blocks: chapter.blocks.map((item, blockIndex) => blockIndex === index ? block : item) });
  const save = async () => {
    setSaving(true); setMessage('');
    try { await api('/api/rules', { method: 'PUT', body: JSON.stringify(draft) }); await refresh(); setMessage('管理办法已保存，前台内容已同步更新。'); }
    catch (error) { setMessage(error instanceof Error ? error.message : '管理办法保存失败'); }
    finally { setSaving(false); }
  };
  const restore = async () => {
    if (!window.confirm('确定恢复初始管理办法？当前修改将被替换。')) return;
    await api('/api/rules', { method: 'DELETE' }); await refresh(); setDraft(structuredClone(defaultRules)); setSelected(0); setMessage('已恢复初始管理办法。');
  };
  return (
    <section className="admin-section rules-admin">
      <div className="admin-section-heading"><div><h2>管理办法编辑</h2><p>修改章节标题与条款；统一工资标准请在“工资修改”中设置。</p></div><div className="admin-heading-actions"><button className="button secondary" onClick={() => void restore()}><RotateCcw size={16} />恢复初始版本</button><button className="button primary" disabled={saving} onClick={() => void save()}><Save size={16} />保存管理办法</button></div></div>
      <div className="rule-chapter-tools"><label>选择章节<select aria-label="选择管理办法章节" value={selected} onChange={(event) => setSelected(Number(event.target.value))}>{draft.chapters.map((item, index) => <option key={item.id} value={index}>{item.numeral}、{item.title}</option>)}</select></label><label>章节标题<input aria-label="章节标题" value={chapter.title} onChange={(event) => updateChapter({ title: event.target.value })} /></label></div>
      <div className="rule-edit-list">{chapter.blocks.map((block, index) => <div className="rule-edit-block" key={`${chapter.id}-${index}`}>
        <div className="rule-edit-block-heading"><span>{block.kind === 'subheading' ? '小标题' : block.kind === 'paragraph' ? '段落' : block.kind === 'clause' ? '条款' : '工资标准表'}</span>{block.kind !== 'table' && <button className="icon-button danger-text" aria-label={`删除第${index + 1}段`} onClick={() => updateChapter({ blocks: chapter.blocks.filter((_, blockIndex) => blockIndex !== index) })}><Trash2 size={15} /></button>}</div>
        {block.kind === 'subheading' && <input aria-label={`第${index + 1}段小标题`} value={block.text} onChange={(event) => updateBlock(index, { ...block, text: event.target.value })} />}
        {block.kind === 'paragraph' && <textarea aria-label={`第${index + 1}段内容`} rows={3} value={block.text} onChange={(event) => updateBlock(index, { ...block, text: event.target.value })} />}
        {block.kind === 'clause' && <div className="rule-clause-editor"><input aria-label={`第${index + 1}段条款序号`} value={block.marker} onChange={(event) => updateBlock(index, { ...block, marker: event.target.value })} /><textarea aria-label={`第${index + 1}段条款内容`} rows={3} value={block.text} onChange={(event) => updateBlock(index, { ...block, text: event.target.value })} /></div>}
        {block.kind === 'table' && <p className="rule-wage-managed-note">此处展示统一工资标准表，具体金额请在后台“工资修改”中设置。</p>}
      </div>)}</div>
      <div className="rule-add-blocks"><span>添加内容</span><button className="button secondary" onClick={() => updateChapter({ blocks: [...chapter.blocks, { kind: 'subheading', text: '新小标题' }] })}>小标题</button><button className="button secondary" onClick={() => updateChapter({ blocks: [...chapter.blocks, { kind: 'paragraph', text: '新段落' }] })}>段落</button><button className="button secondary" onClick={() => updateChapter({ blocks: [...chapter.blocks, { kind: 'clause', marker: '', text: '新条款' }] })}>条款</button></div>
      {message && <p className="form-message">{message}</p>}
      <div className="form-actions"><button className="button primary" disabled={saving} onClick={() => void save()}><Save size={16} />保存管理办法</button></div>
    </section>
  );
}

function RefereeWorkspace() {
  const [section, setSection] = useState<'profiles' | 'avoidance'>('profiles');
  return <><div className="segmented" role="group" aria-label="裁判员档案功能" style={{ marginBottom: 20 }}>
    <button className={section === 'profiles' ? 'active' : ''} onClick={() => setSection('profiles')}>档案与等级</button>
    <button className={section === 'avoidance' ? 'active' : ''} onClick={() => setSection('avoidance')}>回避设置</button>
  </div>{section === 'profiles' ? <RefereeManager /> : <AvoidanceManager mode="referees" />}</>;
}

function RefereeManager() {
  const { data, refresh } = useData();
  const [name, setName] = useState('');
  const [channel, setChannel] = useState<Channel>('eleven');
  const [message, setMessage] = useState('');
  const [levelQuery, setLevelQuery] = useState('');
  const [levelMessage, setLevelMessage] = useState('');
  const [savingLevel, setSavingLevel] = useState('');
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setMessage('');
    try { await api('/api/referees', { method: 'POST', body: JSON.stringify({ name, channel }) }); await refresh(); setName(''); setMessage('裁判员档案已创建，可以立即参与选派。'); }
    catch (error) { setMessage(error instanceof Error ? error.message : '创建失败'); }
  };
  const updateLevel = async (refereeId: string, itemChannel: Channel, level: string) => {
    const key = `${refereeId}-${itemChannel}`;
    setSavingLevel(key); setLevelMessage('');
    try {
      await api(`/api/referees/${refereeId}/level`, { method: 'PUT', body: JSON.stringify({ channel: itemChannel, level }) });
      await refresh();
      const referee = data!.referees.find((item) => item.id === refereeId);
      setLevelMessage(`${referee?.name}的${channelName(itemChannel)}等级已调整为 ${level} 级。`);
    } catch (error) { setLevelMessage(error instanceof Error ? error.message : '等级保存失败'); }
    finally { setSavingLevel(''); }
  };
  const allLevelRows = data!.referees.flatMap((referee) => (['eleven', 'five'] as Channel[]).flatMap((itemChannel) => {
    const stats = referee.channels[itemChannel];
    return stats ? [{ referee, channel: itemChannel, stats }] : [];
  }));
  const levelRows = allLevelRows.filter(({ referee }) => referee.name.replace(/\s/g, '').includes(levelQuery.trim().replace(/\s/g, '')))
    .sort((a, b) => a.referee.name.localeCompare(b.referee.name, 'zh-CN') || a.channel.localeCompare(b.channel));
  const upgradeCandidates = allLevelRows.flatMap((row) => {
    const summary = getChannelSummary(row.referee, row.channel, data!.matches, data!.adjustments, data!.wageStandards)!;
    const recommendation = getUpgradeRecommendation(row.channel, summary.level, summary.points);
    return recommendation ? [{ ...row, summary, recommendation }] : [];
  }).sort((a, b) => (a.recommendation.kind === b.recommendation.kind ? b.summary.points - a.summary.points : a.recommendation.kind === 'ready' ? -1 : 1));
  return (
    <section className="admin-section">
      <div className="admin-section-heading"><div><h2>裁判员档案</h2><p>新增裁判档案，并针对裁判证或处罚情况直接调整各渠道等级。</p></div></div>
      <form className="admin-form referee-add-form" onSubmit={(event) => void submit(event)}><div className="form-heading"><div><span>新增裁判员</span><small>创建档案后即可参与选派，并在下方调整等级</small></div></div><div className="form-grid two-cols"><label>姓名<input required value={name} onChange={(event) => setName(event.target.value)} placeholder="输入裁判员姓名" /></label><label>初始渠道<select value={channel} onChange={(event) => setChannel(event.target.value as Channel)}><option value="eleven">十一人制 · E 级 / 0 分</option><option value="five">五人制 · C 级 / 0 分</option></select></label></div>{message && <p className="form-message">{message}</p>}<div className="form-actions"><button className="button primary"><UserPlus size={16} />新增裁判员</button></div></form>
      <div className="admin-summary"><span><strong>{data!.referees.length}</strong> 条裁判档案</span><p>同名或来源冲突的历史记录保持独立，避免错误合并。</p></div>
      <div className="level-admin-heading"><div><h3>等级人工调整</h3><p>赛季中不会自动升级；请在赛事开始前完成升级审核。</p></div><label className="search-field"><input value={levelQuery} onChange={(event) => setLevelQuery(event.target.value)} placeholder="搜索裁判员姓名" aria-label="搜索等级裁判" /></label></div>
      {upgradeCandidates.length > 0 && <section className="upgrade-panel"><div className="upgrade-panel-heading"><div><h3>升级审核提示</h3><p>已达到升级条件，或达到下一等级所需积分 90% 的裁判员。</p></div><span>{upgradeCandidates.length} 条待审核</span></div><div className="upgrade-list">{upgradeCandidates.map(({ referee, channel: itemChannel, summary, recommendation }) => <div className={`upgrade-row ${recommendation.kind}`} key={`${referee.id}-${itemChannel}`}><div><strong>{referee.name}</strong><ChannelBadge channel={itemChannel} /></div><span>当前 {summary.level} 级 · {formatPoints(summary.points)} 分</span><p>{recommendation.kind === 'ready' ? `已达到 ${recommendation.level} 级积分条件` : `已达到 ${recommendation.level} 级所需积分（${recommendation.targetPoints} 分）的 90%`}</p><button className="button secondary" disabled={savingLevel === `${referee.id}-${itemChannel}`} onClick={() => void updateLevel(referee.id, itemChannel, recommendation.level)}>调整为 {recommendation.level} 级</button></div>)}</div></section>}
      {levelMessage && <p className="form-message">{levelMessage}</p>}
      <div className="referee-table-wrap level-admin-wrap"><table className="referee-table level-admin-table"><thead><tr><th>裁判员</th><th>渠道</th><th>当前总积分</th><th>当前等级</th><th>等级设置</th></tr></thead><tbody>{levelRows.map(({ referee, channel: itemChannel, stats }) => {
        const summary = getChannelSummary(referee, itemChannel, data!.matches, data!.adjustments, data!.wageStandards)!;
        const key = `${referee.id}-${itemChannel}`;
        const levels = itemChannel === 'five' ? (['A', 'B', 'C'] as const) : (['A', 'B', 'C', 'D', 'E'] as const);
        return <tr key={key}><td><strong>{referee.name}</strong></td><td><ChannelBadge channel={itemChannel} /></td><td>{formatPoints(summary.points)}</td><td><b className={`level level-${summary.level}`}>{summary.level} 级</b>{stats.levelOverride && <small className="manual-level-mark">手动</small>}</td><td><select aria-label={`${referee.name}${channelName(itemChannel)}等级`} value={summary.level} disabled={savingLevel === key} onChange={(event) => void updateLevel(referee.id, itemChannel, event.target.value)}>{levels.map((level) => <option key={level} value={level}>{level} 级</option>)}</select></td></tr>;
      })}</tbody></table></div>
    </section>
  );
}
