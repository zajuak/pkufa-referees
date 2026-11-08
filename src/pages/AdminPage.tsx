import { useEffect, useState, type FormEvent } from 'react';
import { BookOpen, CalendarPlus, CheckCircle2, Download, KeyRound, LogOut, Plus, RotateCcw, Save, Settings2, ShieldCheck, Trash2, UserPlus, UsersRound, WalletCards } from 'lucide-react';
import { api, useData } from '../hooks/useData';
import { channelName, CURRENT_SEASON, defaultWageStandards, effectiveMatchStatus, formatDate, formatMoney, getChannelSummary, getUpgradeRecommendation } from '../domain/calculations';
import { eventName, eventsForChannel } from '../domain/competitions';
import type { Adjustment, Channel, CompetitionEvent, Level, Match, RuleBlock, RulesData, WageStandards } from '../domain/types';
import { ChannelBadge, PageHeader, StatusBadge } from '../components/ui';
import AdminMatchForm from '../components/AdminMatchForm';
import OverviewPage from './OverviewPage';
import OperationsManager from '../components/OperationsManager';
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
      <PageHeader eyebrow="ADMIN CONSOLE" title="管理后台" description="维护赛程与裁判选派，登记奖惩，自动更新积分和工资表。" actions={authenticated ? <button className="button secondary" onClick={() => void logout()}><LogOut size={16} />退出登录</button> : <span className="season-pill"><ShieldCheck size={16} />管理员专用</span>} />
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
  const [tab, setTab] = useState<'matches' | 'adjustments' | 'wages' | 'referees' | 'rules' | 'operations' | 'overview'>('matches');
  const completed = data!.matches.filter((match) => effectiveMatchStatus(match) === 'completed').length;
  return (
    <>
      <div className="admin-summary"><span><strong>{data!.matches.length}</strong> 场赛程</span><span><strong>{completed}</strong> 场已结算</span><span><strong>{data!.adjustments.length}</strong> 条奖惩</span><p>保存后，前台积分与工资会自动重算。</p><button className="button secondary season-export-button" onClick={() => downloadSeasonWorkbook(data!)}><Download size={16} />导出当前赛季积分工资表</button></div>
      <div className="admin-tabs" role="group" aria-label="后台管理功能"><button className={tab === 'overview' ? 'active' : ''} onClick={() => setTab('overview')}><ShieldCheck size={18} />工作总览</button><button className={tab === 'matches' ? 'active' : ''} onClick={() => setTab('matches')}><CalendarPlus size={18} />赛程与选派</button><button className={tab === 'adjustments' ? 'active' : ''} onClick={() => setTab('adjustments')}><Settings2 size={18} />奖惩登记</button><button className={tab === 'wages' ? 'active' : ''} onClick={() => setTab('wages')}><WalletCards size={18} />工资修改</button><button className={tab === 'referees' ? 'active' : ''} onClick={() => setTab('referees')}><UsersRound size={18} />裁判员档案</button><button className={tab === 'rules' ? 'active' : ''} onClick={() => setTab('rules')}><BookOpen size={18} />管理办法</button><button className={tab === 'operations' ? 'active' : ''} onClick={() => setTab('operations')}><ShieldCheck size={18} />请假与备份</button></div>
      {tab === 'matches' && <MatchManager />}
      {tab === 'adjustments' && <AdjustmentManager />}
      {tab === 'wages' && <WageManager />}
      {tab === 'referees' && <RefereeManager />}
      {tab === 'rules' && <RulesManager />}
      {tab === 'operations' && <OperationsManager />}
      {tab === 'overview' && <OverviewPage />}
    </>
  );
}

