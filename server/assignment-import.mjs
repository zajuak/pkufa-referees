import { recalculateMatchBonuses } from '../src/domain/time-bonuses.ts';
import { recalculateMatchWeeks } from '../src/domain/weeks.ts';
import { additionalAssistantRoles, usesAdditionalAssistants } from '../src/domain/scheduling.ts';
import { randomUUID } from 'node:crypto';
import { stageFor, normalizeStageDetail } from '../src/domain/stages.ts';
import { parseWorkbook } from './xlsx.mjs';
import { matchSemester, matchWeek } from '../src/domain/weeks.ts';
import { normalizeColleges } from './validation.mjs';
import { workloadIssues, interruptionIssues } from '../src/domain/workload.ts';
import { getMatchEvent } from '../src/domain/competitions.ts';

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
  if (context.deferOfficials) return { role, refereeId: null, name };
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

export { stageFor } from '../src/domain/stages.ts';

const fiveRoleHeaders = {
  first: ['一裁', '第一裁', '第一裁判', '1裁'],
  second: ['二裁', '第二裁', '第二裁判', '2裁'],
  third: ['三裁', '第三裁', '第三裁判', '3裁'],
};
const elevenRoleHeaders = {
  referee: ['主裁判', '主裁'], assistant1: ['第一助理', '助理1'], assistant2: ['第二助理', '助理2'], fourth: ['第四官员', '四官'],
  additionalAssistant1: ['附加助理1', '第一附加助理', '第一附加助理裁判', '第一附加助理裁判员', '附加助理裁判1'],
  additionalAssistant2: ['附加助理2', '第二附加助理', '第二附加助理裁判', '第二附加助理裁判员', '附加助理裁判2'],
};

function headerColumn(row, ...names) {
  return row.values.slice(1).findIndex((value) => names.includes(text(value).normalize('NFKC').replace(/\s/g, ''))) + 1;
}

function matchColumns(row) {
  const column = (...names) => headerColumn(row, ...names);
  return { group: column('组别'), stage: column('比赛类别', '比赛阶段', '阶段'), venue: column('场地'), home: column('主队'), away: column('客队'), avoidance: column('回避', '回避学院'), note: column('备注') };
}

function elevenColumns(row, sheetName, rowNumber) {
  const labels = row.values.slice(1).map(value => text(value).normalize('NFKC').replace(/\s/g, ''));
  const roles = Object.entries(elevenRoleHeaders).map(([role, names]) => {
    if (labels.filter(label => names.includes(label)).length > 1) throw new Error(`${sheetName} 第 ${rowNumber} 行十一人制裁判岗位表头重复`);
    return [role, headerColumn(row, ...names)];
  });
  return { ...matchColumns(row), roles };
}

function importedStage(parsed, existing, context) {
  return existing && parsed.stage === 'group' && !/常规赛|小组赛/.test(context.stageLabels.get(parsed) || '') ? existing.stage : parsed.stage;
}

function importedAdditionalAssistants(parsed, existing, context) {
  return parsed.channel === 'eleven' && (['semifinal', 'final'].includes(importedStage(parsed, existing, context))
    || usesAdditionalAssistants(parsed) || Boolean(existing && usesAdditionalAssistants(existing)));
}

function completeAdditionalRoles(match) {
  if (!match.additionalAssistants || match.status === 'cancelled') return;
  for (const role of additionalAssistantRoles) if (!match.officials.some(o => o.role === role)) match.officials.push({ role, refereeId: null, name: '' });
}

