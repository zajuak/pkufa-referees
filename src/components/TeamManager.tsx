import { useState, type FormEvent } from 'react';
import { api, useData } from '../hooks/useData';
import { competitionEvents } from '../domain/competitions';
import { eventTeams } from '../domain/teams';
import type { CompetitionEvent } from '../domain/types';

export default function TeamManager() {
  const { data, refresh } = useData();
  const [event, setEvent] = useState<CompetitionEvent>('freshmen-cup');
  const [name, setName] = useState('');
  const [color, setColor] = useState('#FFFFFF');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const teams = eventTeams(data!, event);
  const save = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setMessage('');
    try { await api('/api/teams', { method: 'PUT', body: JSON.stringify({ event, name, color }) }); await refresh(); setMessage(`${name.trim()}的球衣颜色已绑定，选派时选择该队即可自动填入。`); setName(''); }
    catch (error) { setMessage(error instanceof Error ? error.message : '保存失败'); }
    finally { setBusy(false); }
  };
  const unbind = async (team: string) => {
    if (!confirm(`解除“${team}”的默认颜色绑定？历史比赛的球衣颜色不会改变。`)) return;
    setBusy(true); setMessage('');
    try { await api(`/api/teams?event=${encodeURIComponent(event)}&name=${encodeURIComponent(team)}`, { method: 'DELETE' }); await refresh(); setMessage('已解除默认颜色绑定，历史赛程保持原样。'); }
    catch (error) { setMessage(error instanceof Error ? error.message : '解除失败'); }
    finally { setBusy(false); }
  };
  return <section className="admin-section"><div className="admin-section-heading"><div><h2>球队与球衣颜色</h2><p>同一球队可在不同赛事绑定不同颜色。保存后，比赛表单中选择球队会自动带入默认颜色；历史比赛不追溯改色。</p></div></div><label className="team-event-field">球队所属赛事<select aria-label="球队所属赛事" value={event} onChange={(e) => { setEvent(e.target.value as CompetitionEvent); setName(''); setMessage(''); }}>{competitionEvents.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><form className="admin-form" onSubmit={save}><div className="form-grid two-cols"><label>球队名称<input aria-label="绑定球队名称" required maxLength={60} list="event-team-names" value={name} onChange={(e) => setName(e.target.value)} placeholder="选择历史球队或输入新球队" /><datalist id="event-team-names">{teams.map((team) => <option key={team.name} value={team.name} />)}</datalist></label><label>默认球衣颜色<div className="color-input"><input aria-label="绑定球衣颜色" type="color" value={color} onChange={(e) => setColor(e.target.value.toUpperCase())} /><span>{color}</span></div></label></div><div className="form-actions"><button className="button primary" disabled={busy}>保存球队颜色绑定</button></div></form>{message && <p className="form-message" role="status">{message}</p>}<div className="team-binding-list">{teams.map((team) => <div className="operation-row" key={team.name}><span className="team-binding-color" style={{ backgroundColor: team.color || '#FFFFFF' }} /><div><strong>{team.name}</strong><p>{team.bound ? team.color : '历史球队 · 尚未绑定默认色'}</p></div><button className="button secondary" disabled={busy} onClick={() => { setName(team.name); setColor(team.color || '#FFFFFF'); setMessage(''); }}>{team.bound ? '修改颜色' : '绑定颜色'}</button>{team.bound && <button className="button secondary" disabled={busy} onClick={() => void unbind(team.name)}>解除绑定</button>}</div>)}{!teams.length && <p className="inline-empty">此赛事还没有球队，请先添加球队并绑定颜色。</p>}</div></section>;
}
