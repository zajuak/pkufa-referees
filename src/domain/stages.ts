import type { Channel, Match, Stage } from './types.ts';
const labels: Record<Stage, string> = { group: '小组赛', placement: '排位赛', knockout: '淘汰赛', semifinal: '半决赛', final: '决赛', third: '季军赛' };
export const allowedStages = (channel: Channel): Stage[] => channel === 'five'
  ? ['group', 'placement', 'semifinal', 'final']
  : ['group', 'placement', 'knockout', 'semifinal', 'third', 'final'];
export const stageLabel = (stage: Stage, channel: Channel = 'eleven') => channel === 'five' && stage === 'group' ? '常规赛' : labels[stage];
export const stageOptions = (channel: Channel) => allowedStages(channel).map((value) => ({ value, label: stageLabel(value, channel) }));
export function stageFor(group: string, channel: Channel = 'eleven'): Stage {
  const label = group.replace(/\s/g, '');
  if (/排位|排名赛|名次赛/.test(label)) return 'placement';
  if (/半决赛|二分之一决赛|1[\/／]2决赛/.test(label)) return 'semifinal';
  if (/季军|三四名/.test(label)) return channel === 'five' ? 'placement' : 'third';
  if (/分之一|1[\/／]\d+|淘汰|十二进八|12进8/.test(label)) {
    if (channel === 'five') throw new Error('女足北大杯阶段请明确填写常规赛、排位赛、半决赛或决赛');
    return 'knockout';
  }
  if (label.includes('决赛')) return 'final';
  return 'group';
}
export function normalizeStageDetail(value: unknown, stage: Stage, channel: Channel): string | undefined {
  if (value === undefined || value === '') return undefined;
  if (typeof value !== 'string' || value.trim().length > 60) throw new Error('阶段显示名称须为不超过 60 字的文本');
  const detail = value.trim();
  if (!detail) return undefined;
  if (stageFor(detail, channel) !== stage) throw new Error('阶段显示名称与所选比赛阶段不一致，请核对');
  return detail;
}
export function matchStageLabel(match: Pick<Match, 'channel' | 'group' | 'stage' | 'stageDetail'>): string {
  const label = match.stageDetail || stageLabel(match.stage, match.channel);
  if (match.channel === 'five' || match.stage === 'placement') return [...new Set([match.group, label].filter(Boolean))].join(' · ');
  return match.stageDetail || match.group || label;
}
