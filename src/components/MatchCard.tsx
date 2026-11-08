import { Clock3, MapPin, CloudRain, Sunrise, Sunset, CalendarRange } from 'lucide-react';
import type { Match } from '../domain/types';
import { matchBonuses } from '../domain/time-bonuses';
import { matchStageLabel } from '../domain/stages';
import { effectiveMatchStatus, roleName, stageName } from '../domain/calculations';
import { ChannelBadge, StatusBadge } from './ui';

const bonusIcons = { early: Sunrise, late: Sunset, weekday: CalendarRange, badWeather: CloudRain };
const bonusNames = { early: '早场补贴', late: '晚场补贴', weekday: '非常规时间补贴', badWeather: '天气补贴' };

export default function MatchCard({ match }: { match: Match }) {
  const status = effectiveMatchStatus(match);
  const bonuses = matchBonuses(match);
  return (
    <article className={`match-card ${status}`}>
      <div className="match-topline">
        <div className="match-labels"><ChannelBadge channel={match.channel} /><span className="competition-name">{match.competition}</span></div>
        <StatusBadge status={status} />
      </div>
      <div className="match-meta">
        <span><Clock3 size={15} />{match.time || '时间待定'}</span>
        <span><MapPin size={15} />{match.venue}</span>
        <span className="stage-label">{matchStageLabel(match)}</span>
      </div>
      {match.home || match.away ? (
        <div className="versus"><strong>{match.home || '待定'}</strong><span>VS</span><strong>{match.away || '待定'}</strong></div>
      ) : (
        <div className="friendly-title"><strong>{match.group || stageName(match.stage, match.channel)}</strong><span>{match.home}{match.away}</span></div>
      )}
      {status === 'cancelled' ? <p className="inline-empty">比赛已取消，无需选派裁判。</p> : <div className="official-grid">
        {match.officials.map((official, index) => (
          <div className="official" key={`${official.role}-${index}`}>
            <span>{roleName(official.role)}</span>
            <strong className={!official.name ? 'pending-name' : ''}>{official.name || '待选派'}{official.substitute && <small className="substitute-mark">临替 +¥10</small>}</strong>
          </div>
        ))}
      </div>}
      {(bonuses.length > 0 || match.note) && (
        <div className="match-footer">
          <div className="bonus-list">{bonuses.map((bonus) => {
            const Icon = bonusIcons[bonus];
            return <span className="bonus-tag" key={bonus}><Icon size={13} />{bonusNames[bonus]}</span>;
          })}</div>
          {match.note && !match.note.includes('比赛取消') && <p>{match.note.replace(/\s/g, '')}</p>}
        </div>
      )}
    </article>
  );
}