function MatchManager() {
  const { data } = useData();
  const [editing, setEditing] = useState<Match | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [query, setQuery] = useState('');
  const matches = data!.matches.filter((match) => `${match.competition}${match.home}${match.away}${match.officials.map((item) => item.name).join('')}`.includes(query.trim())).sort((a, b) => b.date.localeCompare(a.date));
  const open = (match: Match | null) => { setEditing(match); setFormOpen(true); };
  return (
    <section className="admin-section">
      <div className="admin-section-heading"><div><h2>比赛管理</h2><p>新增赛程、调整岗位；比赛结束后自动完成并计入工资和积分。</p></div><div className="admin-heading-actions"><AssignmentUpload /><button className="button primary" onClick={() => open(null)}><Plus size={17} />新增赛程</button></div></div>
      <p className="upload-hint">Excel 请沿用当前选派表格式；已有比赛自动更新选派，新比赛自动追加，重复上传不会重复建赛。</p>
      {formOpen && <AdminMatchForm key={editing?.id || 'new'} match={editing} onClose={() => setFormOpen(false)} />}
      <div className="admin-list-tools"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索赛事、球队或裁判员" aria-label="搜索比赛" /><span>{matches.length} 场</span></div>
      <div className="admin-match-list">{matches.map((match) => <button className="admin-match-row" key={match.id} onClick={() => open(match)}><span className="admin-match-date"><strong>{formatDate(match.date)}</strong><small>第 {match.week} 周 · {match.time}</small></span><span className="admin-match-title"><strong>{match.home || match.group}{match.home && match.away ? ' vs ' : ''}{match.away}</strong><small>{match.competition} · {channelName(match.channel)} · {match.venue}</small></span><span className="admin-match-officials">{match.status === 'cancelled' ? '无需选派' : `${match.officials.filter((item) => item.name).length}/${match.officials.length} 已选派`}</span><StatusBadge status={effectiveMatchStatus(match)} /><span className="edit-text">编辑</span></button>)}</div>
    </section>
  );
}

