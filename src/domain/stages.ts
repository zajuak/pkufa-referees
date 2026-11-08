import type { Channel, Match, Stage } from './types.ts';
const labels: Record<Stage, string> = { group: '小组赛', placement: '排位赛', knockout: '淘汰赛', semifinal: '半决赛', final: '决赛', third: '季军赛' };
export const allowedStages = (channel: Channel): Stage[] => channel === 'five'
  ? ['group', 'placement', 'semifinal', 'final']
  : ['group', 'placement', 'knockout', 'semifinal', 'third', 'final'];
export const stageLabel = (stage: Stage, channel: Channel = 'eleven') => channel === 'five' && stage === 'group' ? '常规赛' : labels[stage];
export const stageOptions = (channel: Channel) => allowedStages(channel).map((value) => ({ value, label: stageLabel(value, channel) }));
export function matchStageLabel(match: Pick<Match, 'channel' | 'group' | 'stage'>): string {
  const label = stageLabel(match.stage, match.channel);
  if (match.channel === 'five' || match.stage === 'placement') return [...new Set([match.group, label].filter(Boolean))].join(' · ');
  return match.group || label;
}
