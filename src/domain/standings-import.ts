import { getMatchEvent } from './competitions.ts';
import { applyAdvancement } from './avoidance.ts';
import type { CompetitionEvent, DataStore, Match } from './types.ts';

const key = (v: unknown) => typeof v === 'string' ? v.normalize('NFKC').replace(/\s/g, '').toLowerCase() : '';
const seasonKey = (v: unknown) => key(v).replace(/[–—－]/g, '-').replace(/-(\d{2})(\d{2})$/, '-$2');
const groupKey = (v: unknown) => key(v).replace(/组$/, '');
const score = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
type Source = { id: string; event: CompetitionEvent; season: string; stage: Match['stage']; group: string; home: string; away: string; date?: string; result: NonNullable<Match['result']> };
export interface ImportNotice { label: string; reason: string }
export interface ResultPreview {
  revision: number; event: CompetitionEvent; season: string; matched: { matchId: string; label: string; result: NonNullable<Match['result']> }[];
  unchanged: number; skipped: ImportNotice[]; conflicts: ImportNotice[];
}

// Parse the standings tool's exported state or /api/records envelope. Never guess aliases.
function sourceResults(input: any, selectedEvent: CompetitionEvent, selectedSeason: string): { records: Source[]; skipped: ImportNotice[] } {
  const state = input?.state || input;
  if (!state || !Array.isArray(state.competitions)) throw new Error('不是积分榜工具的数据，请读取积分榜或上传该工具导出的 JSON');
  const records: Source[] = [], skipped: ImportNotice[] = [];
  for (const competition of state.competitions) {
    const name = String(competition.shortName || competition.title || '');
    const event: CompetitionEvent | undefined = competition.id === 'men-freshman-cup' || /男足.*新生杯/.test(name) ? 'freshmen-cup'
      : competition.id === 'women-pku-cup' || /女足.*北大杯/.test(name) ? 'womens-pku-cup'
        : /男足.*北大杯/.test(name) ? 'mens-pku-cup' : undefined;
    if (!event || event !== selectedEvent) continue;
    for (const season of [competition, ...(competition.additionalSeasons || [])]) {
      if (!season.season || seasonKey(season.season) !== seasonKey(selectedSeason)) continue;
      for (const [stage, block] of [['group', season], ['placement', season.placement]] as const) {
        if (!block || !Array.isArray(block.groups) || !Array.isArray(block.matches)) continue;
        for (const game of block.matches) {
          if (!score(game.homeScore) || !score(game.awayScore)) continue;
          const group = block.groups.find((g: any) => g.id === game.groupId);
          const home = group?.teams?.find((t: any) => t.id === game.homeId)?.name;
          const away = group?.teams?.find((t: any) => t.id === game.awayId)?.name;
          if (!home || !away || key(home) === key(away)) continue;
          records.push({ id: String(game.id), event, season: season.season, stage, group: group.name || '', home, away, date: game.date,
            result: { home: game.homeScore, away: game.awayScore } });
        }
      }
      const rounds = season.knockout?.rounds || [];
      const byes = new Map<string, string>(rounds.flatMap((r: any) => (r.byes || []).map((b: any) => [b.id, b.name])));
      const winners = new Map<string, string>(), losers = new Map<string, string>();
      for (const round of rounds) for (const game of round.matches || []) {
        const resolve = (side: string) => {
          const src = game[side+'Source'];
          return src?.winner ? winners.get(src.winner) : src?.loser ? losers.get(src.loser) : src?.bye ? byes.get(src.bye) : game[side+'Name'];
        };
        const home = resolve('home'), away = resolve('away'), legs = game.legs || [];
        if (!home || !away || !legs.length || !legs.every((l: any) => score(l.homeScore) && score(l.awayScore))) continue;
        const h = legs.reduce((s: number, l: any) => s + l.homeScore, 0), a = legs.reduce((s: number, l: any) => s + l.awayScore, 0);
        const p = game.penalties;
        const penalties = score(p?.homeScore) && score(p?.awayScore) && p.homeScore !== p.awayScore;
        const homeWins = h !== a ? h > a : penalties ? p.homeScore > p.awayScore : game.tiebreakWinner === 'home' ? true : game.tiebreakWinner === 'away' ? false : null;
        if (homeWins !== null) { winners.set(game.id, homeWins ? home : away); losers.set(game.id, homeWins ? away : home); }
        if (legs.length !== 1) { skipped.push({ label: `${home} — ${away}`, reason: '多回合比赛需逐场对应，不将总比分写入单场比赛' }); continue; }
        if (h === a && !penalties) { skipped.push({ label: `${home} — ${away}`, reason: '缺少明确点球比分，未自动填写' }); continue; }
        const title = String(round.name || '');
        const stage: Match['stage'] = /半决赛|四进二|1[/／]2|二分之一/.test(title) ? 'semifinal' : /季军|三四名/.test(title) ? 'third' : /分之一|1[/／][48]/.test(title) ? 'knockout' : /决赛/.test(title) ? 'final' : 'knockout';
        records.push({ id: String(game.id), event, season: season.season, stage, group: '', home, away, date: game.date,
          result: { home: h, away: a, ...(penalties ? { homePenalties: p.homeScore, awayPenalties: p.awayScore } : {}) } });
      }
    }
  }
  return { records, skipped };
}

