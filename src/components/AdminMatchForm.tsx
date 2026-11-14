import { useState } from 'react';
import { Save, Trash2, X } from 'lucide-react';
import { api, useData } from '../hooks/useData';
import { availableSeasons, CURRENT_SEASON, roleName } from '../domain/calculations';
import { defaultCompetition, eventsForChannel, getMatchEvent } from '../domain/competitions';
import { assignmentAnalysis, matchRoles, requiredRoles, usesAdditionalAssistants } from '../domain/scheduling';
import { applyAdvancement, matchAvoidanceSummary, resolveMatchTeams } from '../domain/avoidance';
import { automaticTimeBonuses, matchBonuses, timeBonusKinds, timeBonusLabels } from '../domain/time-bonuses';
import { allowedStages, stageOptions, stageLabel } from '../domain/stages';
import { matchWeek } from '../domain/weeks';
import { eventTeams, teamColor } from '../domain/teams';
import { interruptionIssues, interruptionSettings, resumptionReady } from '../domain/workload';
import { normalizeRefereeName, refereeNameKey } from '../domain/referees';
import type { Channel, CompetitionEvent, Match, MatchTeamSource, Official, Role } from '../domain/types';

function emptyMatch(): Match {
  return {
    id: '', season: CURRENT_SEASON, week: 1, channel: 'eleven', event: 'freshmen-cup', competition: '新生杯', date: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date()), time: '12:00-14:00', venue: '北场', group: 'A', home: '', away: '', homeColor: '', awayColor: '', stage: 'group', division: null, status: 'scheduled', note: '', bonuses: [],
    additionalAssistants: false, officials: requiredRoles('eleven').map((role) => ({ role, refereeId: null, name: '' })),
  };
}

function keepRoleOfficials(officials: Official[], roles: Role[]): Official[] {
  return roles.flatMap((role) => { const existing = officials.filter((o) => o.role === role); return existing.length ? existing : [{ role, refereeId: null, name: '' }]; });
}

