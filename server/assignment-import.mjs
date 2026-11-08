import { additionalAssistantRoles, usesAdditionalAssistants } from '../src/domain/scheduling.ts';
import { randomUUID } from 'node:crypto';
import { parseWorkbook } from './xlsx.mjs';

function text(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return text(value.result ?? value.text ?? value['#text'] ?? '');
  return String(value).trim();
}

const cellText = (row, column) => text(row.getCell(column).value);
const dateParts = (value) => text(value).match(/(\d{1,2})\s*\.\s*(\d{1,2})/);
const normalizeNote = (value) => text(value).replace(/\s+/g, '');
const eventCompetitions = { 'freshmen-cup': '新生杯', 'mens-pku-cup': '男足北大杯', 'womens-pku-cup': '女足北大杯' };

function eventFor(channel, selectedEvent, title = '') {
  if (channel === 'eleven') {
    if (['freshmen-cup', 'mens-pku-cup'].includes(selectedEvent)) return selectedEvent;
    return 'freshmen-cup';
  }
  if (selectedEvent === 'womens-pku-cup') return selectedEvent;
  return title.includes('女足') && title.includes('北大杯') ? 'womens-pku-cup' : null;
}

function normalizeDate(value, season) {
  const parts = dateParts(value);
  if (!parts) throw new Error(`无法识别日期：${text(value)}`);
  const startYear = Number(season.match(/\d{4}/)?.[0]) || new Date().getFullYear();
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  const year = month >= 7 ? startYear : startYear + 1;
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) throw new Error(`无效日期：${parts[0]}`);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function normalizeTime(value) {
  const original = text(value).replace(/[—–～~]/g, '-').replace(/\s/g, '');
  const parts = original.split('-');
  if (parts.length !== 2) throw new Error(`无法识别时间：${original}`);
  return parts.map((part) => {
    const matched = part.match(/^(\d{1,2})(?::(\d{1,2}))?$/);
    if (!matched) throw new Error(`无法识别时间：${original}`);
    const hour = Number(matched[1]);
    const minute = Number(matched[2] || 0);
    if (hour > 23 || minute > 59) throw new Error(`无效时间：${original}`);
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }).join('-');
}

function bonusesFor(note) {
  const bonuses = [];
  if (note.includes('早场')) bonuses.push('early');
  if (note.includes('晚场')) bonuses.push('late');
  if (note.includes('周中')) bonuses.push('weekday');
  if (note.includes('恶劣天气') || note.includes('天气补贴')) bonuses.push('badWeather');
  return bonuses;
}

function emptyHistorical(channel) {
  return {
    pointsEarned: 0,
    roleCounts: channel === 'eleven' ? { referee: 0, assistant: 0, fourth: 0 } : { firstSecond: 0, third: 0 },
    bonusWage: 0, deductedWage: 0, bonusPoints: 0, deductedPoints: 0,
  };
}

function defaultChannelData(channel) {
  return { basePoints: 0, baseLevel: channel === 'eleven' ? 'E' : 'C', previousWage: 0, historical: emptyHistorical(channel) };
}

function makeOfficial(store, role, rawName, channel, context) {
  const name = text(rawName);
  if (!name) return { role, refereeId: null, name: '' };
  const sameChannel = store.referees.filter((referee) => referee.name === name && referee.channels[channel]);
  if (sameChannel.length === 1) return { role, refereeId: sameChannel[0].id, name };
  if (sameChannel.length > 1) return { role, refereeId: null, name };
  const sameName = store.referees.filter((referee) => referee.name === name);
  if (sameName.length === 1) {
    sameName[0].channels[channel] = defaultChannelData(channel);
    context.newReferees += 1;
    return { role, refereeId: sameName[0].id, name };
  }
  const referee = { id: `referee-${randomUUID()}`, name, channels: { [channel]: defaultChannelData(channel) } };
  store.referees.push(referee);
  context.newReferees += 1;
  return { role, refereeId: referee.id, name };
}

export function stageFor(group) {
  const label = group.replace(/\s/g, '');
  if (/半决赛|二分之一决赛|1[\/／]2决赛/.test(label)) return 'semifinal';
  if (/季军|三四名/.test(label)) return 'third';
  // Quarter/eighth finals contain “决赛” but must not receive final bonuses.
  if (/分之一|1[\/／]\d+|淘汰/.test(label)) return 'knockout';
  if (label.includes('决赛')) return 'final';
  return 'group';
}

