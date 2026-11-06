import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowUpRight, Award, CalendarClock, ClipboardCheck, TrendingUp, WalletCards } from 'lucide-react';
import { useData } from '../hooks/useData';
import { availableSeasons, channelName, CURRENT_SEASON, formatDate, formatMoney, getChannelSummary, getCompetitionSummaries, getRefereeMatches, getSeasonWage, getUpgradeRecommendation, HISTORY_SEASON, nextLevelTarget, officialBonusDescription, roleName } from '../domain/calculations';
import { eventName, eventsForChannel } from '../domain/competitions';
import type { Channel, CompetitionEvent } from '../domain/types';
import { ChannelBadge, EmptyState, PageHeader, StatCard } from '../components/ui';
import MatchCard from '../components/MatchCard';

export default function RefereeDetailPage() {
  const { id } = useParams();
  const { data } = useData();
  const referee = data!.referees.find((item) => item.id === id);
  const channels = referee ? (['eleven', 'five'] as Channel[]).filter((item) => referee.channels[item]) : [];
  const [channel, setChannel] = useState<Channel>(channels[0] || 'eleven');
  const [season, setSeason] = useState(CURRENT_SEASON);
  const [selectedEvent, setSelectedEvent] = useState<CompetitionEvent | 'all'>('all');
  const seasons = useMemo(() => availableSeasons(data!.matches, data!.adjustments), [data]);
  if (!referee) return <div className="page"><EmptyState icon={<ClipboardCheck />} title="未找到裁判档案" description="该档案可能已被移除，请返回裁判员列表。" /><Link className="button primary" to="/referees">返回列表</Link></div>;
  const activeChannel = channels.includes(channel) ? channel : channels[0];
  const summary = getChannelSummary(referee, activeChannel, data!.matches, data!.adjustments, data!.wageStandards)!;
  const wage = getSeasonWage(referee, activeChannel, season, data!.matches, data!.adjustments, data!.wageStandards)!;
  const competitionSummaries = getCompetitionSummaries(referee, activeChannel, season, data!.matches, data!.adjustments, data!.wageStandards);
  const activeEvent = competitionSummaries.find((item) => item.event === selectedEvent);
  const displayedContributions = selectedEvent === 'all' ? wage.contributions : activeEvent?.contributions || [];
  const displayedAdjustments = selectedEvent === 'all' ? wage.adjustments : activeEvent?.adjustments || [];
  const unassignedAdjustments = wage.adjustments.filter((item) => !item.event);
  const target = nextLevelTarget(activeChannel, summary.level);
  const upgradeRecommendation = getUpgradeRecommendation(activeChannel, summary.level, summary.points);
  const upcoming = getRefereeMatches(referee.id, data!.matches, 'scheduled').filter((match) => match.channel === activeChannel);

  return (
    <div className="page referee-detail-page">
      <Link to="/referees" className="back-link"><ArrowLeft size={17} />返回裁判员列表</Link>
      <PageHeader eyebrow="REFEREE PROFILE" title={referee.name} description="个人裁判档案 · 当前积分与各赛季工资独立核算" actions={<div className="profile-badges">{channels.map((item) => <ChannelBadge key={item} channel={item} />)}</div>} />
      <div className="detail-toolbar">
        <div className="segmented channel-tabs" role="group" aria-label="选择裁判渠道">{channels.map((item) => <button key={item} className={activeChannel === item ? 'active' : ''} onClick={() => { setChannel(item); setSelectedEvent('all'); }}>{channelName(item)}</button>)}</div>
        <label className="season-select"><span>工资赛季</span><select value={season} onChange={(event) => { setSeason(event.target.value); setSelectedEvent('all'); }}>{seasons.map((item) => <option key={item} value={item}>{item}{item === CURRENT_SEASON ? ' · 本赛季' : ' · 历史赛季'}</option>)}</select></label>
      </div>
      <section className="stats-grid four detail-stats">
        <StatCard label={`${channelName(activeChannel)}当前积分`} value={summary.points.toFixed(1)} suffix="分" tone="red" />
        <StatCard label="当前等级" value={summary.level} suffix="级" />
        <StatCard label={`${season} 工资`} value={formatMoney(wage.total)} tone="green" />
        <StatCard label={`${season} 已完成`} value={wage.contributions.length} suffix="场" />
      </section>
      {season === CURRENT_SEASON ? <section className="competition-section">
        <div className="schedule-heading"><div><WalletCards size={20} /><h2>分赛事当前积分与工资</h2></div><span>不含历史基础积分</span></div>
        <div className="competition-grid">{eventsForChannel(activeChannel).map((config) => {
          const item = competitionSummaries.find((summaryItem) => summaryItem.event === config.id)!;
          return <button key={config.id} className={`competition-card${selectedEvent === config.id ? ' active' : ''}`} aria-pressed={selectedEvent === config.id} onClick={() => setSelectedEvent(selectedEvent === config.id ? 'all' : config.id)}>
            <span className="competition-term">{config.term}</span><h3>{config.name}</h3>
            <div className="competition-values"><span><small>当前赛事积分</small><strong>{item.points.toFixed(1)} <em>分</em></strong></span><span><small>当前赛事工资</small><strong>{formatMoney(item.total)}</strong></span></div>
            <p>{item.contributions.length} 场已结算 · 基础工资 {formatMoney(item.matchWage)} · 补贴 {formatMoney(item.bonusWage)}</p>
          </button>;
        })}</div>
        {selectedEvent !== 'all' && <button className="competition-reset" onClick={() => setSelectedEvent('all')}>查看全部赛事明细</button>}
        {unassignedAdjustments.length > 0 && <p className="competition-note">另有 {unassignedAdjustments.length} 条未归赛事奖惩，仅计入渠道总积分和赛季工资总额。</p>}
      </section> : <p className="historical-event-note">历史赛季仅保留原表已审核的工资总额，未按赛事拆分。</p>}
      <section className="profile-overview-grid">
        <div className="panel level-panel">
          <div className="panel-heading"><div><TrendingUp size={20} /><h2>积分与等级</h2></div><span>规则 2026 秋</span></div>
          <div className="level-display"><span className={`level-seal level-${summary.level}`}>{summary.level}</span><div><strong>{channelName(activeChannel)}裁判员</strong><p>{upgradeRecommendation?.kind === 'ready' ? `已达到 ${upgradeRecommendation.level} 级积分条件，由管理员在赛前审核` : target ? `距下一等级还需 ${(target - summary.points).toFixed(1)} 分` : '已达到当前渠道最高等级'}</p></div></div>
          {target && <div className="progress-track"><span style={{ width: `${Math.min(100, summary.points / target * 100)}%` }} /></div>}
          <div className="mini-breakdown"><span>历史基础积分 <strong>{summary.stats.basePoints.toFixed(1)}</strong></span><span>新增执裁积分 <strong>+{summary.matchPoints.toFixed(1)}</strong></span><span>奖惩积分 <strong>{summary.adjustmentPoints >= 0 ? '+' : ''}{summary.adjustmentPoints.toFixed(1)}</strong></span></div>
        </div>
        <div className="panel wage-panel">
          <div className="panel-heading"><div><WalletCards size={20} /><h2>{season} 工资构成</h2></div><span>{channelName(activeChannel)}</span></div>
          <div className="wage-total"><span>合计</span><strong>{formatMoney(wage.total)}</strong></div>
          <div className="wage-lines">
            {season === HISTORY_SEASON && <div><span>历史赛季已结算工资</span><strong>{formatMoney(wage.historical)}</strong></div>}
            <div><span>执裁基础工资</span><strong>{formatMoney(wage.matchWage)}</strong></div>
            <div><span>场次与天气补贴</span><strong>+{formatMoney(wage.bonusWage)}</strong></div>
            <div><span>奖惩工资</span><strong className={wage.adjustmentWage < 0 ? 'negative' : ''}>{wage.adjustmentWage >= 0 ? '+' : ''}{formatMoney(wage.adjustmentWage)}</strong></div>
          </div>
        </div>
      </section>
      <section className="panel detail-records">
        <div className="panel-heading"><div><ClipboardCheck size={20} /><h2>{season} {selectedEvent === 'all' ? '' : `${eventName(selectedEvent)} `}工资明细</h2></div><span>{displayedContributions.length} 条执裁记录</span></div>
        {season === HISTORY_SEASON && !displayedContributions.length ? (
          <div className="historical-summary"><Award size={24} /><div><strong>该赛季采用历史表格中的已审核结算结果</strong><p>历史执裁积分 {summary.stats.historical.pointsEarned.toFixed(1)} 分 · 奖金 {formatMoney(summary.stats.historical.bonusWage)} · 扣款 {formatMoney(summary.stats.historical.deductedWage)}</p><p>岗位场次：{Object.entries(summary.stats.historical.roleCounts).map(([role, count]) => `${({ referee: '主裁', assistant: '助理', fourth: '四官', firstSecond: '一/二裁', third: '三裁' } as Record<string, string>)[role] || role} ${count}`).join(' · ') || '暂无记录'}</p></div></div>
        ) : displayedContributions.length ? <div className="records-table-wrap"><table className="records-table"><thead><tr><th>日期 / 赛事</th><th>岗位</th><th>积分</th><th>基础工资</th><th>补贴</th><th>合计</th></tr></thead><tbody>{displayedContributions.map((item, index) => <tr key={`${item.match.id}-${index}`}><td><strong>{formatDate(item.match.date)}</strong><small>{item.match.competition} · {item.match.home}{item.match.home && item.match.away ? ' vs ' : ''}{item.match.away}</small></td><td>{roleName(item.official.role)}</td><td>+{item.points.toFixed(1)}</td><td>{formatMoney(item.baseWage)}</td><td>+{formatMoney(item.bonusWage)}{item.bonusWage > 0 && <small className="wage-note">{officialBonusDescription(item.match, item.official)}</small>}</td><td><strong>{formatMoney(item.wage)}</strong></td></tr>)}</tbody></table></div> : <EmptyState icon={<ClipboardCheck />} title="本赛季暂无已结算执裁" description="管理员将比赛标记为“已完成”后，系统会自动生成积分和工资明细。" />}
        {displayedAdjustments.length > 0 && <div className="adjustment-list"><h3>奖惩记录</h3>{displayedAdjustments.map((item) => <div key={item.id}><span className={`adjustment-dot ${item.type}`} /><div><strong>{item.reason}</strong><small>{formatDate(item.date, true)} · {item.event ? eventName(item.event) : '未归赛事'}</small></div><span>{item.points >= 0 ? '+' : ''}{item.points} 分</span><strong className={item.wage < 0 ? 'negative' : ''}>{item.wage >= 0 ? '+' : ''}{formatMoney(item.wage)}</strong></div>)}</div>}
      </section>
      <section className="upcoming-section">
        <div className="schedule-heading"><div><CalendarClock size={20} /><h2>待进行选派</h2></div><span>{upcoming.length} 场待进行</span></div>
        {upcoming.length ? <div className="match-grid">{upcoming.map((match) => <MatchCard key={match.id} match={match} />)}</div> : <div className="inline-empty"><CalendarClock size={18} />当前渠道暂无待进行选派</div>}
      </section>
      <Link to="/rules" className="rule-link">查看积分与工资计算规则<ArrowUpRight size={17} /></Link>
    </div>
  );
}