function rowSettings(match, sheet, rowNumber, columns, row, context) {
  const stageText = columns.stage ? cellText(row, columns.stage) : match.group;
  if (stageText && (match.stage !== 'group' || /小组赛|常规赛/.test(stageText))) match.stageDetail = normalizeStageDetail(stageText, match.stage, match.channel);
  const raw = columns.avoidance ? cellText(row, columns.avoidance) : '';
  const colleges = raw ? /^(无|无回避|无需回避|[-—–])$/.test(raw) ? [] : [...new Set(raw.normalize('NFKC').split(/[、,，;；\n\r/|]+/).map(v => v.trim()).filter(Boolean))] : undefined;
  if (colleges !== undefined) match.avoidanceOverride = { mode: 'replace', colleges };
  context.rows.set(match, { key: `${sheet.name}:${rowNumber}`, sheet: sheet.name, row: rowNumber, continuation: /接续比赛|续赛/.test(match.note) });
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
      row: rowNumber, columns: elevenColumns(row, sheet.name, rowNumber),
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
      const parsedStage = stageFor(stage || group);
      const additionalAssistants = ['semifinal', 'final'].includes(parsedStage) || columns.roles.some(([role, column]) => additionalAssistantRoles.includes(role) && column && cellText(row, column));
      const importedMatch = {
        channel: 'eleven', event, competition: eventCompetitions[event] || sheet.name, date: normalizeDate(row.getCell(1).value, season), time: normalizeTime(row.getCell(2).value),
        venue: cellText(row, columns.venue), group, home: cellText(row, columns.home), away: cellText(row, columns.away),
        homeColor: row.getCell(columns.home).color, awayColor: row.getCell(columns.away).color, stage: parsedStage, division: null, additionalAssistants,
        status: cancelled ? 'cancelled' : 'scheduled', note, bonuses: bonusesFor(note),
        officials: cancelled ? [] : columns.roles.filter(([role]) => additionalAssistants || !additionalAssistantRoles.includes(role)).map(([role, column]) => makeOfficial(store, role, column ? row.getCell(column).value : '', 'eleven', context)),
      };
      context.providedRoles.set(importedMatch, new Set(columns.roles.filter(([, column]) => column).map(([role]) => role)));
      context.stageLabels.set(importedMatch, stage || group);
      rowSettings(importedMatch, sheet, rowNumber, columns, row, context);
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
      rowSettings(importedMatch, sheet, rowNumber, columns, row, context);
      matches.push(importedMatch);
    }
  }
  return matches;
}

const signature = (match) => [match.channel, match.date, match.time, match.competition, match.home, match.away].join('|');

function readAssignments(store, buffer, season, selectedEvent) {
  if (!Object.hasOwn(eventCompetitions, selectedEvent)) throw new Error('未知赛事分类');
  const workbook = parseWorkbook(buffer);
  const context = { newReferees: 0, deferOfficials: true, providedRoles: new WeakMap(), stageLabels: new WeakMap(), rows: new WeakMap() };
  const parsedSheets = workbook.worksheets
    .filter((sheet) => !sheet.name.includes('总览'))
    .map((sheet) => ({ sheet, matches: parseSheet(sheet, season, store, context, selectedEvent) }))
    .filter((item) => item.matches.length);
  const imported = parsedSheets.flatMap((item) => item.matches);
  if (!imported.length) throw new Error('没有识别到赛程，请使用与当前选派表相同的 Excel 格式');
  if (imported.length > 500) throw new Error('单次最多导入 500 场比赛');
  const seen = new Set();
  for (const match of imported) {
    if (!match.home || !match.away) continue;
    const key = `${signature(match)}|${match.group}`;
    if (seen.has(key)) throw new Error(`${match.date} ${match.time} ${match.home}—${match.away} 在文件中重复，请先核对`);
    seen.add(key);
  }
  return { context, parsedSheets, imported };
}

