import { recalculateMatchBonuses } from '../src/domain/time-bonuses.ts';
import { recalculateMatchWeeks } from '../src/domain/weeks.ts';
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

export function stageFor(group, channel = 'eleven') {
  const label = group.replace(/\s/g, '');
  if (/排位|排名赛|名次赛/.test(label)) return 'placement';
  if (/半决赛|二分之一决赛|1[\/／]2决赛/.test(label)) return 'semifinal';
  if (/季军|三四名/.test(label)) return channel === 'five' ? 'placement' : 'third';
  // Quarter/eighth finals contain “决赛” but must not receive final bonuses.
  if (/分之一|1[\/／]\d+|淘汰|十二进八|12进8/.test(label)) {
    if (channel === 'five') throw new Error('女足北大杯阶段请明确填写常规赛、排位赛、半决赛或决赛');
    return 'knockout';
  }
  if (label.includes('决赛')) return 'final';
  return 'group';
}

const fiveRoleHeaders = {
  first: ['一裁', '第一裁', '第一裁判', '1裁'],
  second: ['二裁', '第二裁', '第二裁判', '2裁'],
  third: ['三裁', '第三裁', '第三裁判', '3裁'],
};

function headerColumn(row, ...names) {
  return row.values.slice(1).findIndex((value) => names.includes(text(value).replace(/\s/g, ''))) + 1;
}

function matchColumns(row) {
  const column = (...names) => headerColumn(row, ...names);
  return { group: column('组别'), stage: column('比赛类别', '比赛阶段', '阶段'), venue: column('场地'), home: column('主队'), away: column('客队'), note: column('备注') };
}

function fiveColumns(row, modern, sheetName, rowNumber) {
  const labels = row.values.slice(1).map((value) => text(value).replace(/\s/g, ''));
  const column = (...names) => labels.findIndex((label) => names.includes(label)) + 1;
  const roles = Object.entries(fiveRoleHeaders).map(([role, names]) => {
    const aliases = [...names, ...(role === 'first' ? ['主裁'] : role === 'second' ? ['副裁'] : [])];
    if (labels.filter((label) => aliases.includes(label)).length > 1) throw new Error(`${sheetName} 第 ${rowNumber} 行五人制裁判岗位表头重复`);
    return [role, column(...aliases)];
  });
  if (modern && roles.some(([, index]) => !index)) throw new Error(`${sheetName} 第 ${rowNumber} 行五人制表头须同时包含一裁、二裁、三裁（可使用第一裁判、第二裁判、第三裁判）`);
  return { ...matchColumns(row), roles };
}

function parseSheet(sheet, season, store, context, selectedEvent) {
  let elevenHeader;
  const fiveHeaders = [];
  for (let rowNumber = 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    if (cellText(row, 1) !== '日期' || cellText(row, 2) !== '时间') continue;
    const modernFive = row.values.some((value) => Object.values(fiveRoleHeaders).flat().includes(text(value).replace(/\s/g, '')));
    // Identify the three futsal roles before the shared date/time/venue/group prefix.
    if (modernFive) fiveHeaders.push({ row: rowNumber, columns: fiveColumns(row, true, sheet.name, rowNumber) });
    else if (headerColumn(row, '主队') && headerColumn(row, '客队') && headerColumn(row, '主裁判', '主裁')) elevenHeader = {
      row: rowNumber, columns: { ...matchColumns(row), roles: [['referee', headerColumn(row, '主裁判', '主裁')], ['assistant1', headerColumn(row, '第一助理', '助理1')], ['assistant2', headerColumn(row, '第二助理', '助理2')], ['fourth', headerColumn(row, '第四官员', '四官')]] },
    };
    else if (row.values.some((value) => text(value) === '主裁')) fiveHeaders.push({ row: rowNumber, columns: fiveColumns(row, false, sheet.name, rowNumber) });
  }
  const matches = [];
  if (elevenHeader) {
    const { columns } = elevenHeader;
    const end = fiveHeaders.length ? Math.min(...fiveHeaders.map((header) => header.row)) - 1 : sheet.rowCount;
    for (let rowNumber = elevenHeader.row + 1; rowNumber <= end; rowNumber += 1) {
      const row = sheet.getRow(rowNumber);
      if (!dateParts(row.getCell(1).value)) continue;
      const note = columns.note ? normalizeNote(row.getCell(columns.note).value) : '';
      const cancelled = note.includes('比赛取消');
      const group = columns.group ? cellText(row, columns.group) : '';
      const stage = columns.stage ? cellText(row, columns.stage) : group;
      const event = eventFor('eleven', selectedEvent);
      const importedMatch = {
        channel: 'eleven', event, competition: eventCompetitions[event] || sheet.name, date: normalizeDate(row.getCell(1).value, season), time: normalizeTime(row.getCell(2).value),
        venue: cellText(row, columns.venue), group, home: cellText(row, columns.home), away: cellText(row, columns.away),
        homeColor: row.getCell(columns.home).color, awayColor: row.getCell(columns.away).color, stage: stageFor(stage || group), division: null,
        status: cancelled ? 'cancelled' : 'scheduled', note, bonuses: bonusesFor(note),
        officials: cancelled ? [] : columns.roles.map(([role, column]) => makeOfficial(store, role, column ? row.getCell(column).value : '', 'eleven', context)),
      };
      context.stageLabels.set(importedMatch, stage || group);
      matches.push(importedMatch);
    }
  }
  for (const { row: header, columns } of fiveHeaders) {
    const title = cellText(sheet.getRow(header - 1), 1).replace(/\s+/g, '') || '五人制友谊赛';
    for (let rowNumber = header + 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
      const row = sheet.getRow(rowNumber);
      if (!dateParts(row.getCell(1).value)) break;
      const group = columns.group ? cellText(row, columns.group) : '';
      const stage = columns.stage ? cellText(row, columns.stage) : group;
      const event = eventFor('five', selectedEvent, title);
      if (!event) continue;
      const note = columns.note ? normalizeNote(row.getCell(columns.note).value) : '';
      const cancelled = note.includes('比赛取消');
      const officials = cancelled ? [] : columns.roles.map(([role, column]) => makeOfficial(store, role, column ? row.getCell(column).value : '', 'five', context));
      const importedMatch = {
        channel: 'five', event, competition: eventCompetitions[event] || title, date: normalizeDate(row.getCell(1).value, season), time: normalizeTime(row.getCell(2).value),
        venue: columns.venue ? cellText(row, columns.venue) || '未注明' : '未注明', group,
        home: columns.home ? cellText(row, columns.home) : '', away: columns.away ? cellText(row, columns.away) : '',
        ...(columns.home ? { homeColor: row.getCell(columns.home).color } : {}),
        ...(columns.away ? { awayColor: row.getCell(columns.away).color } : {}),
        stage: stageFor(stage || group, 'five'), division: null,
        status: cancelled ? 'cancelled' : 'scheduled', note, bonuses: bonusesFor(note), officials,
      };
      context.providedRoles.set(importedMatch, new Set(columns.roles.filter(([, column]) => column).map(([role]) => role)));
      context.stageLabels.set(importedMatch, stage || group);
      matches.push(importedMatch);
    }
  }
  return matches;
}