function parseSheet(sheet, season, store, context, selectedEvent) {
  let elevenHeader = 0;
  const fiveHeaders = [];
  for (let rowNumber = 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    if (cellText(row, 1) !== '日期' || cellText(row, 2) !== '时间') continue;
    if (cellText(row, 3) === '场地' && cellText(row, 4) === '组别') elevenHeader = rowNumber;
    else if (row.values.some((value) => text(value) === '主裁')) fiveHeaders.push(rowNumber);
  }
  const matches = [];
  if (elevenHeader) {
    const end = fiveHeaders.length ? Math.min(...fiveHeaders) - 1 : sheet.rowCount;
    for (let rowNumber = elevenHeader + 1; rowNumber <= end; rowNumber += 1) {
      const row = sheet.getRow(rowNumber);
      if (!dateParts(row.getCell(1).value)) continue;
      const note = normalizeNote(row.getCell(12).value);
      const cancelled = note.includes('比赛取消');
      const roles = [['referee', 7], ['assistant1', 8], ['assistant2', 9], ['fourth', 10]];
      const event = eventFor('eleven', selectedEvent);
      matches.push({
        channel: 'eleven', event, competition: eventCompetitions[event] || sheet.name, date: normalizeDate(row.getCell(1).value, season), time: normalizeTime(row.getCell(2).value),
        venue: cellText(row, 3), group: cellText(row, 4), home: cellText(row, 5), away: cellText(row, 6),
        homeColor: row.getCell(5).color, awayColor: row.getCell(6).color, stage: stageFor(cellText(row, 4)), division: null,
        status: cancelled ? 'cancelled' : 'scheduled', note, bonuses: bonusesFor(note),
        officials: cancelled ? [] : roles.map(([role, column]) => makeOfficial(store, role, row.getCell(column).value, 'eleven', context)),
      });
    }
  }
  for (const header of fiveHeaders) {
    const headerRow = sheet.getRow(header);
    const hasSecond = cellText(headerRow, 6) === '副裁';
    const title = cellText(sheet.getRow(header - 1), 1).replace(/\s+/g, '') || '五人制友谊赛';
    for (let rowNumber = header + 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
      const row = sheet.getRow(rowNumber);
      if (!dateParts(row.getCell(1).value)) break;
      const group = cellText(row, hasSecond ? 4 : 3);
      const event = eventFor('five', selectedEvent, title);
      if (!event) continue;
      const note = normalizeNote(row.getCell(hasSecond ? 7 : 5).value);
      const cancelled = note.includes('比赛取消');
      const officials = cancelled ? [] : [makeOfficial(store, 'first', row.getCell(hasSecond ? 5 : 4).value, 'five', context)];
      if (!cancelled && hasSecond) officials.push(makeOfficial(store, 'second', row.getCell(6).value, 'five', context));
      matches.push({
        channel: 'five', event, competition: eventCompetitions[event] || title, date: normalizeDate(row.getCell(1).value, season), time: normalizeTime(row.getCell(2).value),
        venue: '未注明', group, home: '', away: '', stage: stageFor(group), division: null,
        status: note.includes('比赛取消') ? 'cancelled' : 'scheduled', note, bonuses: bonusesFor(note), officials,
      });
    }
  }
  return matches;
}

const signature = (match) => [match.channel, match.date, match.time, match.competition, match.home, match.away, match.group].join('|');

export function importAssignmentWorkbook(store, buffer, season = '2026–27', selectedEvent = 'freshmen-cup') {
  if (!Object.hasOwn(eventCompetitions, selectedEvent)) throw new Error('未知赛事分类');
  const workbook = parseWorkbook(buffer);
  const context = { newReferees: 0 };
  const parsedSheets = workbook.worksheets
    .filter((sheet) => !sheet.name.includes('总览'))
    .map((sheet) => ({ sheet, matches: parseSheet(sheet, season, store, context, selectedEvent) }))
    .filter((item) => item.matches.length);
  const imported = parsedSheets.flatMap((item) => item.matches);
  if (!imported.length) throw new Error('没有识别到赛程，请使用与当前选派表相同的 Excel 格式');
  if (imported.length > 500) throw new Error('单次最多导入 500 场比赛');

  let nextWeek = Math.max(0, ...store.matches.map((match) => match.week));
  const originalIds = new Set(store.matches.map((match) => match.id));
  const matchedIds = new Set();
  let added = 0;
  let updated = 0;
  for (const { matches } of parsedSheets) {
    const dates = matches.map((match) => match.date);
    const knownWeek = store.matches.find((match) => dates.includes(match.date))?.week;
    const week = knownWeek || ++nextWeek;
    for (const parsed of matches) {
      const existing = store.matches.find((match) => originalIds.has(match.id) && !matchedIds.has(match.id) && signature(match) === signature(parsed));
      if (existing) {
        matchedIds.add(existing.id);
        const officials = parsed.officials.map((official) => {
          const previous = existing.officials.find((item) => item.role === official.role);
          return { ...official, substitute: previous?.substitute || false };
        });
        const additionalAssistants = usesAdditionalAssistants(existing);
        if (additionalAssistants && parsed.status !== 'cancelled') for (const role of additionalAssistantRoles) {
          officials.push(existing.officials.find((o) => o.role === role) || { role, refereeId: null, name: '' });
        }
        Object.assign(existing, parsed, {
          id: existing.id, season: existing.season || season, week: existing.week, officials, additionalAssistants,
          stage: parsed.stage === 'group' ? existing.stage : parsed.stage,
          status: parsed.status === 'cancelled' ? 'cancelled' : existing.status === 'completed' ? 'completed' : 'scheduled',
        });
        updated += 1;
      } else {
        store.matches.push({ ...parsed, id: `match-${randomUUID()}`, season, week });
        added += 1;
      }
    }
  }
  store.meta.counts = {
    elevenMatches: store.matches.filter((match) => match.channel === 'eleven').length,
    fiveMatches: store.matches.filter((match) => match.channel === 'five').length,
    cancelledMatches: store.matches.filter((match) => match.status === 'cancelled').length,
  };
  store.meta.importedAt = new Date().toISOString();
  return { added, updated, newReferees: context.newReferees, total: imported.length };
}