function weekKey(match) {
  const date = new Date(`${match.date}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() - 4 + 7) % 7));
  return date.toISOString().slice(0, 10);
}

function existingFor(store, parsed, season, excluded = new Set()) {
  const candidates = store.matches.filter(m => !excluded.has(m.id) && (m.season || season) === season && signature(m) === signature(parsed));
  const grouped = parsed.group ? candidates.filter(m => m.group === parsed.group) : [];
  const matching = grouped.length ? grouped : candidates;
  if (matching.length > 1) throw new Error(`${parsed.date} ${parsed.time} ${parsed.home}—${parsed.away} 对应多场比赛，请填写组别以明确更新场次`);
  return matching[0];
}

const teamKey = value => text(value).normalize('NFKC').replace(/\s+/g, '').toLocaleLowerCase();
function sameFixture(left, right, season) {
  if (!left.home || !left.away || !right.home || !right.away) return false;
  if (left.channel !== right.channel || getMatchEvent(left) !== getMatchEvent(right) || (left.season || season) !== (right.season || season)
    || teamKey(left.home) !== teamKey(right.home) || teamKey(left.away) !== teamKey(right.away)) return false;
  if (left.group && right.group && left.group !== right.group) return false;
  if (left.stage !== right.stage && !(left.stage === 'group' && !left.stageDetail)) return false;
  // Different named knockout rounds are distinct fixtures, even with identical teams.
  const round = m => {
    if (m.stage !== 'knockout') return '';
    const label = (m.stageDetail || m.group || '').replace(/\s/g, '').replaceAll('／', '/');
    if (/四分之一|1\/4(?!\d)/.test(label)) return '1/4';
    if (/八分之一|1\/8(?!\d)/.test(label)) return '1/8';
    if (/十二进八|12进8/.test(label)) return '12-8';
    return m.stageDetail && label !== '淘汰赛' ? label : '';
  };
  return !(round(left) && round(right) && round(left) !== round(right));
}

function assignmentPlan(store, imported, context, season, targets = {}) {
  const plan = new Map();
  for (const parsed of imported.filter(m => !context.rows.get(m).continuation)) {
    const key = context.rows.get(parsed).key;
    const exact = existingFor(store, parsed, season);
    if (exact) {
      if (targets[key] !== undefined && targets[key] !== exact.id) throw new Error('该时间的赛程已存在，请更新已有比赛');
      plan.set(parsed, { existing: exact, action: 'update', candidates: [] });
      continue;
    }
    const candidates = store.matches.filter(m => sameFixture(parsed, m, season) && m.status !== 'cancelled'
      && !(weekKey(m) === weekKey(parsed) && imported.some(other => other !== parsed && !context.rows.get(other).continuation && signature(other) === signature(m))));
    const target = targets[key];
    if (target === 'new') { plan.set(parsed, { action: 'add', candidates }); continue; }
    if (target !== undefined) {
      const existing = candidates.find(m => m.id === target);
      if (!existing) throw new Error('改期目标已失效，请重新预览并确认');
      plan.set(parsed, { existing, action: 'reschedule', candidates }); continue;
    }
    const nearby = candidates.filter(m => weekKey(m) === weekKey(parsed) && matchSemester(m) === matchSemester(parsed));
    const fileFixtures = imported.filter(other => !context.rows.get(other).continuation && sameFixture(parsed, other, season) && weekKey(other) === weekKey(parsed));
    const existing = nearby.length === 1 && fileFixtures.length === 1 && nearby[0].status !== 'completed' && !nearby[0].result
      && !nearby[0].interrupted && !nearby[0].resumption && !nearby[0].officials.some(o => o.fraction === 0.5) ? nearby[0] : undefined;
    plan.set(parsed, { existing, action: existing ? 'reschedule' : candidates.length ? 'confirm' : 'add', candidates });
  }
  return plan;
}

function continuationCandidates(store, parsed, season, imported = [], context, plan) {
  const candidates = store.matches.filter(m => (m.season || season) === season && m.channel === parsed.channel && m.event === parsed.event
    && m.home === parsed.home && m.away === parsed.away && m.status !== 'cancelled' && `${m.date} ${m.time}` < `${parsed.date} ${parsed.time}`
    && (m.interrupted || !/接续比赛|续赛/.test(m.note || '')));
  for (const m of imported) {
    if (m.channel !== parsed.channel || m.event !== parsed.event || m.home !== parsed.home || m.away !== parsed.away || m.status === 'cancelled'
      || `${m.date} ${m.time}` >= `${parsed.date} ${parsed.time}` || context.rows.get(m).continuation || plan?.get(m)?.existing || existingFor(store, m, season)) continue;
    candidates.push({ ...m, id: `row:${context.rows.get(m).key}` });
  }
  return candidates.sort((a, b) => b.date.localeCompare(a.date));
}

function continuationRoles(original, parsed) {
  return parsed.officials.flatMap(incoming => {
    const previous = original.officials.filter(o => o.role === incoming.role);
    const last = previous.at(-1);
    if (!incoming.name || !last?.name || incoming.name === last.name) return [];
    return [{ role: incoming.role, originalName: previous[0].name, resumedName: incoming.name,
      originalPercent: previous[0].allocationPercent ?? 50, resumedPercent: last?.fraction === 0.5 ? last.allocationPercent ?? 50 : 50,
      originalBonus: previous[0].fraction === 0.5 ? previous[0].actualBonus : undefined }];
  });
}

function linkContinuation(store, original, parsed, season, decision, context) {
  if (original.result) throw new Error('原场已登记赛果，请先在比赛设定中核对并清除未完赛赛果，再关联续赛');
  const duplicate = existingFor(store, parsed, season);
  if (duplicate && duplicate.id !== original.id) {
    const used = duplicate.result || duplicate.officials.some(o => o.refereeId || o.name)
      || store.adjustments.some(a => a.matchId === duplicate.id)
      || store.matches.some(m => [m.homeSource, m.awaySource].some(s => s?.kind === 'match' && s.matchId === duplicate.id));
    if (used) throw new Error('已存在的独立续赛记录有选派、赛果、奖惩或晋级引用，请先在比赛设定中核对，不能自动合并');
    store.matches = store.matches.filter(m => m.id !== duplicate.id);
  }
  if (parsed.channel === 'eleven') {
    original.additionalAssistants = importedAdditionalAssistants(parsed, original, context);
    completeAdditionalRoles(original);
  }
  const changes = new Map(continuationRoles(original, parsed).map(r => [r.role, r]));
  for (const incoming of parsed.officials) {
    if (!incoming.name) continue; // Blank continuation cells retain the original assignment.
    const previous = original.officials.filter(o => o.role === incoming.role);
    if (!changes.has(incoming.role)) {
      if (!previous.length || !previous[0].name) {
        original.officials = original.officials.filter(o => o.role !== incoming.role);
        original.officials.push(makeOfficial(store, incoming.role, incoming.name, parsed.channel, context));
      } else if (previous.length === 2) Object.assign(previous[1], { dutyDate: parsed.date, dutyTime: parsed.time });
      continue;
    }
    const split = decision.roles?.[incoming.role];
    if (!split || ['originalBonus', 'resumedBonus', 'originalPercent', 'resumedPercent'].some(k => typeof split[k] !== 'number' || !Number.isFinite(split[k]) || split[k] < 0)) throw new Error('检测到续赛换裁，请确认双方的分配比例及实际补贴（可填 0）');
    const first = { ...previous[0], fraction: 0.5, allocationPercent: split.originalPercent, actualBonus: split.originalBonus, dutyDate: original.date, dutyTime: original.time };
    const second = { ...makeOfficial(store, incoming.role, incoming.name, parsed.channel, context), fraction: 0.5, allocationPercent: split.resumedPercent, actualBonus: split.resumedBonus, dutyDate: parsed.date, dutyTime: parsed.time };
    const index = original.officials.findIndex(o => o.role === incoming.role);
    original.officials = original.officials.filter(o => o.role !== incoming.role);
    original.officials.splice(index, 0, first, second);
  }
  for (const role of new Set(original.officials.map(o => o.role))) {
    const pair = original.officials.filter(o => o.role === role);
    if (pair.length === 2) Object.assign(pair[1], { dutyDate: parsed.date, dutyTime: parsed.time });
  }
  Object.assign(original, { interrupted: true, resumption: { date: parsed.date, time: parsed.time }, status: 'scheduled' });
  if (parsed.avoidanceOverride !== undefined) original.avoidanceOverride = parsed.avoidanceOverride;
  if (parsed.stageDetail !== undefined && parsed.stage === original.stage) original.stageDetail = parsed.stageDetail;
  const issues = [...workloadIssues(original.officials), ...interruptionIssues(original)];
  if (issues.length) throw new Error(issues.join('；'));
}

export function previewAssignmentWorkbook(store, buffer, season = '2026–27', selectedEvent = 'freshmen-cup') {
  const { context, imported } = readAssignments(store, buffer, season, selectedEvent);
  const plan = assignmentPlan(store, imported, context, season);
  const dates = [...store.matches, ...imported.map((m, i) => ({ ...m, id: `preview-${i}`, season }))];
  const rows = imported.map(parsed => {
    const metadata = context.rows.get(parsed), resolution = plan.get(parsed), existing = resolution?.existing || (metadata.continuation ? existingFor(store, parsed, season) : undefined);
    const additionalAssistants = parsed.status !== 'cancelled' && importedAdditionalAssistants(parsed, existing, context);
    const additionalOfficials = additionalAssistants ? additionalAssistantRoles.map(role => {
      const incoming = parsed.officials.find(o => o.role === role);
      const previous = existing?.officials.filter(o => o.role === role) || [];
      const retain = !context.providedRoles.get(parsed)?.has(role) || (!incoming?.name && (resolution?.action === 'reschedule' || metadata.continuation));
      return { role, name: retain ? previous.map(o => o.name).filter(Boolean).join(' / ') || incoming?.name || '' : incoming?.name || '' };
    }) : [];
    const candidates = metadata.continuation ? continuationCandidates(store, parsed, season, imported, context, plan).map(m => {
      const uploaded = imported.find(item => !context.rows.get(item).continuation && (signature(item) === signature(m) || plan.get(item)?.existing?.id === m.id));
      const projected = uploaded && { ...m, officials: uploaded.officials.flatMap(o => {
        const previous = m.officials.filter(old => old.role === o.role);
        return previous.some(old => old.fraction === 0.5) && previous[0]?.name === o.name ? previous : [o];
      }) };
      return { id: m.id, date: m.date, time: m.time, home: m.home, away: m.away, roles: continuationRoles(m, parsed),
        ...(uploaded ? { uploadedOriginal: { weekKey: weekKey(uploaded), roles: continuationRoles(projected, parsed) } } : {}) };
    }) : [];
    return { ...metadata, weekKey: weekKey(parsed), date: parsed.date, time: parsed.time, home: parsed.home, away: parsed.away, stage: parsed.stage, stageDetail: parsed.stageDetail,
      action: resolution?.action || (existing ? 'update' : 'add'), existingId: existing?.id,
      previousSchedule: existing ? { date: existing.date, time: existing.time } : undefined,
      matchCandidates: (resolution?.candidates || []).map(m => ({ id: m.id, date: m.date, time: m.time, home: m.home, away: m.away, group: m.group })),
      colleges: parsed.avoidanceOverride?.colleges, additionalAssistants, additionalOfficials,
      unknownColleges: (parsed.avoidanceOverride?.colleges || []).filter(c => !(store.colleges || []).some(v => v.normalize('NFKC').toLocaleLowerCase() === c.toLocaleLowerCase())), candidates };
  });
  const weeks = [...new Set(rows.map(r => r.weekKey))].sort().reverse().map(key => {
    const end = new Date(`${key}T00:00:00Z`); end.setUTCDate(end.getUTCDate() + 6);
    const first = imported.find(m => weekKey(m) === key);
    return { key, end: end.toISOString().slice(0, 10), semester: matchSemester(first), week: matchWeek({ ...first, id: 'preview-week', season }, dates, store.meta.season), count: rows.filter(r => r.weekKey === key).length };
  });
  return { revision: store.revision || 0, weeks, rows };
}

export function importAssignmentWorkbook(store, buffer, season = '2026–27', selectedEvent = 'freshmen-cup', options = {}) {
  const { context, parsedSheets, imported } = readAssignments(store, buffer, season, selectedEvent);
  const availableWeeks = new Set(imported.map(weekKey));
  if (options.weeks !== undefined && (!Array.isArray(options.weeks) || !options.weeks.length || options.weeks.some(w => !availableWeeks.has(w)))) throw new Error('请选择文件中需要更新的周次');
  const selectedWeeks = new Set(options.weeks || availableWeeks);
  const selected = imported.filter(m => selectedWeeks.has(weekKey(m)));
  if (options.matchTargets !== undefined && (!options.matchTargets || typeof options.matchTargets !== 'object' || Array.isArray(options.matchTargets))) throw new Error('改期确认格式不正确');
  const plan = assignmentPlan(store, imported, context, season, options.matchTargets);
  const targetIds = new Set();
  for (const m of selected.filter(m => !context.rows.get(m).continuation)) {
    const resolution = plan.get(m);
    if (resolution.action === 'confirm') throw new Error(`${m.date} ${m.home}—${m.away} 有多个或跨周原场候选，请在预览中确认更新目标或选择新增比赛`);
    if (resolution.existing) {
      if (targetIds.has(resolution.existing.id)) throw new Error('多行选派指向同一原比赛，请核对改期目标');
      targetIds.add(resolution.existing.id);
    }
  }
  const candidateIds = new Map(selected.filter(m => context.rows.get(m).continuation).map(m => [m, continuationCandidates(store, m, season, imported, context, plan)]));
  context.deferOfficials = false;
  let linked = 0;
  const linkedIds = new Set();

  let nextWeek = Math.max(0, ...store.matches.map((match) => match.week));
  let added = 0;
  let updated = 0;
  for (const continuationPass of [false, true]) for (const { matches: sheetMatches } of parsedSheets) {
    const matches = sheetMatches.filter(m => selected.includes(m) && context.rows.get(m).continuation === continuationPass);
    if (!matches.length) continue;
    const dates = matches.map((match) => match.date);
    const knownWeek = store.matches.find((match) => dates.includes(match.date))?.week;
    const week = knownWeek || ++nextWeek;
    for (const parsed of matches) {
      if (parsed.avoidanceOverride) parsed.avoidanceOverride.colleges = normalizeColleges(parsed.avoidanceOverride.colleges, store.colleges || [], 100);
      const metadata = context.rows.get(parsed);
      if (metadata.continuation) {
        const decision = options.continuations?.[metadata.key];
        if (!decision?.matchId) throw new Error(`${parsed.date} ${parsed.home}—${parsed.away} 备注为接续比赛，请在导入预览中确认原场`);
        const candidate = candidateIds.get(parsed).find(m => m.id === decision.matchId);
        const original = candidate?.id.startsWith('row:') ? existingFor(store, candidate, season) : store.matches.find(m => m.id === candidate?.id);
        if (!original) throw new Error('接续比赛的原场无效，请重新预览并选择');
        if (linkedIds.has(original.id)) throw new Error('同一原场不能在本次导入中关联多个续赛时段，请在比赛设定中核对');
        linkedIds.add(original.id);
        linkContinuation(store, original, parsed, season, decision, context);
        linked += 1;
        continue;
      }
      parsed.officials = parsed.officials.map(o => makeOfficial(store, o.role, o.name, parsed.channel, context));
      const existing = plan.get(parsed).existing;
      if (existing) {
        const officials = parsed.officials.flatMap((official) => {
          const previousGroup = existing.officials.filter((item) => item.role === official.role);
          const previous = previousGroup[0];
          if (additionalAssistantRoles.includes(official.role) && !context.providedRoles.get(parsed)?.has(official.role) && previous) return previousGroup.map(item => ({ ...item }));
          if (plan.get(parsed).action === 'reschedule' && !official.name && previous) return previousGroup.map(item => ({ ...item }));
          if (previousGroup.some((item) => item.fraction === 0.5)) {
            if (parsed.channel === 'five' && !context.providedRoles.get(parsed)?.has(official.role)) return previousGroup.map((item) => ({ ...item }));
            if ((official.refereeId && official.refereeId === previous?.refereeId) || (!official.name && !previous?.name) || (official.name && official.name === previous?.name)) return previousGroup.map((item) => ({ ...item }));
            throw new Error(`${parsed.date} ${parsed.home}—${parsed.away} 已登记续赛换裁，请在比赛设定中调整该岗位，不能用普通选派表覆盖。`);
          }
          // Legacy sheets cannot edit roles they have no columns for.
          if (parsed.channel === 'five' && !context.providedRoles.get(parsed)?.has(official.role) && previous) return { ...previous };
          return { ...official, substitute: previous?.substitute || false };
        });
        const additionalAssistants = importedAdditionalAssistants(parsed, existing, context);
        if (additionalAssistants && parsed.status !== 'cancelled') for (const role of additionalAssistantRoles) {
          if (officials.some(o => o.role === role)) continue;
          const previous = existing.officials.filter((o) => o.role === role);
          officials.push(...(previous.length ? previous : [{ role, refereeId: null, name: '' }]));
        }
        const manual = {
          ...((parsed.stageDetail ?? existing.stageDetail) !== undefined ? { stageDetail: parsed.stageDetail ?? existing.stageDetail } : {}),
          ...(existing.result !== undefined ? { result: existing.result } : {}),
          ...(existing.placementMode !== undefined ? { placementMode: existing.placementMode } : {}),
          ...((parsed.avoidanceOverride ?? existing.avoidanceOverride) !== undefined ? { avoidanceOverride: parsed.avoidanceOverride ?? existing.avoidanceOverride } : {}),
          ...(existing.homeSource !== undefined ? { homeSource: existing.homeSource } : {}),
          ...(existing.awaySource !== undefined ? { awaySource: existing.awaySource } : {}),
        };
        const status = parsed.status === 'cancelled' ? 'cancelled' : existing.status === 'completed' ? 'completed' : 'scheduled';
        Object.assign(existing, parsed, manual, {
          id: existing.id, season: existing.season || season, week: existing.week, officials, additionalAssistants,
          // Omitted groups and legacy stage labels must not erase configured advancement groups.
          group: !parsed.group || stageFor(parsed.group, parsed.channel) !== 'group' ? existing.group : parsed.group,
          stage: importedStage(parsed, existing, context),
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
  return { added, updated, linked, newReferees: context.newReferees, total: selected.length };
}