const signature = (match) => [match.channel, match.date, match.time, match.competition, match.home, match.away].join('|');

export function importAssignmentWorkbook(store, buffer, season = '2026–27', selectedEvent = 'freshmen-cup') {
  if (!Object.hasOwn(eventCompetitions, selectedEvent)) throw new Error('未知赛事分类');
  const workbook = parseWorkbook(buffer);
  const context = { newReferees: 0, providedRoles: new WeakMap(), stageLabels: new WeakMap() };
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
      const candidates = store.matches.filter((match) => originalIds.has(match.id) && !matchedIds.has(match.id) && (match.season || season) === season && signature(match) === signature(parsed));
      const sameGroup = parsed.group ? candidates.filter((match) => match.group === parsed.group) : [];
      const matching = sameGroup.length ? sameGroup : candidates;
      if (matching.length > 1) throw new Error(`${parsed.date} ${parsed.time} ${parsed.home}—${parsed.away} 对应多场比赛，请填写组别以明确更新场次`);
      const existing = matching[0];
      if (existing) {
        matchedIds.add(existing.id);
        const officials = parsed.officials.map((official) => {
          const previous = existing.officials.find((item) => item.role === official.role);
          // Legacy sheets cannot edit roles they have no columns for.
          if (parsed.channel === 'five' && !context.providedRoles.get(parsed)?.has(official.role) && previous) return { ...previous };
          return { ...official, substitute: previous?.substitute || false };
        });
        const additionalAssistants = usesAdditionalAssistants(existing);
        if (additionalAssistants && parsed.status !== 'cancelled') for (const role of additionalAssistantRoles) {
          officials.push(existing.officials.find((o) => o.role === role) || { role, refereeId: null, name: '' });
        }
        const manual = {
          ...(existing.result !== undefined ? { result: existing.result } : {}),
          ...(existing.placementMode !== undefined ? { placementMode: existing.placementMode } : {}),
          ...(existing.avoidanceOverride !== undefined ? { avoidanceOverride: existing.avoidanceOverride } : {}),
          ...(existing.homeSource !== undefined ? { homeSource: existing.homeSource } : {}),
          ...(existing.awaySource !== undefined ? { awaySource: existing.awaySource } : {}),
        };
        const status = parsed.status === 'cancelled' ? 'cancelled' : existing.status === 'completed' ? 'completed' : 'scheduled';
        Object.assign(existing, parsed, manual, {
          id: existing.id, season: existing.season || season, week: existing.week, officials, additionalAssistants,
          // Omitted groups and legacy stage labels must not erase configured advancement groups.
          group: !parsed.group || stageFor(parsed.group, parsed.channel) !== 'group' ? existing.group : parsed.group,
          stage: parsed.stage === 'group' && !/常规赛|小组赛/.test(context.stageLabels.get(parsed) || '') ? existing.stage : parsed.stage,
          status,
        });
        if (status === 'cancelled') delete existing.result;
        updated += 1;
      } else {
        store.matches.push({ ...parsed, id: `match-${randomUUID()}`, season, week });
        added += 1;
      }
    }
  }
  recalculateMatchWeeks(store.matches, store.meta.season);
  recalculateMatchBonuses(store.matches);
  store.meta.counts = {
    elevenMatches: store.matches.filter((match) => match.channel === 'eleven').length,
    fiveMatches: store.matches.filter((match) => match.channel === 'five').length,
    cancelledMatches: store.matches.filter((match) => match.status === 'cancelled').length,
  };
  store.meta.importedAt = new Date().toISOString();
  return { added, updated, newReferees: context.newReferees, total: imported.length };
}
