import type { Match, Role } from './types';
import { channelName, roleName } from './calculations';
import { additionalAssistantRoles, matchInterval, usesAdditionalAssistants } from './scheduling';

export function downloadBlob(name: string, content: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const csv = (value: string) => `"${(value !== '-' && /^[=+\-@\t\r]/.test(value) ? "'" : '') + value.replaceAll('"', '""')}"`;
export function assignmentExportRows(matches: Match[]): string[][] {
  const fiveOnly = matches.length > 0 && matches.every(match => match.channel === 'five');
  const mixed = matches.some(match => match.channel === 'five') && matches.some(match => match.channel === 'eleven');
  const showAdditional = matches.some(match => match.status !== 'cancelled' && usesAdditionalAssistants(match));
  const labels = fiveOnly ? ['第一裁判', '第二裁判', '第三裁判'] : mixed
    ? ['主裁判 / 第一裁判', '第一助理 / 第二裁判', '第二助理 / 第三裁判', '第四官员']
    : ['主裁判', '第一助理', '第二助理', '第四官员'];
  if (showAdditional) labels.push('第一附加助理', '第二附加助理');
  return [
    ['日期', '时间', '赛制', '赛事', '场地', '主队', '客队', ...labels, '状态', '备注'],
    ...matches.map(match => {
      const roles: (Role | undefined)[] = match.channel === 'eleven' ? ['referee', 'assistant1', 'assistant2', 'fourth']
        : ['first', 'second', 'third', ...(fiveOnly ? [] : [undefined])];
      if (showAdditional) roles.push(...(usesAdditionalAssistants(match) ? additionalAssistantRoles : [undefined, undefined]));
      const assignments = roles.map(role => match.status === 'cancelled' ? '' : !role ? '-'
        : match.officials.filter(official => official.role === role && official.name).map(official => official.name).join(' / '));
      return [match.date, match.time, channelName(match.channel), match.competition, match.venue, match.home, match.away, ...assignments,
        match.status === 'cancelled' ? '已取消' : match.status === 'completed' ? '已完成' : '已安排', match.note];
    }),
  ];
}
export function exportAssignments(matches: Match[]) {
  const rows = assignmentExportRows(matches);
  downloadBlob('裁判选派.csv', '\uFEFF' + rows.map((row) => row.map(csv).join(',')).join('\r\n'), 'text/csv;charset=utf-8');
}
const escapeIcs = (s: string) => s.replaceAll('\\', '\\\\').replaceAll('\n', '\\n').replaceAll(';', '\\;').replaceAll(',', '\\,');
const timestamp = (value: number) => new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
export function exportCalendar(matches: Match[], name = '裁判赛程') {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//PKUFA//Referees//ZH', 'CALSCALE:GREGORIAN'];
  for (const m of matches) {
    const interval = matchInterval(m);
    if (!interval || m.status === 'cancelled') continue;
    lines.push('BEGIN:VEVENT', `UID:${escapeIcs(m.id)}@pkufa`, `DTSTAMP:${timestamp(Date.now())}`, `DTSTART:${timestamp(interval[0])}`, `DTEND:${timestamp(interval[1])}`, `SUMMARY:${escapeIcs(`${m.competition} ${m.home}—${m.away}`)}`, `LOCATION:${escapeIcs(m.venue)}`, `DESCRIPTION:${escapeIcs(m.officials.map((o) => `${roleName(o.role)}：${o.name || '待选派'}`).join('\n') + '\n' + m.note)}`, 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  // Fold at 75 UTF-8 bytes without breaking multibyte characters (RFC 5545).
  const encoder = new TextEncoder();
  const folded = lines.map((line) => { let out = '', bytes = 0; for (const c of line) { const n = encoder.encode(c).length; if (bytes + n > 75) { out += '\r\n '; bytes = 1; } out += c; bytes += n; } return out; });
  downloadBlob(`${name}.ics`, folded.join('\r\n') + '\r\n', 'text/calendar;charset=utf-8');
}