export default function AdminMatchForm({ match, onClose }: { match: Match | null; onClose: () => void }) {
  const { data, refresh } = useData();
  const [form, setForm] = useState<Match>(() => {
    if (!match) return emptyMatch();
    const event = getMatchEvent(match) || (match.channel === 'eleven' ? 'freshmen-cup' : 'womens-pku-cup');
    return { ...emptyMatch(), ...match, ...interruptionSettings(match), event,
      homeColor: match.homeColor || teamColor(data!, event, match.home),
      awayColor: match.awayColor || teamColor(data!, event, match.away),
      additionalAssistants: usesAdditionalAssistants(match),
      officials: match.status === 'cancelled' ? [] : keepRoleOfficials(match.officials, matchRoles(match)),
    };
  });
  const [saving, setSaving] = useState(false);
  const [officialQueries, setOfficialQueries] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const canResume = resumptionReady(form);
  const automaticBonuses = automaticTimeBonuses(form);
  const calculatedWeek = matchWeek(form, data!.matches, data!.meta.season);
  const analysisMatch = { ...form, officials: form.officials.map((official) => {
    if (official.refereeId || !official.name) return official;
    const sameName = data!.referees.filter((referee) => refereeNameKey(referee.name) === refereeNameKey(official.name));
    const sameChannel = sameName.filter((referee) => referee.channels[form.channel]);
    const existing = sameChannel.length === 1 ? sameChannel[0] : sameName.length === 1 ? sameName[0] : undefined;
    return { ...official, refereeId: existing?.id || `new:${refereeNameKey(official.name)}` };
  }) };
  const prospectiveMatches = applyAdvancement(data!.matches.some((item) => item.id === form.id)
    ? data!.matches.map((item) => item.id === form.id ? analysisMatch : item)
    : [...data!.matches, analysisMatch], data!.groupOrders || []);
  const resolvedMatch = prospectiveMatches.find((item) => item === analysisMatch || (item.id && item.id === form.id)) || analysisMatch;
  const analysis = assignmentAnalysis(resolvedMatch, prospectiveMatches, data!.unavailability, {
    referees: data!.referees, teams: data!.teams || [], groupOrders: data!.groupOrders || [],
  });
  const scoreErrors: string[] = [];
  if (form.result) {
    if (form.status !== 'completed') scoreErrors.push('只有已完成比赛可以填写赛果');
    if (![form.result.home, form.result.away].every((value) => Number.isSafeInteger(value) && value >= 0)) scoreErrors.push('比分必须是非负整数');
    if (['knockout', 'semifinal', 'final', 'third'].includes(form.stage) && form.result.home === form.result.away
      && (!Number.isSafeInteger(form.result.homePenalties) || !Number.isSafeInteger(form.result.awayPenalties) || form.result.homePenalties === form.result.awayPenalties)) scoreErrors.push('淘汰赛常规比分持平时，必须填写不相等的点球比分');
  }
  const issues = [...analysis.issues, ...scoreErrors, ...interruptionIssues(form)];
  const warnings = analysis.warnings;
  const resolvedTeams = resolveMatchTeams(resolvedMatch, prospectiveMatches, data!.groupOrders || []);
  const avoidance = matchAvoidanceSummary(resolvedMatch, prospectiveMatches, data!.teams || [], data!.groupOrders || []);
  const automaticAvoidance = matchAvoidanceSummary({ ...resolvedMatch, avoidanceOverride: undefined }, prospectiveMatches, data!.teams || [], data!.groupOrders || []);
  const seasons = availableSeasons(data!.matches, data!.adjustments);
  const update = <K extends keyof Match>(key: K, value: Match[K]) => setForm((current) => ({ ...current, [key]: value }));
  const changeChannel = (channel: Channel) => setForm((current) => {
    const event = channel === 'eleven' ? 'freshmen-cup' : 'womens-pku-cup';
    return { ...current, channel, event, interrupted: false, resumption: undefined, competition: defaultCompetition(event), stage: allowedStages(channel).includes(current.stage) ? current.stage : 'group', additionalAssistants: false, home: '', away: '', homeColor: '', awayColor: '', result: undefined, placementMode: undefined, homeSource: undefined, awaySource: undefined, officials: current.status === 'cancelled' ? [] : requiredRoles(channel).map((role) => ({ role, refereeId: null, name: '' })) };
  });
  const changeEvent = (event: CompetitionEvent) => setForm((current) => ({ ...current, event, division: event === 'mens-pku-cup' ? current.division : null, competition: defaultCompetition(event), home: '', away: '', homeColor: '', awayColor: '', result: undefined, homeSource: undefined, awaySource: undefined }));
  const changeStatus = (status: Match['status']) => setForm((current) => ({
    ...current,
    status,
    result: status === 'completed' ? current.result : undefined,
    ...(status === 'cancelled' ? { interrupted: false, resumption: undefined } : {}),
    officials: status === 'cancelled' ? [] : keepRoleOfficials(current.officials, matchRoles(current)),
  }));
  const changeStage = (stage: Match['stage']) => setForm((current) => ({
    ...current, stage,
    placementMode: current.channel === 'eleven' && stage === 'placement' ? current.placementMode || 'grouped' : undefined,
    homeSource: current.channel === 'eleven' && ['knockout', 'semifinal', 'final', 'third'].includes(stage) ? current.homeSource : undefined,
    awaySource: current.channel === 'eleven' && ['knockout', 'semifinal', 'final', 'third'].includes(stage) ? current.awaySource : undefined,
  }));
  const sourceMatches = data!.matches.filter((item) => item.id !== form.id && item.event === form.event && (item.season || data!.meta.season) === form.season && item.status !== 'cancelled');
  const setSource = (side: 'home' | 'away', mode: 'direct' | 'winner' | 'loser' | 'group') => setForm((current) => {
    const key = `${side}Source` as const;
    let source: MatchTeamSource | undefined;
    if (mode === 'winner' || mode === 'loser') source = { kind: 'match', matchId: sourceMatches[0]?.id || '', outcome: mode };
    if (mode === 'group') source = { kind: 'group', group: current.group || 'A', rank: 1 };
    return { ...current, [key]: source, ...(source ? { [side]: '', [`${side}Color`]: '' } : {}) };
  });
  const patchSource = (side: 'home' | 'away', source: MatchTeamSource) => setForm((current) => ({ ...current, [`${side}Source`]: source }));
  const updateScore = (key: 'home' | 'away' | 'homePenalties' | 'awayPenalties', raw: string) => setForm((current) => {
    const value = raw === '' ? undefined : Number(raw);
    const result = { home: 0, away: 0, ...current.result, [key]: value };
    if (key === 'homePenalties' || key === 'awayPenalties') {
      if (value === undefined) delete result[key];
    } else result[key] = value ?? 0;
    return { ...current, result };
  });

  const selectedEvent = getMatchEvent(form) || 'freshmen-cup';
  const teams = eventTeams(data!, selectedEvent);
  for (const name of [form.home, form.away]) if (name && !teams.some((team) => team.name === name)) teams.push({ event: selectedEvent, name, color: '', bound: false });
  const chooseTeam = (side: 'home' | 'away', name: string) => setForm((current) => ({ ...current, [side]: name, [`${side}Color`]: teamColor(data!, selectedEvent, name) }));
  const changeAdditional = (enabled: boolean) => {
    if (!enabled && form.officials.some((o) => o.role.startsWith('additionalAssistant') && (o.refereeId || o.name)) && !window.confirm('关闭后将移除本场的两名附加助理选派，并重算工资积分，是否继续？')) return;
    setForm((current) => ({ ...current, additionalAssistants: enabled, officials: current.status === 'cancelled' ? [] : keepRoleOfficials(current.officials, requiredRoles(current.channel, enabled)) }));
  };

  const changeInterruption = (enabled: boolean) => {
    if (!enabled && form.officials.some(o => o.fraction === 0.5) && !window.confirm('关闭比赛中断将移除续赛换裁记录，并恢复原场裁判执裁 1 场。确认后保存才会生效，是否继续？')) return;
    setOfficialQueries({});
    setForm((current) => ({ ...current, interrupted: enabled, resumption: enabled ? current.resumption : undefined,
      officials: enabled ? current.officials : current.officials.flatMap((official, index, all) => {
        if (official.fraction !== 0.5) return [official];
        if (all.findIndex(o => o.role === official.role) !== index) return [];
        const { fraction, actualBonus, dutyDate, dutyTime, ...full } = official;
        return [full];
      }),
    }));
  };
  const changeResumption = (patch: Partial<NonNullable<Match['resumption']>>) => setForm((current) => {
    const value = { date: '', time: '', ...current.resumption, ...patch };
    const updated = { ...current, resumption: value.date || value.time ? value : undefined };
    if (resumptionReady(updated)) updated.officials = current.officials.map((official, index, all) => official.fraction === 0.5 && all.findIndex(o => o.role === official.role) !== index ? { ...official, dutyDate: value.date, dutyTime: value.time } : official);
    return updated;
  });

  const patchOfficial = (index: number, patch: Partial<Official>) => setForm((current) => ({ ...current, officials: current.officials.map((o, i) => i === index ? { ...o, ...patch } : o) }));
  const toggleContinuation = (role: Role, enabled: boolean) => {
    if (enabled && !canResume) return;
    if (!enabled && form.officials.filter((o) => o.role === role).slice(1).some((o) => o.name) && !window.confirm('关闭续赛换裁将移除该岗位的续赛裁判，并恢复为原裁判执裁 1 场，是否继续？')) return;
    setOfficialQueries({});
    setForm((current) => {
      const first = current.officials.findIndex((o) => o.role === role);
      return { ...current, officials: current.officials.flatMap((o, index) => {
        if (o.role !== role) return [o];
        if (index !== first) return [];
        if (enabled) return [{ ...o, fraction: 0.5 as const, actualBonus: 0, substitute: false, dutyDate: current.date, dutyTime: current.time }, { role, refereeId: null, name: '', fraction: 0.5 as const, actualBonus: 0, dutyDate: current.resumption!.date, dutyTime: current.resumption!.time }];
        const { fraction, actualBonus, dutyDate, dutyTime, ...full } = o;
        return [full];
      }) };
    });
  };

  const save = async () => {
    setSaving(true); setError('');
    try {
      await api(form.id ? `/api/matches/${form.id}` : '/api/matches', { method: form.id ? 'PUT' : 'POST', body: JSON.stringify({ ...form, week: calculatedWeek, bonuses: matchBonuses(form) }) });
      await refresh(); onClose();
    } catch (reason) { setError(reason instanceof Error ? reason.message : '保存失败'); }
    finally { setSaving(false); }
  };
  const remove = async () => {
    if (!form.id || !window.confirm('确定删除这场比赛？相关自动工资和积分也会同步移除。')) return;
    setSaving(true);
    try { await api(`/api/matches/${form.id}`, { method: 'DELETE' }); await refresh(); onClose(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '删除失败'); setSaving(false); }
  };

  return (
    <form className="admin-form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <div className="form-heading"><div><span>{form.id ? '编辑比赛' : '新增比赛'}</span><small>完成后自动重算工资与积分</small></div><button type="button" className="icon-button" onClick={onClose} aria-label="关闭表单"><X size={18} /></button></div>
      <div className="form-grid three-cols">
        <label>赛季<select value={form.season} onChange={(event) => update('season', event.target.value)}>{seasons.map((season) => <option key={season}>{season}</option>)}</select></label>
        <label>周次（自动计算）<input aria-label="周次" type="number" min="1" readOnly value={calculatedWeek} /><small className="auto-week-note">按本学期首场比赛起算，周四至下周三为一周。</small></label>
        <label>赛制<select value={form.channel} onChange={(event) => changeChannel(event.target.value as Channel)}><option value="eleven">十一人制</option><option value="five">五人制</option></select></label>
      </div>
      <div className="form-grid two-cols">
        <label>赛事分类<select value={getMatchEvent(form) || (form.channel === 'eleven' ? 'freshmen-cup' : 'womens-pku-cup')} onChange={(event) => changeEvent(event.target.value as CompetitionEvent)}>{eventsForChannel(form.channel).map((item) => <option key={item.id} value={item.id}>{item.name} · {item.term}</option>)}</select></label>
        <label>日期<input type="date" required value={form.date} onChange={(event) => update('date', event.target.value)} /></label>
        <label>时间<input required placeholder="12:00-14:00" value={form.time} onChange={(event) => update('time', event.target.value)} /></label>
        <label>场地<input required value={form.venue} onChange={(event) => update('venue', event.target.value)} /></label>
        <label>组别<input value={form.group} onChange={(event) => update('group', event.target.value)} /></label>
        <label>比赛阶段<select value={form.stage} onChange={(event) => changeStage(event.target.value as Match['stage'])}>{!allowedStages(form.channel).includes(form.stage) && <option value={form.stage} disabled>旧阶段：{stageLabel(form.stage)}（请选择新阶段）</option>}{stageOptions(form.channel).map((stage) => <option key={stage.value} value={stage.value}>{stage.label}</option>)}</select></label>
      </div>
      {form.channel === 'eleven' && form.stage === 'placement' && <label>排位赛模式<select aria-label="排位赛模式" value={form.placementMode || 'grouped'} onChange={(event) => update('placementMode', event.target.value as Match['placementMode'])}><option value="grouped">分组排位：回避同组全部球队</option><option value="single">单场排位：仅回避对阵双方</option></select></label>}
      {form.channel === 'eleven' && ['knockout', 'semifinal', 'final', 'third'].includes(form.stage) ? <fieldset className="advancement-fields"><legend>参赛球队与晋级来源</legend><p className="adjustment-help">直接选择球队，或从同赛事、同学期的比赛胜负者和小组名次自动晋级。未定球队会保留全部候选用于回避检查。</p>{(['home', 'away'] as const).map((side) => {
        const source = form[`${side}Source`];
        const label = side === 'home' ? '主队' : '客队';
        const mode = source?.kind === 'match' ? source.outcome : source?.kind === 'group' ? 'group' : 'direct';
        const candidates = side === 'home' ? resolvedTeams.homeCandidates : resolvedTeams.awayCandidates;
        return <div className="advancement-slot" key={side}><div className="form-grid two-cols"><label>{label}来源<select aria-label={`${label}来源`} value={mode} onChange={(event) => setSource(side, event.target.value as 'direct' | 'winner' | 'loser' | 'group')}><option value="direct">直接选择球队</option><option value="winner">比赛胜者</option><option value="loser">比赛负者</option><option value="group">小组名次</option></select></label>{!source && <label>{label}<select aria-label={label} value={form[side]} onChange={(event) => chooseTeam(side, event.target.value)}><option value="">请选择球队（可暂不选择）</option>{teams.map((team) => <option key={team.name} value={team.name}>{team.name}{team.bound ? '' : ' · 未绑定学院/颜色'}</option>)}</select></label>}{source?.kind === 'match' && <label>{label}来源比赛<select aria-label={`${label}来源比赛`} value={source.matchId} onChange={(event) => patchSource(side, { ...source, matchId: event.target.value })}><option value="">请选择来源比赛</option>{sourceMatches.map((item) => <option key={item.id} value={item.id}>{item.date} · {item.home || item.group}—{item.away} · {item.id}</option>)}</select></label>}{source?.kind === 'group' && <><label>来源小组<input aria-label={`${label}来源小组`} required value={source.group} onChange={(event) => patchSource(side, { ...source, group: event.target.value })} /></label><label>小组名次<input aria-label={`${label}小组名次`} type="number" min="1" step="1" value={source.rank} onChange={(event) => patchSource(side, { ...source, rank: Number(event.target.value) })} /></label></>}</div><p className="advancement-preview">{label}：{candidates.length ? candidates.join(' / ') : '待定'}{candidates.length > 1 ? '（候选）' : ''}</p></div>;
      })}</fieldset> : <div className="form-grid two-cols">{(['home', 'away'] as const).map((side) => <label key={side}>{side === 'home' ? '主队' : '客队'}<select aria-label={side === 'home' ? '主队' : '客队'} value={form[side]} onChange={(event) => chooseTeam(side, event.target.value)}><option value="">请选择球队（可暂不选择）</option>{teams.map((team) => <option key={team.name} value={team.name}>{team.name}{team.bound ? '' : ' · 未绑定学院/颜色'}</option>)}</select></label>)}</div>}
      <p className="adjustment-help">球队按赛事分别维护，请先在“球队与球衣”中绑定学院和颜色。直接选择球队后自动填色；下方可为本场临时调整，不改写球队默认色或历史比赛。</p>
      <div className="form-grid two-cols">
        <label>主队球衣颜色<div className="color-input"><input type="color" aria-label="主队球衣颜色" value={form.homeColor || '#FFFFFF'} onChange={(event) => update('homeColor', event.target.value.toUpperCase())} /><span>{form.homeColor || '未设置'}</span><button type="button" aria-label="清除主队球衣颜色" onClick={() => update('homeColor', '')}>清除</button></div></label>
        <label>客队球衣颜色<div className="color-input"><input type="color" aria-label="客队球衣颜色" value={form.awayColor || '#FFFFFF'} onChange={(event) => update('awayColor', event.target.value.toUpperCase())} /><span>{form.awayColor || '未设置'}</span><button type="button" aria-label="清除客队球衣颜色" onClick={() => update('awayColor', '')}>清除</button></div></label>
      </div>
      <div className="form-grid two-cols">{form.event === 'mens-pku-cup' && <label>北大杯级别<select value={form.division || ''} onChange={(event) => update('division', (event.target.value || null) as Match['division'])}><option value="">请选择甲／乙级</option><option value="甲">甲级（工资 ×1.1）</option><option value="乙">乙级</option></select></label>}<label>比赛状态<select value={form.status} onChange={(event) => changeStatus(event.target.value as Match['status'])}><option value="scheduled">待进行（结束后自动完成）</option><option value="completed">手动标记已完成</option><option value="cancelled">已取消</option></select></label></div>
      {form.status !== 'cancelled' && <fieldset className="bonus-checks interruption-settings"><legend>比赛中断与接续</legend>
        <label><input type="checkbox" aria-label="比赛中断" checked={form.interrupted || false} onChange={(event) => changeInterruption(event.target.checked)} />比赛中断</label>
        {form.interrupted && <div className="form-grid two-cols">
          <label>接续比赛日期<input type="date" aria-label="接续比赛日期" value={form.resumption?.date || ''} onChange={(event) => changeResumption({ date: event.target.value })} /></label>
          <label>接续比赛时段<input aria-label="接续比赛时段" value={form.resumption?.time || ''} placeholder="例如 14:00-16:00" onChange={(event) => changeResumption({ time: event.target.value })} /></label>
          <p className="adjustment-help">{canResume ? '可在需要换裁的岗位启用续赛选派；未更换裁判的岗位仍计 1 场。' : '填写接续比赛日期和时段后，才会显示续赛裁判选派选项；时间未定时可先保存中断设置。'}</p>
        </div>}
      </fieldset>}
      {form.status === 'completed' && <fieldset className="result-fields"><legend>比赛结果</legend>{form.result && <button type="button" className="button secondary" onClick={() => update('result', undefined)}>清除赛果</button>}<p className="adjustment-help">比分可暂不录入；未录入不参与积分榜和晋级。小组赛胜 3、平 1、负 0，淘汰赛须有明确胜负。</p><div className="score-inputs"><label>主队比分<input aria-label="主队比分" type="number" required={Boolean(form.result)} min="0" step="1" value={form.result?.home ?? ''} onChange={(event) => updateScore('home', event.target.value)} /></label><span>:</span><label>客队比分<input aria-label="客队比分" type="number" required={Boolean(form.result)} min="0" step="1" value={form.result?.away ?? ''} onChange={(event) => updateScore('away', event.target.value)} /></label>{form.channel === 'eleven' && ['knockout', 'semifinal', 'final', 'third'].includes(form.stage) && form.result?.home === form.result?.away && <><span>点球</span><label>主队点球<input aria-label="主队点球" type="number" required min="0" step="1" value={form.result?.homePenalties ?? ''} onChange={(event) => updateScore('homePenalties', event.target.value)} /></label><span>:</span><label>客队点球<input aria-label="客队点球" type="number" required min="0" step="1" value={form.result?.awayPenalties ?? ''} onChange={(event) => updateScore('awayPenalties', event.target.value)} /></label></>}</div></fieldset>}
      {form.status !== 'cancelled' && <fieldset className="advancement-fields match-avoidance-settings"><legend>本场回避</legend>
        <label>回避计算方式<select aria-label="回避计算方式" value={form.avoidanceOverride?.mode || 'auto'} onChange={(event) => {
          const mode = event.target.value as 'auto' | 'supplement' | 'replace';
          update('avoidanceOverride', mode === 'auto' ? undefined : { mode, colleges: form.avoidanceOverride?.colleges || (mode === 'replace' ? automaticAvoidance.colleges : []) });
        }}><option value="auto">自动计算</option><option value="supplement">自动计算并补充</option><option value="replace">手动指定完整名单</option></select></label>
        <p className="adjustment-help">{!form.avoidanceOverride ? '根据球队学院、同组球队及下一轮候选对手自动计算。' : form.avoidanceOverride.mode === 'supplement' ? '勾选额外需要回避的学院，与自动名单合并；自动判定缺少资料时仍会提醒。' : '以下勾选作为本场完整回避名单，替代自动计算。请包含对阵双方及规则要求的其他学院；未勾选表示本场无回避学院。'}仅影响本场比赛。</p>
        {form.avoidanceOverride && <div className="bonus-checks college-options match-avoidance-options" role="group" aria-label="本场回避学院">{(data!.colleges || []).map((college) => <label key={college}><input type="checkbox" aria-label={`本场回避${college}`} checked={form.avoidanceOverride!.colleges.includes(college)} onChange={(event) => update('avoidanceOverride', { ...form.avoidanceOverride!, colleges: event.target.checked ? [...form.avoidanceOverride!.colleges, college] : form.avoidanceOverride!.colleges.filter((item) => item !== college) })} />{college}</label>)}{!data!.colleges?.length && <p className="adjustment-help">请先在“球队与球衣”的学院名录中登记学院。</p>}</div>}
        <p className="advancement-preview" aria-label="本场生效回避">本场生效回避：{avoidance.colleges.length ? avoidance.colleges.join('、') : avoidance.complete ? '无' : '待设置'}{!avoidance.complete && avoidance.colleges.length > 0 ? '（资料不全）' : ''}</p>
      </fieldset>}
      {form.channel === 'eleven' && <fieldset className="additional-assistant-setting"><label><input type="checkbox" checked={Boolean(form.additionalAssistants)} onChange={(e) => changeAdditional(e.target.checked)} />需要附加助理裁判（2 人）</label><p>启用后增加两个岗位，工资、积分及半决赛/决赛补贴均与助理裁判相同。</p></fieldset>}
      {form.status !== 'cancelled' && ['semifinal', 'final'].includes(form.stage) && <p className="automatic-supplement" role="status">{form.stage === 'semifinal' ? '半决赛' : '决赛'}补贴自动计入工资：{form.channel === 'eleven' ? '主裁、助理及附加助理' : '第一、第二裁判'}每人 +{form.stage === 'semifinal' ? 10 : 20} 元，{form.channel === 'eleven' ? '第四官员' : '第三裁判'} +{form.stage === 'semifinal' ? 5 : 10} 元，无需再登记奖惩。</p>}
      {form.status === 'cancelled' ? <p className="inline-empty">比赛已取消，无需选派裁判。</p> : <fieldset className="official-fields"><legend>裁判选派</legend><p className="adjustment-help">输入姓名后在下拉框中选派；没有档案时可选择“新建并选派”，保存比赛时自动创建。已有其他赛制档案会直接补齐本赛制，不重复建档。</p>{form.officials.map((official, index) => {
        const paired = official.fraction === 0.5;
        const firstForRole = form.officials.findIndex((o) => o.role === official.role) === index;
        if (paired && !canResume && !firstForRole) return null;
        const baseRoleLabel = roleName(official.role);
        const roleLabel = paired && canResume ? `${baseRoleLabel}（${firstForRole ? '原场' : '续赛'}）` : baseRoleLabel;
        const typedName = normalizeRefereeName(officialQueries[index] || '');
        const query = refereeNameKey(typedName);
        const pendingName = !official.refereeId ? official.name : '';
        const candidateName = query && !data!.referees.some((referee) => referee.channels[form.channel] && refereeNameKey(referee.name) === query) ? typedName : '';
        const pendingNames = [...new Set([pendingName, candidateName].filter(Boolean))];
        const eligibleReferees = data!.referees
          .filter((referee) => referee.channels[form.channel])
          .filter((referee) => referee.id === official.refereeId || refereeNameKey(referee.name).includes(query))
          .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
        return <div className="official-input" key={`${official.role}-${index}`}>
          <span>{roleLabel}</span>
          <div className="official-picker">
            <input type="search" maxLength={40} aria-label={`${roleLabel}搜索`} value={officialQueries[index] || ''} onChange={(event) => setOfficialQueries((current) => ({ ...current, [index]: event.target.value }))} placeholder="搜索或输入新裁判姓名" />
            <select aria-label={roleLabel} value={official.refereeId || (pendingName ? `new:${pendingName}` : '')} onChange={(event) => {
              const selected = data!.referees.find((item) => item.id === event.target.value);
              const newName = !selected && event.target.value.startsWith('new:') ? event.target.value.slice(4) : '';
              const refereeId = newName ? null : event.target.value || null;
              setForm((current) => ({ ...current, officials: current.officials.map((item, i) => i === index ? { ...item, refereeId, name: selected?.name || newName } : item) }));
            }}><option value="">待选派</option>{eligibleReferees.map((referee) => <option key={referee.id} value={referee.id}>{referee.name}</option>)}{pendingNames.map((name) => <option key={`new:${name}`} value={`new:${name}`}>{data!.referees.some((referee) => refereeNameKey(referee.name) === refereeNameKey(name)) ? '选派并补齐档案' : '新建并选派'}：{name}</option>)}{!eligibleReferees.length && !pendingNames.length && <option disabled>没有匹配的裁判员</option>}</select>
          </div>
          {!paired && (official.refereeId || official.name) && <label className="substitute-check"><input type="checkbox" checked={official.substitute || false} onChange={(event) => setForm((current) => ({ ...current, officials: current.officials.map((item, i) => i === index ? { ...item, substitute: event.target.checked } : item) }))} />临时替补 +10 元</label>}
          {firstForRole && canResume && <label className="substitute-check"><input type="checkbox" aria-label={`${baseRoleLabel}续赛换裁`} checked={paired} onChange={(event) => toggleContinuation(official.role, event.target.checked)} />中断后续赛更换裁判</label>}
          {paired && canResume && <div className="continuation-fields form-grid three-cols">
            <label>执裁日期<input type="date" aria-label={`${roleLabel}执裁日期`} required value={official.dutyDate || form.date} onChange={(event) => patchOfficial(index, { dutyDate: event.target.value })} /></label>
            <label>执裁时段<input aria-label={`${roleLabel}执裁时段`} required value={official.dutyTime || form.time} onChange={(event) => patchOfficial(index, { dutyTime: event.target.value })} placeholder="12:00-14:00" /></label>
            <label>本次实际补贴（元）<input type="number" min="0" step="0.5" aria-label={`${roleLabel}实际补贴`} required value={official.actualBonus ?? 0} onChange={(event) => patchOfficial(index, { actualBonus: Number(event.target.value) })} /></label>
            <p className="adjustment-help">各计 0.5 场、积分及基础工资各半；本次补贴按实际金额填写（包含时间、天气、阶段、临替等补贴，可填 0）。</p>
          </div>}
          {analysis.issues.filter((issue) => issue.includes(`（${roleLabel}）`) && issue.includes(official.name)).map((issue) => <p className="official-avoidance-issue" key={issue}>{issue}</p>)}
        </div>;
      })}</fieldset>}
      <fieldset className="bonus-checks"><legend>时间补贴（自动判定）</legend>{timeBonusKinds.map((bonus) => <label key={bonus}><input type="checkbox" checked={automaticBonuses.includes(bonus)} disabled readOnly />{timeBonusLabels[bonus]}</label>)}<p className="time-bonus-help">10:00及以前开赛为早场，20:00及以后为晚场；非周六、周日为非常规时间。按比赛日期及开赛时间自动更新，命中多项仍只计一次 10 元时间补贴。</p></fieldset>
      <fieldset className="bonus-checks"><legend>其他补贴</legend><label><input type="checkbox" checked={form.bonuses.includes('badWeather')} onChange={(e) => update('bonuses', e.target.checked ? [...form.bonuses, 'badWeather'] : form.bonuses.filter((bonus) => bonus !== 'badWeather'))} />恶劣天气</label></fieldset>
      <label>备注<textarea rows={2} value={form.note} onChange={(event) => update('note', event.target.value)} /></label>
      {warnings.length > 0 && <div className="form-warning" role="status"><strong>回避资料提醒（不阻止保存）</strong>{warnings.map((warning) => <p key={warning}>{warning}</p>)}</div>}
      {issues.length > 0 && <div className="form-error" role="alert"><strong>请先处理赛果或选派冲突</strong>{issues.map((issue) => <p key={issue}>{issue}</p>)}</div>}{error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-actions">{form.id && <button type="button" className="button danger-ghost" onClick={() => void remove()}><Trash2 size={16} />删除</button>}<button type="button" className="button secondary" onClick={onClose}>取消</button><button className="button primary" disabled={saving || issues.length > 0}><Save size={16} />{saving ? '保存中…' : '保存比赛'}</button></div>
    </form>
  );
}
