import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, Save } from 'lucide-react';
import AdminMatchForm from './AdminMatchForm';
import StandingsResultImport from './StandingsResultImport';
import { api, useData } from '../hooks/useData';
import { competitionEvents, eventName, getMatchEvent } from '../domain/competitions';
import { groupStandings, resolveMatchTeams } from '../domain/avoidance';
import { stageLabel } from '../domain/stages';
import type { CompetitionEvent, Match, Stage } from '../domain/types';

type StandingStage = 'group' | 'placement';
type Side = 'home' | 'away';

const bracketStages: Stage[] = ['knockout', 'semifinal', 'third', 'final'];
const nameKey = (value: string | undefined) => (value || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
const sameName = (left: string | undefined, right: string | undefined) => nameKey(left) === nameKey(right);
const legalScore = (value: number | undefined) => typeof value === 'number' && Number.isInteger(value) && value >= 0;
const hasLegalResult = (match: Match) => Boolean(match.result && legalScore(match.result.home) && legalScore(match.result.away));

function resultLabel(match: Match) {
  if (match.status === 'cancelled') return '比赛已取消';
  if (match.status !== 'completed') return '比赛尚未完成';
  if (!match.result || !hasLegalResult(match)) return '已完成，但缺少合法比分';
  const penalties = legalScore(match.result.homePenalties) && legalScore(match.result.awayPenalties)
    ? `；点球 ${match.result.homePenalties} : ${match.result.awayPenalties}`
    : '';
  return `赛果 ${match.result.home} : ${match.result.away}${penalties}`;
}

function sourceLabel(match: Match, side: Side, matches: Match[]) {
  const source = side === 'home' ? match.homeSource : match.awaySource;
  if (!source) return '直接指定';
  if (source.kind === 'group') return `小组 ${source.group} 第 ${source.rank} 名`;
  const referenced = matches.find((item) => item.id === source.matchId);
  const sourceMatch = referenced ? `${stageLabel(referenced.stage)}（${source.matchId}）` : `比赛 ${source.matchId}`;
  return `${sourceMatch}${source.outcome === 'winner' ? '胜者' : '负者'}`;
}

export default function TournamentManager() {
  const { data, refresh } = useData();
  const store = data!;
  const [selectedEvent, setSelectedEvent] = useState<CompetitionEvent>('freshmen-cup');
  const [season, setSeason] = useState(store.meta.season);
  const [standingStage, setStandingStage] = useState<StandingStage>('group');
  const [group, setGroup] = useState('');
  const [order, setOrder] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  const [editing, setEditing] = useState<Match | null>(null);
  const matches = store.matches;
  const groupOrders = store.groupOrders || [];

  const seasons = [...new Set([
    store.meta.season,
    ...matches.map((match) => match.season?.trim()).filter((value): value is string => Boolean(value)),
  ])].sort((left, right) => right.localeCompare(left, 'zh-CN', { numeric: true }));
  const selectedSeason = seasons.includes(season) ? season : store.meta.season;

  useEffect(() => {
    if (season !== selectedSeason) setSeason(selectedSeason);
  }, [season, selectedSeason]);

  const stageMatches = matches.filter((match) => match.status !== 'cancelled'
    && getMatchEvent(match) === selectedEvent
    && sameName(match.season, selectedSeason)
    && match.stage === standingStage
    && (standingStage === 'group' || match.placementMode !== 'single'));
  const groupNames = new Map<string, string>();
  for (const match of stageMatches) {
    const name = match.group.normalize('NFKC').trim().replace(/\s+/g, ' ');
    if (name && !groupNames.has(nameKey(name))) groupNames.set(nameKey(name), name);
  }
  const groups = [...groupNames.values()].sort((left, right) => left.localeCompare(right, 'zh-CN', { numeric: true }));
  const selectedGroup = groups.includes(group) ? group : groups[0] || '';

  useEffect(() => {
    if (group !== selectedGroup) setGroup(selectedGroup);
  }, [group, selectedGroup]);

  const standings = selectedGroup
    ? groupStandings(matches, selectedEvent, selectedSeason, selectedGroup, standingStage, groupOrders)
    : [];
  const savedOrder = groupOrders.find((item) => item.event === selectedEvent
    && sameName(item.season, selectedSeason) && sameName(item.group, selectedGroup));
  const initialOrder = savedOrder ? [...savedOrder.teams] : standings.map((row) => row.team);
  const initialOrderKey = JSON.stringify(initialOrder);

  useEffect(() => {
    setOrder(initialOrder);
  }, [selectedEvent, selectedSeason, selectedGroup, standingStage, store.revision, initialOrderKey]);

  const missingScoreCount = selectedGroup ? stageMatches.filter((match) => sameName(match.group, selectedGroup)
    && match.status === 'completed' && !hasLegalResult(match)).length : 0;
  const bracketMatches = matches.filter((match) => match.channel === 'eleven'
    && bracketStages.includes(match.stage)
    && getMatchEvent(match) === selectedEvent
    && sameName(match.season, selectedSeason)).sort((left, right) =>
    bracketStages.indexOf(left.stage) - bracketStages.indexOf(right.stage)
    || left.date.localeCompare(right.date) || left.time.localeCompare(right.time) || left.id.localeCompare(right.id));

  const notify = (text: string, isError = false) => {
    setMessage(text);
    setFailed(isError);
  };
  const resetSelection = () => {
    setGroup('');
    setEditing(null);
    notify('');
  };
  const moveTeam = (index: number, offset: number) => {
    setOrder((current) => {
      const target = index + offset;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    notify('');
  };
  const saveOrder = async () => {
    if (standingStage !== 'group' || !selectedGroup || !order.length) return;
    setSaving(true);
    notify('');
    try {
      await api('/api/group-order', {
        method: 'PUT',
        body: JSON.stringify({ event: selectedEvent, season: selectedSeason, group: selectedGroup, teams: order }),
      });
      await refresh();
      notify(`${selectedGroup} 组最终顺序已保存，并列排名与晋级对阵已刷新。`);
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : '最终顺序保存失败', true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="admin-section tournament-manager" aria-busy={saving}>
      <div className="admin-section-heading">
        <div><h2>积分榜与晋级</h2><p>仅已完成且主客队比分均为非负整数的比赛计入积分；缺少合法比分的赛果不会纳入统计。</p></div>
      </div>

      <div className="form-grid two-cols tournament-filters">
        <label className="select-field">赛事
          <select aria-label="积分赛事" value={selectedEvent} onChange={(event) => { setSelectedEvent(event.target.value as CompetitionEvent); resetSelection(); }}>
            {competitionEvents.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <label className="select-field">赛季
          <select aria-label="积分赛季" value={selectedSeason} onChange={(event) => { setSeason(event.target.value); resetSelection(); }}>
            {seasons.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
        <label className="select-field">积分榜阶段
          <select aria-label="积分榜阶段" value={standingStage} onChange={(event) => { setStandingStage(event.target.value as StandingStage); resetSelection(); }}>
            <option value="group">小组赛（可编辑最终顺序）</option>
            <option value="placement">分组排位赛（只读）</option>
          </select>
        </label>
        <label className="select-field">组别
          <select aria-label="积分榜组别" value={selectedGroup} disabled={!groups.length} onChange={(event) => { setGroup(event.target.value); notify(''); }}>
            {!groups.length && <option value="">暂无实际比赛组别</option>}
            {groups.map((item) => <option key={item} value={item}>{item} 组</option>)}
          </select>
        </label>
      </div>

      <div className="admin-list-tools standing-tools">
        <span>{eventName(selectedEvent)} · {selectedSeason} · {standingStage === 'group' ? '小组赛' : '分组排位赛'}积分榜</span>
        <span className={missingScoreCount ? 'standing-missing' : ''}>缺少合法比分的已完成比赛：{missingScoreCount} 场</span>
      </div>
      <StandingsResultImport event={selectedEvent} season={selectedSeason} />
      {!selectedGroup || !standings.length ? <p className="inline-empty">当前赛事、赛季和阶段暂无可统计的小组比赛。</p> : (
        <div className="records-table-wrap standing-table-wrap">
          <table className="records-table standing-table">
            <thead><tr><th>排名</th><th>球队</th><th>场次</th><th>胜</th><th>平</th><th>负</th><th>进球</th><th>失球</th><th>净胜球</th><th>积分</th></tr></thead>
            <tbody>{standings.map((row) => (
              <tr className={row.tied ? 'standing-tied' : ''} key={row.team}>
                <td><strong>{row.rank}</strong>{row.tied && <small className="standing-tie-mark">并列</small>}</td>
                <td><strong>{row.team}</strong>{row.tied && <small className="standing-tied-with">与 {row.tiedWith.join('、')} 并列</small>}</td>
                <td>{row.played}</td><td>{row.wins}</td><td>{row.draws}</td><td>{row.losses}</td>
                <td>{row.goalsFor}</td><td>{row.goalsAgainst}</td><td>{row.goalDifference > 0 ? '+' : ''}{row.goalDifference}</td><td><strong>{row.points}</strong></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}

      {standingStage === 'group' && selectedGroup && standings.length > 0 && (
        <section className="standing-order" aria-label={`${selectedGroup}组最终顺序编辑`}>
          <div className="admin-list-tools">
            <h3>小组最终顺序</h3>
            <span>{JSON.stringify(order) === initialOrderKey ? '当前顺序已同步' : '有未保存的顺序调整'}</span>
          </div>
          <p className="adjustment-help">最终顺序只用于打破积分、相互战绩、净胜球和进球数比较后仍存在的并列，不会覆盖积分、相互战绩、净胜球或进球数。</p>
          <ol className="standing-order-list">
            {order.map((team, index) => (
              <li className="operation-row standing-order-row" key={team}>
                <span className="standing-order-position">{index + 1}</span>
                <div><strong>{team}</strong></div>
                <span className="standing-order-actions">
                  <button type="button" className="button secondary standing-order-button" aria-label={`将${team}上移`} disabled={saving || index === 0} onClick={() => moveTeam(index, -1)}><ArrowUp size={14} />上移</button>
                  <button type="button" className="button secondary standing-order-button" aria-label={`将${team}下移`} disabled={saving || index === order.length - 1} onClick={() => moveTeam(index, 1)}><ArrowDown size={14} />下移</button>
                </span>
              </li>
            ))}
          </ol>
          <div className="form-actions"><button type="button" className="button primary" disabled={saving || !order.length} onClick={() => void saveOrder()}><Save size={16} />{saving ? '保存中…' : '保存完整最终顺序'}</button></div>
        </section>
      )}
      {standingStage === 'placement' && <p className="adjustment-help standing-readonly-note">分组排位赛积分榜仅供查看，最终顺序编辑仅适用于小组赛。</p>}
      {message && <p className={failed ? 'form-error' : 'form-message'} role={failed ? 'alert' : 'status'}>{message}</p>}

      <section className="bracket-overview" aria-label="十一人制淘汰赛与晋级来源">
        <div className="admin-list-tools bracket-tools"><h3>十一人制淘汰赛与晋级来源</h3><span>{bracketMatches.length} 场</span></div>
        <p className="adjustment-help">按当前赛果和小组顺序自动解析参赛球队；未定席位保留全部候选。对阵与晋级请在比赛表单中编辑，此处不直接修改。</p>
        {editing && <AdminMatchForm key={editing.id} match={editing} onClose={() => setEditing(null)} />}
        {!bracketMatches.length ? <p className="inline-empty">当前赛事与赛季没有十一人制淘汰赛、半决赛、决赛或季军赛。</p> : (
          <div className="bracket-list">{bracketMatches.map((match) => {
            const resolved = resolveMatchTeams(match, matches, groupOrders);
            return (
              <article className="bracket-match" key={match.id}>
                <div className="operation-row bracket-match-heading">
                  <div><strong>{stageLabel(match.stage)} · {match.id}</strong><p>{match.date} · {match.time} · {match.venue}{match.group ? ` · ${match.group}` : ''}</p></div>
                  <button type="button" className="button secondary bracket-edit" onClick={() => setEditing(match)}>编辑赛果与晋级</button>
                </div>
                <div className="bracket-teams">
                  {(['home', 'away'] as const).map((side) => {
                    const actual = side === 'home' ? resolved.home : resolved.away;
                    const candidates = side === 'home' ? resolved.homeCandidates : resolved.awayCandidates;
                    return (
                      <div className="bracket-slot" key={side}>
                        <span>{side === 'home' ? '主队' : '客队'}</span>
                        <strong>{actual || '待定'}</strong>
                        <small className="bracket-source">来源：{sourceLabel(match, side, matches)}</small>
                        {!actual && candidates.length > 0 && <p className="bracket-candidates">全部候选：{candidates.join('、')}</p>}
                      </div>
                    );
                  })}
                </div>
                <p className="bracket-result">{resultLabel(match)}</p>
                {resolved.warnings.length > 0 && <div className="bracket-warnings" role="status">{resolved.warnings.map((warning) => <p key={warning}>{warning}</p>)}</div>}
              </article>
            );
          })}</div>
        )}
      </section>
    </section>
  );
}
