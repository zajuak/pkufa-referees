import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Search, SearchX, UsersRound } from 'lucide-react';
import { useData } from '../hooks/useData';
import { channelName, formatMoney, getChannelSummary, getSeasonPoints, getSeasonWage, CURRENT_SEASON } from '../domain/calculations';
import type { Channel } from '../domain/types';
import { ChannelBadge, EmptyState, PageHeader } from '../components/ui';

export default function RefereesPage() {
  const { data } = useData();
  const [query, setQuery] = useState('');
  const referees = useMemo(() => data!.referees
    .filter((referee) => referee.name.replace(/\s/g, '').includes(query.trim().replace(/\s/g, '')))
    .sort((a, b) => {
      const score = (referee: typeof a) => Math.max(...(['eleven', 'five'] as Channel[]).map((item) => getSeasonPoints(referee, item, CURRENT_SEASON, data!.matches, data!.adjustments, data!.wageStandards)?.total || 0));
      return score(b) - score(a) || a.name.localeCompare(b.name, 'zh-CN');
    }), [data, query]);
  const nameCounts = data!.referees.reduce<Record<string, number>>((counts, referee) => ({ ...counts, [referee.name]: (counts[referee.name] || 0) + 1 }), {});

  return (
    <div className="page referees-page">
      <PageHeader eyebrow="REFEREE DIRECTORY" title="裁判员查询" description={data!.access?.role === 'referee' ? '仅显示你的个人积分和工资，点击姓名查看执裁明细。' : `查询 ${CURRENT_SEASON} 本赛季分渠道积分与工资，点击进入个人详情。`} />
      <section className="directory-panel">
        <div className="directory-tools">
          <label className="search-field"><Search size={19} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="输入裁判员姓名…" aria-label="搜索裁判员姓名" />{query && <button onClick={() => setQuery('')} aria-label="清空搜索">×</button>}</label>
        </div>
        <div className="result-caption"><span>裁判员名单</span><small>本赛季积分与工资 · 按本赛季积分排序</small></div>
        {referees.length ? <div className="referee-table-wrap"><table className="referee-table season-table"><thead><tr><th>裁判员</th><th>渠道 / 等级</th><th>当前总积分</th><th>本赛季十一人制积分</th><th>本赛季十一人制工资</th><th>本赛季五人制积分</th><th>本赛季五人制工资</th><th><span className="sr-only">查看详情</span></th></tr></thead><tbody>
          {referees.map((referee) => {
            const channels = (['eleven', 'five'] as Channel[]).filter((item) => referee.channels[item]);
            const elevenPoints = getSeasonPoints(referee, 'eleven', CURRENT_SEASON, data!.matches, data!.adjustments, data!.wageStandards);
            const fivePoints = getSeasonPoints(referee, 'five', CURRENT_SEASON, data!.matches, data!.adjustments, data!.wageStandards);
            const elevenWage = getSeasonWage(referee, 'eleven', CURRENT_SEASON, data!.matches, data!.adjustments, data!.wageStandards);
            const fiveWage = getSeasonWage(referee, 'five', CURRENT_SEASON, data!.matches, data!.adjustments, data!.wageStandards);
            return <tr key={referee.id}>
              <td data-label="裁判员"><Link className="referee-name" to={`/referees/${referee.id}`}>{referee.name}{nameCounts[referee.name] > 1 && <small>同名档案</small>}</Link></td>
              <td data-label="渠道 / 等级"><div className="channel-stack">{channels.map((item) => { const summary = getChannelSummary(referee, item, data!.matches, data!.adjustments, data!.wageStandards)!; return <span key={item}><ChannelBadge channel={item} /><b className={`level level-${summary.level}`}>{summary.level} 级</b></span>; })}</div></td>
              <td data-label="当前总积分"><div className="points-stack">{channels.map((item) => <span key={item}><small>{channelName(item)}</small><strong>{getChannelSummary(referee, item, data!.matches, data!.adjustments, data!.wageStandards)!.points.toFixed(1)}</strong></span>)}</div></td>
              <td className="season-number" data-label="本赛季十一人制积分">{elevenPoints ? elevenPoints.total.toFixed(1) : '—'}</td>
              <td className="money-value" data-label="本赛季十一人制工资">{elevenWage ? formatMoney(elevenWage.total) : '—'}</td>
              <td className="season-number" data-label="本赛季五人制积分">{fivePoints ? fivePoints.total.toFixed(1) : '—'}</td>
              <td className="money-value" data-label="本赛季五人制工资">{fiveWage ? formatMoney(fiveWage.total) : '—'}</td>
              <td data-label="查看详情"><Link className="round-link" to={`/referees/${referee.id}`} aria-label={`查看${referee.name}详情`}><ArrowUpRight size={18} /></Link></td>
            </tr>;
          })}
        </tbody></table></div> : <EmptyState icon={<SearchX />} title="没有找到这位裁判员" description="请检查姓名是否正确。" />}
      </section>
      <div className="privacy-note"><UsersRound size={18} /><p>本平台仅供北大足协内部工作使用，请勿转发裁判员工资与奖惩信息。</p></div>
    </div>
  );
}
