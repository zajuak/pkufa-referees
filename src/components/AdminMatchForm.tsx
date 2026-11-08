import { useState } from 'react';
import { Save, Trash2, X } from 'lucide-react';
import { api, useData } from '../hooks/useData';
import { availableSeasons, CURRENT_SEASON, roleName } from '../domain/calculations';
import { defaultCompetition, eventsForChannel, getMatchEvent } from '../domain/competitions';
import { assignmentIssues, matchRoles, requiredRoles, usesAdditionalAssistants } from '../domain/scheduling';
import { eventTeams, teamColor } from '../domain/teams';
import type { Bonus, Channel, CompetitionEvent, Match } from '../domain/types';

const bonusLabels: Record<Bonus, string> = { early: '早场', late: '晚场', weekday: '周中', badWeather: '恶劣天气' };

function emptyMatch(): Match {
  return {
    id: '', season: CURRENT_SEASON, week: 1, channel: 'eleven', event: 'freshmen-cup', competition: '新生杯', date: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date()), time: '12:00-14:00', venue: '北场', group: 'A', home: '', away: '', homeColor: '', awayColor: '', stage: 'group', division: null, status: 'scheduled', note: '', bonuses: [],
    additionalAssistants: false, officials: requiredRoles('eleven').map((role) => ({ role, refereeId: null, name: '' })),
  };
}

