import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CalendarCheck, CalendarDays, Download, SearchX } from 'lucide-react';
import { useData } from '../hooks/useData';
import { ChannelBadge, EmptyState, PageHeader, StatusBadge } from '../components/ui';
import { availableSeasons, CURRENT_SEASON, effectiveMatchStatus, formatDate, stageName } from '../domain/calculations';
import { competitionEvents, getMatchEvent } from '../domain/competitions';
import { matchStageLabel } from '../domain/stages';
import { seasonWeekRange } from '../domain/weeks';
import { exportAssignments, exportCalendar } from '../domain/downloads';
import { additionalAssistantRoles, usesAdditionalAssistants } from '../domain/scheduling';
import type { Channel, Role } from '../domain/types';

const assignmentRoles: Record<Channel, Role[]> = {
  eleven: ['referee', 'assistant1', 'assistant2', 'fourth'],
  five: ['first', 'second', 'third'],
};

export default function AssignmentsPage() {
  const { data } = useData();
  const [params, setParams] = useSearchParams();
  const season = params.get('season') || data!.meta.season || CURRENT_SEASON;
  const query = params.get('q') || '';
  const statusFilter = params.get('status') || 'all';
  const channel = params.get('channel') || 'all';
  const event = params.get('event') || 'all';
  const venue = params.get('venue') || 'all';
  const categoryMatches = useMemo(() => data!.matches
    .filter((match) => (match.season || CURRENT_SEASON) === season)
    .filter((match) => channel === 'all' || match.channel === channel)
    .filter((match) => event === 'all' || getMatchEvent(match) === event), [data, season, channel, event]);
  const weeks = useMemo(() => [...new Set(categoryMatches.map((match) => match.week))].sort((a, b) => b - a), [categoryMatches]);
  const week = params.get('week') || String(weeks[0] || 'all');
  const venues = useMemo(() => [...new Set(categoryMatches.map((match) => match.venue))].sort(), [categoryMatches]);
  const filtered = useMemo(() => categoryMatches
    .filter((match) => week === 'all' || match.week === Number(week))
    .filter((match) => venue === 'all' || match.venue === venue)
    .filter((match) => statusFilter === 'all' || effectiveMatchStatus(match) === statusFilter)
    .filter((match) => `${match.home} ${match.away} ${match.officials.map((o) => o.name).join(' ')}`.includes(query.trim()))
    .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time)), [categoryMatches, week, venue, query, statusFilter]);
  const showAdditional = filtered.some((match) => match.status !== 'cancelled' && usesAdditionalAssistants(match));
  const roleLabels = ['主裁判 / 第一裁判', '第一助理 / 第二裁判', '第二助理 / 第三裁判', ...(showAdditional ? ['第一附加助理', '第二附加助理'] : []), '第四官员'];
  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    next.set(key, value);
    if (['season', 'channel', 'event'].includes(key)) { next.delete('week'); next.delete('venue'); }
    setParams(next);
  };
  const weekRange = (value: number) => {
    const dates = seasonWeekRange(value, season, data!.matches, data!.meta.season);
    if (!dates) return '';
    const short = (date: string) => `${Number(date.slice(5, 7))}.${Number(date.slice(8, 10))}`;
    return `${short(dates[0])} — ${short(dates[1])}`;
  };

  return (
    <div className="page assignments-page">
      <PageHeader eyebrow="ASSIGNMENT BOARD" title="每周裁判选派" description="秋季男足新生杯、春季男足北大杯、全学年女足北大杯。" actions={<span className="season-pill"><CalendarDays size={16} />{season} 学年</span>} />
      <section className="filter-panel">
        <div className="week-tabs" role="group" aria-label="选择周次">
          {weeks.map((value) => <button key={value} className={week === String(value) ? 'week-tab active' : 'week-tab'} onClick={() => update('week', String(value))}><span>第 {value} 周</span><small>{weekRange(value)}</small></button>)}
          <button className={week === 'all' ? 'week-tab active' : 'week-tab'} onClick={() => update('week', 'all')}><span>全部周次</span><small>完整赛程</small></button>
        </div>
        <div className="filter-row"><label className="select-field"><span>赛季</span><select value={season} onChange={(e) => update('season', e.target.value)}>{availableSeasons(data!.matches, data!.adjustments).map((s) => <option key={s}>{s}</option>)}</select></label>
          <div className="segmented" role="group" aria-label="赛制筛选">
            {[['all', '全部赛制'], ['eleven', '十一人制'], ['five', '五人制']].map(([value, label]) => <button key={value} className={channel === value ? 'active' : ''} onClick={() => update('channel', value)}>{label}</button>)}
          </div>
          <label className="select-field"><span>赛事</span><select value={event} onChange={(change) => update('event', change.target.value)}><option value="all">全部赛事</option>{competitionEvents.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.term}</option>)}</select></label>
          <label className="select-field"><span>场地</span><select value={venue} onChange={(change) => update('venue', change.target.value)}><option value="all">全部场地</option>{venues.map((item) => <option key={item}>{item}</option>)}</select></label>
        </div>
        <div className="filter-row assignment-search"><label className="select-field grow"><span>查找</span><input aria-label="搜索选派姓名或球队" placeholder="裁判姓名或球队" value={query} onChange={(e) => update('q', e.target.value)} /></label><label className="select-field"><span>状态</span><select value={statusFilter} onChange={(e) => update('status', e.target.value)}><option value="all">全部状态</option><option value="scheduled">待进行</option><option value="completed">已完成</option><option value="cancelled">已取消</option></select></label><button className="button secondary" disabled={!filtered.length} onClick={() => exportAssignments(filtered)}><Download size={16} />导出选派表</button><button className="button secondary" disabled={!filtered.length} onClick={() => exportCalendar(filtered, query.trim() || '裁判赛程')}>导出日历</button></div>
      </section>
      <div className="schedule-heading"><div><CalendarCheck size={20} /><h2>{week === 'all' ? '全部赛程' : `第 ${week} 周赛程`}</h2></div><span>共 {filtered.length} 场比赛 · 按时间正序</span></div>
      {filtered.length ? <section className="assignment-table-wrap">
        <table className={showAdditional ? 'assignment-table with-additional' : 'assignment-table'}>
          <thead><tr><th>日期</th><th>时间</th><th>赛制 / 赛事</th><th>场地</th><th>组别 / 阶段</th><th>对阵</th>{roleLabels.map((label) => <th key={label}>{label}</th>)}<th>状态 / 备注</th></tr></thead>
          <tbody>{filtered.map((match) => {
            const status = effectiveMatchStatus(match);
            return <tr className={status} key={match.id}>
              <td data-label="日期"><div className="assignment-date"><strong>{formatDate(match.date)}</strong><small>第 {match.week} 周</small></div></td>
              <td className="assignment-time" data-label="时间">{match.time || '时间待定'}</td>
              <td data-label="赛制 / 赛事"><div className="assignment-competition"><ChannelBadge channel={match.channel} /><span>{match.competition}</span></div></td>
              <td data-label="场地">{match.venue}</td>
              <td data-label="组别 / 阶段">{matchStageLabel(match)}</td>
              <td data-label="对阵"><div className="assignment-versus">{match.home || match.away ? <><strong className="assignment-team"><JerseyColor side="主队" color={match.homeColor} />{match.home || '待定'}</strong><span>VS</span><strong className="assignment-team"><JerseyColor side="客队" color={match.awayColor} />{match.away || '待定'}</strong></> : <strong>{match.group || stageName(match.stage, match.channel)}</strong>}</div></td>
              {roleLabels.map((label, column) => {
                const baseRoles = assignmentRoles[match.channel];
                const columns = [baseRoles[0], baseRoles[1], baseRoles[2], ...(showAdditional ? (match.channel === 'eleven' && usesAdditionalAssistants(match) ? additionalAssistantRoles : [undefined, undefined]) : []), baseRoles[3]];
                const role = columns[column];
                const official = role ? match.officials.find((item) => item.role === role) : undefined;
                return <td className="assignment-official-cell" key={column} data-label={label}>{role && status !== 'cancelled' ? <span className={official?.name ? 'assignment-official' : 'assignment-official pending'}>{official?.name || '待选派'}{official?.substitute && <small>临替</small>}</span> : '—'}</td>;
              })}
              <td data-label="状态 / 备注"><div className="assignment-status"><StatusBadge status={status} />{match.note && !match.note.includes('比赛取消') && <small className="assignment-note">{match.note.replace(/\s/g, '')}</small>}</div></td>
            </tr>;
          })}</tbody>
        </table>
      </section> : <EmptyState icon={<SearchX />} title="没有符合条件的比赛" description="试试切换周次、赛制、赛事或场地筛选。" />}
      <p className="data-footnote">数据更新至 {new Date(data!.updatedAt || data!.meta.importedAt).toLocaleDateString('zh-CN')} · 未取消比赛的空缺岗位将显示为“待选派”</p>
    </div>
  );
}

function JerseyColor({ side, color }: { side: '主队' | '客队'; color?: string }) {
  const effectiveColor = color || '#FFFFFF';
  const label = `${side}球衣颜色 ${effectiveColor}`;
  return <span className="jersey-color" style={{ backgroundColor: effectiveColor }} role="img" aria-label={label} title={label} />;
}
