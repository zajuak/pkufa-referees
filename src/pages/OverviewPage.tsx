import { Link } from 'react-router-dom';
import { AlertTriangle, CalendarDays, CheckCircle2, UsersRound } from 'lucide-react';
import { useData } from '../hooks/useData';
import { PageHeader, EmptyState } from '../components/ui';
import { assignmentIssues, assignmentWarnings, vacantRoles } from '../domain/scheduling';
import { effectiveMatchStatus, roleName } from '../domain/calculations';
import type { Role } from '../domain/types';

export default function OverviewPage() {
  const { data, refresh } = useData();
  const matches = data!.matches.filter((m) => (m.season || data!.meta.season) === data!.meta.season);
  const upcoming = matches.filter((m) => effectiveMatchStatus(m) === 'scheduled').sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
  const context = { referees: data!.referees, teams: data!.teams || [], groupOrders: data!.groupOrders || [] };
  const conflicts = matches.flatMap((m) => assignmentIssues(m, data!.matches, data!.unavailability, context).map((issue) => ({ match: m, issue })));
  const warnings = matches.flatMap((m) => assignmentWarnings(m, data!.matches, data!.unavailability, context).map((warning) => ({ match: m, warning })));
  const vacancies = matches.filter((m) => vacantRoles(m).length);
  return <div className="overview-page">
    <PageHeader eyebrow="REFEREE OPERATIONS" title="裁判部工作台" description={`${data!.meta.season} 学年 · 选派检查与工作待办`} actions={<button className="button secondary" onClick={() => void refresh()}>刷新数据</button>} />
    <div className="overview-stats">{[[UsersRound, data!.referees.length, '在册裁判'], [CalendarDays, upcoming.length, '待进行比赛'], [AlertTriangle, vacancies.reduce((n, m) => n + vacantRoles(m).length, 0), '待补齐岗位'], [CheckCircle2, conflicts.length, '选派冲突提醒']].map(([Icon, value, label]) => { const I = Icon as typeof UsersRound; return <div className="panel overview-stat" key={String(label)}><I size={22} /><strong>{String(value)}</strong><span>{String(label)}</span></div>; })}</div>
    <section className="panel operations-panel"><div className="admin-section-heading"><div><h2>选派检查</h2><p>检查同场重复、跨场时间、请假与学院回避冲突。资料缺失单独提醒，历史空缺保留供补录。</p></div><Link className="button primary" to="/admin">前往管理</Link></div>
      {conflicts.map(({ match: m, issue }, i) => <div className="operation-row warning" key={`${m.id}-${i}`}><AlertTriangle size={18} /><div><strong>{m.date} {m.home || m.group}—{m.away}</strong><p>{issue}</p></div></div>)}
      {warnings.map(({ match: m, warning }, i) => <div className="operation-row avoidance-warning-row" key={`warning-${m.id}-${i}`}><AlertTriangle size={18} /><div><strong>{m.date} {m.home || m.group}—{m.away}</strong><p>{warning}</p></div></div>)}
      {vacancies.map((m) => <Link className="operation-row" key={m.id} to={`/assignments?week=${m.week}&season=${encodeURIComponent(m.season || data!.meta.season)}`}><CalendarDays size={18} /><div><strong>{m.date} {m.time} · {m.home || m.group}—{m.away}</strong><p>待选派：{vacantRoles(m).map((r) => roleName(r as Role)).join('、')}</p></div><span>查看</span></Link>)}
      {!conflicts.length && !vacancies.length && <p className="inline-empty">当前赛季选派完整，未发现冲突。</p>}
    </section>
    <section className="panel operations-panel"><div className="admin-section-heading"><div><h2>接下来的比赛</h2><p>比赛时间统一采用北京时间。</p></div><Link to="/assignments?week=all" className="button secondary">完整赛程</Link></div>{upcoming.length ? upcoming.slice(0, 10).map((m) => <div className="operation-row" key={m.id}><CalendarDays size={18} /><div><strong>{m.home || m.group}—{m.away}</strong><p>{m.date} {m.time} · {m.venue} · {m.competition}</p></div><span>{m.officials.filter((o) => o.refereeId).length} 人已选派</span></div>) : <EmptyState icon={<CalendarDays />} title="暂无待进行比赛" description="新增赛程后会出现在这里。" />}</section>
    <p className="data-footnote">最新保存：{new Date(data!.updatedAt || data!.meta.importedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })} · 数据版本 {data!.revision || 0}</p>
  </div>;
}
