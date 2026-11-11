import { useState, type FormEvent } from 'react';
import { api, useData } from '../hooks/useData';
import { competitionEvents } from '../domain/competitions';
import { eventTeams, normalizeTeamName } from '../domain/teams';
import type { CompetitionEvent } from '../domain/types';
import AvoidanceManager from './AvoidanceManager';

export default function TeamManager() {
  const { data, refresh } = useData();
  const [event, setEvent] = useState<CompetitionEvent>('freshmen-cup');
  const [name, setName] = useState('');
  const [color, setColor] = useState('#FFFFFF');
  const [colleges, setColleges] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const teams = eventTeams(data!, event);
  const registeredColleges = data!.colleges || [];
  const chooseTeam = (teamName: string) => {
    setName(teamName);
    const selected = teams.find((team) => team.name === normalizeTeamName(teamName));
    if (selected) {
      setColor(selected.color || '#FFFFFF');
      setColleges(selected.colleges || []);
    }
  };
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      await api('/api/teams', { method: 'PUT', body: JSON.stringify({ event, name, color, colleges }) });
      await refresh();
      setMessage(`${name.trim()}的球队、学院与球衣绑定已保存，选派时选择该队即可自动填入默认颜色。`);
      setName('');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '保存失败');
    } finally {
      setBusy(false);
    }
  };
  const unbind = async (team: string) => {
    if (!confirm(`解除“${team}”的默认球衣颜色和学院绑定？历史比赛的球衣颜色不会改变。`)) return;
    setBusy(true);
    setMessage('');
    try {
      await api(`/api/teams?event=${encodeURIComponent(event)}&name=${encodeURIComponent(team)}`, { method: 'DELETE' });
      await refresh();
      setMessage('已解除默认球衣颜色和学院绑定，历史赛程的球衣颜色保持原样。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '解除失败');
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <AvoidanceManager />
      <section className="admin-section" aria-busy={busy}>
        <div className="admin-section-heading"><div><h2>球队、学院与球衣</h2><p>同一球队可在不同赛事绑定不同学院和默认球衣颜色。保存后，比赛表单中选择球队会自动带入默认颜色；历史比赛不追溯改色。</p></div></div>
        <label className="team-event-field">球队所属赛事<select aria-label="球队所属赛事" value={event} onChange={(e) => { setEvent(e.target.value as CompetitionEvent); setName(''); setColleges([]); setMessage(''); }}>{competitionEvents.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <form className="admin-form" onSubmit={(e) => void save(e)}>
          <div className="form-grid two-cols">
            <label>球队名称<input aria-label="绑定球队名称" required maxLength={60} list="event-team-names" value={name} onChange={(e) => chooseTeam(e.target.value)} placeholder="选择历史球队或输入新球队" /><datalist id="event-team-names">{teams.map((team) => <option key={team.name} value={team.name} />)}</datalist></label>
            <label>默认球衣颜色<div className="color-input"><input aria-label="绑定球衣颜色" type="color" value={color} onChange={(e) => setColor(e.target.value.toUpperCase())} /><span>{color}</span></div></label>
          </div>
          <fieldset className="bonus-checks college-options">
            <legend>绑定学院（可多选）</legend>
            {registeredColleges.map((college) => <label key={college}><input type="checkbox" aria-label={`球队学院${college}`} checked={colleges.includes(college)} disabled={busy} onChange={(e) => setColleges((current) => e.target.checked ? [...current, college] : current.filter((item) => item !== college))} />{college}</label>)}
            {!registeredColleges.length && <p className="college-empty-hint">尚未登记学院，请先使用上方“学院名录与裁判回避”添加。</p>}
          </fieldset>
          <div className="form-actions"><button className="button primary" disabled={busy}>{busy ? '保存中…' : '保存球队、学院与球衣绑定'}</button></div>
        </form>
        {message && <p className="form-message" role="status">{message}</p>}
        <div className="team-binding-list">
          {teams.map((team) => (
            <div className="operation-row" key={team.name}>
              <span className="team-binding-color" style={{ backgroundColor: team.color || '#FFFFFF' }} />
              <div><strong>{team.name}</strong><p>{team.bound ? `默认球衣：${team.color}` : '历史球队 · 尚未绑定默认色'}</p>{team.bound && <p>学院：{team.colleges?.length ? team.colleges.join('、') : '未绑定'}</p>}</div>
              <button className="button secondary" disabled={busy} onClick={() => { chooseTeam(team.name); setMessage(''); }}>{team.bound ? '修改绑定' : '绑定设置'}</button>
              {team.bound && <button className="button secondary" disabled={busy} onClick={() => void unbind(team.name)}>解除绑定</button>}
            </div>
          ))}
          {!teams.length && <p className="inline-empty">此赛事还没有球队，请先添加球队并绑定学院与球衣。</p>}
        </div>
      </section>
    </>
  );
}