export default function AdminMatchForm({ match, onClose }: { match: Match | null; onClose: () => void }) {
  const { data, refresh } = useData();
  const [form, setForm] = useState<Match>(() => {
    if (!match) return emptyMatch();
    const event = getMatchEvent(match) || (match.channel === 'eleven' ? 'freshmen-cup' : 'womens-pku-cup');
    return { ...emptyMatch(), ...match, event,
      homeColor: match.homeColor || teamColor(data!, event, match.home),
      awayColor: match.awayColor || teamColor(data!, event, match.away),
      additionalAssistants: usesAdditionalAssistants(match),
      officials: match.status === 'cancelled' ? [] : matchRoles(match).map((role) => match.officials.find((item) => item.role === role) || { role, refereeId: null, name: '' }),
    };
  });
  const [saving, setSaving] = useState(false);
  const [officialQueries, setOfficialQueries] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const issues = assignmentIssues(form, data!.matches, data!.unavailability);
  const seasons = availableSeasons(data!.matches, data!.adjustments);
  const update = <K extends keyof Match>(key: K, value: Match[K]) => setForm((current) => ({ ...current, [key]: value }));
  const changeChannel = (channel: Channel) => setForm((current) => {
    const event = channel === 'eleven' ? 'freshmen-cup' : 'womens-pku-cup';
    return { ...current, channel, event, competition: defaultCompetition(event), additionalAssistants: false, home: '', away: '', homeColor: '', awayColor: '', officials: current.status === 'cancelled' ? [] : requiredRoles(channel).map((role) => ({ role, refereeId: null, name: '' })) };
  });
  const changeEvent = (event: CompetitionEvent) => setForm((current) => ({ ...current, event, competition: defaultCompetition(event), home: '', away: '', homeColor: '', awayColor: '' }));
  const changeStatus = (status: Match['status']) => setForm((current) => ({
    ...current,
    status,
    officials: status === 'cancelled' ? [] : matchRoles(current).map((role) => current.officials.find((item) => item.role === role) || { role, refereeId: null, name: '' }),
  }));

  const selectedEvent = getMatchEvent(form) || 'freshmen-cup';
  const teams = eventTeams(data!, selectedEvent);
  for (const name of [form.home, form.away]) if (name && !teams.some((team) => team.name === name)) teams.push({ event: selectedEvent, name, color: '', bound: false });
  const chooseTeam = (side: 'home' | 'away', name: string) => setForm((current) => ({ ...current, [side]: name, [`${side}Color`]: teamColor(data!, selectedEvent, name) }));
  const changeAdditional = (enabled: boolean) => {
    if (!enabled && form.officials.some((o) => o.role.startsWith('additionalAssistant') && o.refereeId) && !window.confirm('关闭后将移除本场的两名附加助理选派，并重算工资积分，是否继续？')) return;
    setForm((current) => ({ ...current, additionalAssistants: enabled, officials: current.status === 'cancelled' ? [] : requiredRoles(current.channel, enabled).map((role) => current.officials.find((o) => o.role === role) || { role, refereeId: null, name: '' }) }));
  };

  const save = async () => {
    setSaving(true); setError('');
    try {
      await api(form.id ? `/api/matches/${form.id}` : '/api/matches', { method: form.id ? 'PUT' : 'POST', body: JSON.stringify(form) });
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
        <label>周次<input type="number" min="1" required value={form.week} onChange={(event) => update('week', Number(event.target.value))} /></label>
        <label>赛制<select value={form.channel} onChange={(event) => changeChannel(event.target.value as Channel)}><option value="eleven">十一人制</option><option value="five">五人制</option></select></label>
      </div>
      <div className="form-grid two-cols">
        <label>赛事分类<select value={getMatchEvent(form) || (form.channel === 'eleven' ? 'freshmen-cup' : 'womens-pku-cup')} onChange={(event) => changeEvent(event.target.value as CompetitionEvent)}>{eventsForChannel(form.channel).map((item) => <option key={item.id} value={item.id}>{item.name} · {item.term}</option>)}</select></label>
        <label>日期<input type="date" required value={form.date} onChange={(event) => update('date', event.target.value)} /></label>
        <label>时间<input required placeholder="12:00-14:00" value={form.time} onChange={(event) => update('time', event.target.value)} /></label>
        <label>场地<input required value={form.venue} onChange={(event) => update('venue', event.target.value)} /></label>
        <label>组别<input value={form.group} onChange={(event) => update('group', event.target.value)} /></label>
        <label>比赛阶段<select value={form.stage} onChange={(event) => update('stage', event.target.value as Match['stage'])}><option value="group">小组赛</option><option value="knockout">淘汰赛</option><option value="semifinal">半决赛</option><option value="third">季军赛</option><option value="final">决赛</option></select></label>
      </div>
      <div className="form-grid two-cols">{(['home', 'away'] as const).map((side) => <label key={side}>{side === 'home' ? '主队' : '客队'}<select aria-label={side === 'home' ? '主队' : '客队'} value={form[side]} onChange={(e) => chooseTeam(side, e.target.value)}><option value="">请选择球队（可暂不选择）</option>{teams.map((team) => <option key={team.name} value={team.name}>{team.name}{team.bound ? '' : ' · 未绑定颜色'}</option>)}</select></label>)}</div>
      <p className="adjustment-help">球队按赛事分别维护，请先在“球队与球衣”中绑定。选择球队后自动填色；下方可为本场临时调整，不改写球队默认色或历史比赛。</p>
      <div className="form-grid two-cols">
        <label>主队球衣颜色<div className="color-input"><input type="color" aria-label="主队球衣颜色" value={form.homeColor || '#FFFFFF'} onChange={(event) => update('homeColor', event.target.value.toUpperCase())} /><span>{form.homeColor || '未设置'}</span><button type="button" aria-label="清除主队球衣颜色" onClick={() => update('homeColor', '')}>清除</button></div></label>
        <label>客队球衣颜色<div className="color-input"><input type="color" aria-label="客队球衣颜色" value={form.awayColor || '#FFFFFF'} onChange={(event) => update('awayColor', event.target.value.toUpperCase())} /><span>{form.awayColor || '未设置'}</span><button type="button" aria-label="清除客队球衣颜色" onClick={() => update('awayColor', '')}>清除</button></div></label>
      </div>
      <div className="form-grid two-cols"><label>联赛组别<select value={form.division || ''} onChange={(event) => update('division', (event.target.value || null) as Match['division'])}><option value="">不适用</option><option value="甲">甲组（北大杯工资 ×1.1）</option><option value="乙">乙组</option></select></label><label>比赛状态<select value={form.status} onChange={(event) => changeStatus(event.target.value as Match['status'])}><option value="scheduled">待进行（结束后自动完成）</option><option value="completed">手动标记已完成</option><option value="cancelled">已取消</option></select></label></div>
      {form.channel === 'eleven' && <fieldset className="additional-assistant-setting"><label><input type="checkbox" checked={Boolean(form.additionalAssistants)} onChange={(e) => changeAdditional(e.target.checked)} />需要附加助理裁判（2 人）</label><p>启用后增加两个岗位，工资、积分及半决赛/决赛补贴均与助理裁判相同。</p></fieldset>}
      {form.status !== 'cancelled' && ['semifinal', 'final'].includes(form.stage) && <p className="automatic-supplement" role="status">{form.stage === 'semifinal' ? '半决赛' : '决赛'}补贴自动计入工资：{form.channel === 'eleven' ? '主裁、助理及附加助理' : '第一、第二裁判'}每人 +{form.stage === 'semifinal' ? 10 : 20} 元，{form.channel === 'eleven' ? '第四官员' : '第三裁判'} +{form.stage === 'semifinal' ? 5 : 10} 元，无需再登记奖惩。</p>}
      {form.status === 'cancelled' ? <p className="inline-empty">比赛已取消，无需选派裁判。</p> : <fieldset className="official-fields"><legend>裁判选派</legend>{form.officials.map((official, index) => {
        const roleLabel = roleName(official.role);
        const query = (officialQueries[official.role] || '').trim().replace(/\s/g, '');
        const eligibleReferees = data!.referees
          .filter((referee) => referee.channels[form.channel])
          .filter((referee) => referee.id === official.refereeId || referee.name.replace(/\s/g, '').includes(query))
          .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
        return <div className="official-input" key={official.role}>
          <span>{roleLabel}</span>
          <div className="official-picker">
            <input type="search" aria-label={`${roleLabel}搜索`} value={officialQueries[official.role] || ''} onChange={(event) => setOfficialQueries((current) => ({ ...current, [official.role]: event.target.value }))} placeholder="搜索裁判员姓名" />
            <select aria-label={roleLabel} value={official.refereeId || ''} onChange={(event) => {
              const refereeId = event.target.value || null;
              const selected = data!.referees.find((item) => item.id === refereeId);
              setForm((current) => ({ ...current, officials: current.officials.map((item, i) => i === index ? { ...item, refereeId, name: selected?.name || '' } : item) }));
            }}><option value="">待选派</option>{eligibleReferees.map((referee) => <option key={referee.id} value={referee.id}>{referee.name}</option>)}{!eligibleReferees.length && <option disabled>没有匹配的裁判员</option>}</select>
          </div>
          {official.refereeId && <label className="substitute-check"><input type="checkbox" checked={official.substitute || false} onChange={(event) => setForm((current) => ({ ...current, officials: current.officials.map((item, i) => i === index ? { ...item, substitute: event.target.checked } : item) }))} />临时替补 +10 元</label>}
        </div>;
      })}</fieldset>}
      <fieldset className="bonus-checks"><legend>补贴标记</legend>{(Object.keys(bonusLabels) as Bonus[]).map((bonus) => <label key={bonus}><input type="checkbox" checked={form.bonuses.includes(bonus)} onChange={(event) => update('bonuses', event.target.checked ? [...form.bonuses, bonus] : form.bonuses.filter((item) => item !== bonus))} />{bonusLabels[bonus]}</label>)}</fieldset>
      <label>备注<textarea rows={2} value={form.note} onChange={(event) => update('note', event.target.value)} /></label>
      {issues.length > 0 && <div className="form-error" role="alert"><strong>请先处理选派冲突</strong>{issues.map((issue) => <p key={issue}>{issue}</p>)}</div>}{error && <p className="form-error" role="alert">{error}</p>}
      <div className="form-actions">{form.id && <button type="button" className="button danger-ghost" onClick={() => void remove()}><Trash2 size={16} />删除</button>}<button type="button" className="button secondary" onClick={onClose}>取消</button><button className="button primary" disabled={saving || issues.length > 0}><Save size={16} />{saving ? '保存中…' : '保存比赛'}</button></div>
    </form>
  );
}
