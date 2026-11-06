import type { Match } from './types';
import { roleName } from './calculations';
import { matchInterval } from './scheduling';

export function downloadBlob(name: string, content: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a'); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const csv = (value: string) => `"${(/^[=+\-@\t\r]/.test(value) ? "'" : '') + value.replaceAll('"', '""')}"`;
export function exportAssignments(matches: Match[]) {
  const rows = [['日期', '时间', '赛事', '场地', '主队', '客队', '选派', '状态', '备注'], ...matches.map((m) => [m.date, m.time, m.competition, m.venue, m.home, m.away, m.officials.map((o) => `${roleName(o.role)}：${o.name || '待选派'}`).join('；'), m.status === 'cancelled' ? '已取消' : m.status === 'completed' ? '已完成' : '已安排', m.note])];
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