export function previewStandingsResults(store: DataStore, input: unknown, event: CompetitionEvent, season: string): ResultPreview {
  const parsed = sourceResults(input, event, season);
  const records = parsed.records.filter((r) => r.event === event && seasonKey(r.season) === seasonKey(season));
  let matches = structuredClone(store.matches);
  const preview: ResultPreview = { revision: store.revision || 0, event, season, matched: [], unchanged: 0, skipped: parsed.skipped, conflicts: [] };
  const pair = (r: Source) => [r.event, seasonKey(r.season), r.stage, groupKey(r.group), ...[key(r.home), key(r.away)].sort()].join('|');
  const assigned = new Set<string>();
  for (const source of records) {
    const label = `${source.home} — ${source.away}`;
    const repeated = records.filter((r) => pair(r) === pair(source));
    if (repeated.length > 1 && (repeated.some((r) => !r.date) || new Set(repeated.map((r) => r.date)).size !== repeated.length)) {
      preview.skipped.push({ label, reason: '积分榜存在同一对阵的多场记录，无法唯一对应' }); continue;
    }
    matches = applyAdvancement(matches, store.groupOrders || [], store.teams || []);
    const candidates = matches.filter((m) => m.status !== 'cancelled' && getMatchEvent(m) === event && seasonKey(m.season) === seasonKey(season)
      && m.stage === source.stage && (!source.date || source.date === m.date)
      && (m.channel === 'five' || !m.group || !source.group || groupKey(m.group) === groupKey(source.group))
      && ((key(m.home) === key(source.home) && key(m.away) === key(source.away)) || (key(m.home) === key(source.away) && key(m.away) === key(source.home))));
    if (candidates.length !== 1) { preview.skipped.push({ label, reason: candidates.length ? '裁判赛程有多场同名对阵，未自动选择' : '未找到同赛事、赛季和阶段的对应赛程' }); continue; }
    const match = candidates[0];
    const sameSide = key(match.home) === key(source.home);
    const result = sameSide ? source.result : { home: source.result.away, away: source.result.home,
      ...(source.result.awayPenalties !== undefined ? { homePenalties: source.result.awayPenalties, awayPenalties: source.result.homePenalties } : {}) };
    if (assigned.has(match.id)) { preview.skipped.push({ label, reason: '同一赛程匹配了多个赛果' }); continue; }
    assigned.add(match.id);
    if (match.result) {
      if (['home', 'away', 'homePenalties', 'awayPenalties'].every((k) => (match.result as any)[k] === (result as any)[k])) preview.unchanged++;
      else preview.conflicts.push({ label, reason: '已有不同比分，保留现有赛果，请人工核对' });
      continue;
    }
    preview.matched.push({ matchId: match.id, label: `${match.date} ${match.home} — ${match.away}`, result });
    matches = matches.map((m) => m.id === match.id ? { ...m, result, status: 'completed' } : m);
  }
  return preview;
}