function AdjustmentManager() {
  const { data, refresh } = useData();
  const [refereeId, setRefereeId] = useState('');
  const [channel, setChannel] = useState<Channel>('eleven');
  const [season, setSeason] = useState(CURRENT_SEASON);
  const [event, setEvent] = useState<CompetitionEvent>('freshmen-cup');
  const [type, setType] = useState<'reward' | 'penalty'>('reward');
  const [points, setPoints] = useState(0);
  const [wage, setWage] = useState(0);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState('');
  const referee = data!.referees.find((item) => item.id === refereeId);
  const submit = async (formEvent: FormEvent) => {
    formEvent.preventDefault(); setMessage('');
    if (!points && !wage) { setMessage('请至少填写一项积分或工资变动。'); return; }
    try {
      await api('/api/adjustments', { method: 'POST', body: JSON.stringify({ refereeId, channel, season, event, type, points, wage, date, reason }) });
      await refresh(); setReason(''); setPoints(0); setWage(0); setMessage('奖惩已登记，积分与工资表已更新。');
    } catch (error) { setMessage(error instanceof Error ? error.message : '保存失败'); }
  };
  const remove = async (item: Adjustment) => {
    if (!window.confirm(`确定删除“${item.reason}”这条奖惩记录？`)) return;
    await api(`/api/adjustments/${item.id}`, { method: 'DELETE' }); await refresh();
  };
  return (
    <section className="admin-section">
      <div className="admin-section-heading"><div><h2>奖惩登记</h2><p>正数登记奖励，切换为“处罚”后系统自动按负值核算。</p></div></div>
      <form className="admin-form horizontal-form" onSubmit={(event) => void submit(event)}>
        <div className="form-grid three-cols"><label>裁判员<select required value={refereeId} onChange={(event) => { const selected = data!.referees.find((item) => item.id === event.target.value); setRefereeId(event.target.value); const nextChannel = selected?.channels.eleven ? 'eleven' : 'five'; setChannel(nextChannel); setEvent(nextChannel === 'eleven' ? 'freshmen-cup' : 'womens-pku-cup'); }}><option value="">请选择裁判员</option>{[...data!.referees].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>渠道<select value={channel} onChange={(change) => { const nextChannel = change.target.value as Channel; setChannel(nextChannel); setEvent(nextChannel === 'eleven' ? 'freshmen-cup' : 'womens-pku-cup'); }}>{referee?.channels.eleven && <option value="eleven">十一人制</option>}{referee?.channels.five && <option value="five">五人制</option>}</select></label><label>类型<select value={type} onChange={(event) => setType(event.target.value as 'reward' | 'penalty')}><option value="reward">奖励</option><option value="penalty">处罚</option></select></label><label>赛事归属<select value={event} onChange={(change) => setEvent(change.target.value as CompetitionEvent)}>{eventsForChannel(channel).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>赛季<select value={season} onChange={(event) => setSeason(event.target.value)}><option>{CURRENT_SEASON}</option><option>2025–26</option></select></label><label>{type === 'penalty' ? '扣除积分' : '奖励积分'}<input type="number" min="0" step="0.1" value={points} onChange={(event) => setPoints(Number(event.target.value))} /></label><label>{type === 'penalty' ? '扣除工资（元）' : '奖励工资（元）'}<input type="number" min="0" step="0.5" value={wage} onChange={(event) => setWage(Number(event.target.value))} /></label><label>日期<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label><label className="span-two">奖惩事由<input required value={reason} onChange={(event) => setReason(event.target.value)} placeholder="例如：临时替补奖励 / 技术性失误扣罚" /></label></div>
        <p className="adjustment-help">{type === 'penalty' ? '处罚请输入需要扣除的正数，保存后系统自动记为负积分、负工资。' : '奖励将自动加入对应渠道的当前积分与所选赛季工资。'}</p>
        {message && <p className="form-message">{message}</p>}<div className="form-actions"><button className="button primary" disabled={!refereeId}><Plus size={16} />登记并自动核算</button></div>
      </form>
      <div className="admin-adjustments"><h3>已登记记录 <span>{data!.adjustments.length}</span></h3>{data!.adjustments.length ? [...data!.adjustments].reverse().map((item) => { const person = data!.referees.find((referee) => referee.id === item.refereeId); return <div className="adjustment-row" key={item.id}><span className={`adjustment-type ${item.type}`}>{item.type === 'reward' ? '奖' : '惩'}</span><div><strong>{person?.name} · {item.reason}</strong><small>{item.season} · {channelName(item.channel)} · {item.event ? eventName(item.event) : '未归赛事'} · {formatDate(item.date, true)}</small></div><span>{item.points >= 0 ? '+' : ''}{item.points} 分</span><strong>{item.wage >= 0 ? '+' : ''}{formatMoney(item.wage)}</strong><button className="icon-button danger-text" onClick={() => void remove(item)} aria-label="删除奖惩"><Trash2 size={16} /></button></div>; }) : <p className="inline-empty">暂无手工奖惩记录</p>}</div>
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
      {upgradeCandidates.length > 0 && <section className="upgrade-panel"><div className="upgrade-panel-heading"><div><h3>升级审核提示</h3><p>已达到升级条件，或达到下一等级所需积分 90% 的裁判员。</p></div><span>{upgradeCandidates.length} 条待审核</span></div><div className="upgrade-list">{upgradeCandidates.map(({ referee, channel: itemChannel, summary, recommendation }) => <div className={`upgrade-row ${recommendation.kind}`} key={`${referee.id}-${itemChannel}`}><div><strong>{referee.name}</strong><ChannelBadge channel={itemChannel} /></div><span>当前 {summary.level} 级 · {summary.points.toFixed(1)} 分</span><p>{recommendation.kind === 'ready' ? `已达到 ${recommendation.level} 级积分条件` : `已达到 ${recommendation.level} 级所需积分（${recommendation.targetPoints} 分）的 90%`}</p><button className="button secondary" disabled={savingLevel === `${referee.id}-${itemChannel}`} onClick={() => void updateLevel(referee.id, itemChannel, recommendation.level)}>调整为 {recommendation.level} 级</button></div>)}</div></section>}
      {levelMessage && <p className="form-message">{levelMessage}</p>}
      <div className="referee-table-wrap level-admin-wrap"><table className="referee-table level-admin-table"><thead><tr><th>裁判员</th><th>渠道</th><th>当前总积分</th><th>当前等级</th><th>等级设置</th></tr></thead><tbody>{levelRows.map(({ referee, channel: itemChannel, stats }) => {
        const summary = getChannelSummary(referee, itemChannel, data!.matches, data!.adjustments, data!.wageStandards)!;
        const key = `${referee.id}-${itemChannel}`;
        const levels = itemChannel === 'five' ? (['A', 'B', 'C'] as const) : (['A', 'B', 'C', 'D', 'E'] as const);
        return <tr key={key}><td><strong>{referee.name}</strong></td><td><ChannelBadge channel={itemChannel} /></td><td>{summary.points.toFixed(1)}</td><td><b className={`level level-${summary.level}`}>{summary.level} 级</b>{stats.levelOverride && <small className="manual-level-mark">手动</small>}</td><td><select aria-label={`${referee.name}${channelName(itemChannel)}等级`} value={summary.level} disabled={savingLevel === key} onChange={(event) => void updateLevel(referee.id, itemChannel, event.target.value)}>{levels.map((level) => <option key={level} value={level}>{level} 级</option>)}</select></td></tr>;
      })}</tbody></table></div>
    </section>
  );
}
