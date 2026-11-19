import { strToU8, zipSync } from 'fflate';
import { CURRENT_SEASON, getChannelSummary, getSeasonPoints, getSeasonWage, isKnockoutStage, effectiveMatchStatus } from './calculations';
import { getMatchEvent } from './competitions';
import { officialDuty, officialFraction } from './workload.ts';
import type { Channel, CompetitionEvent, DataStore, Referee } from './types';

type Cell = string | number;

export const elevenExportHeaders = ['姓名', '原级别', '原积分', '现积分', '现级别', '得分', '新生-主', '新生-主淘', '新生-边', '新生-边淘', '新生-四', '新生-四淘', '北大-主甲', '北大-主乙', '北大-主甲淘', '北大-主乙淘', '北大-边甲', '北大-边乙', '北大-边甲淘', '北大-边乙淘', '北大-四甲', '北大-四乙', '北大-四甲淘', '北大-四乙淘', '奖金', '扣钱', '额外得分', '扣分', '工资'];
export const fiveExportHeaders = ['姓名', '原积分', '原评级', '一裁/二裁', '三裁', '奖惩积分', '奖惩工资', '新积分', '新评级', '工资'];
const eventFinancialHeaders = ['奖金', '额外得分', '累计扣除积分', '累计扣除工资', '工资'];
const elevenEventPrefix = ['姓名', '原级别', '赛季原积分', '现累计积分', '现级别', '本赛事执裁得分'];
export const eventExportHeaders: Record<CompetitionEvent, string[]> = {
  'freshmen-cup': [...elevenEventPrefix, ...elevenExportHeaders.slice(6, 12), ...eventFinancialHeaders],
  'mens-pku-cup': [...elevenEventPrefix, ...elevenExportHeaders.slice(12, 24), ...eventFinancialHeaders],
  'womens-pku-cup': ['姓名', '赛季原积分', '原评级', '一裁/二裁', '三裁', ...eventFinancialHeaders.slice(0, 4), '现累计积分', '新评级', '工资'],
};

function exportContext(referee: Referee, channel: Channel, season: string, data: DataStore) {
  const { matches, adjustments, wageStandards } = data;
  return {
    stats: referee.channels[channel]!,
    summary: getChannelSummary(referee, channel, matches, adjustments, wageStandards)!,
    points: getSeasonPoints(referee, channel, season, matches, adjustments, wageStandards)!,
    wage: getSeasonWage(referee, channel, season, matches, adjustments, wageStandards)!,
  };
}

export function seasonExportRows(data: DataStore, season = CURRENT_SEASON, selectedEvent?: CompetitionEvent) {
  const unclassified = (!selectedEvent || selectedEvent === 'mens-pku-cup') && data.matches.find((match) => getMatchEvent(match) === 'mens-pku-cup' && (match.season || CURRENT_SEASON) === season && match.officials.some((o) => o.refereeId && effectiveMatchStatus(officialDuty(match, o)) === 'completed') && !['甲', '乙'].includes(match.division || ''));
  if (unclassified) throw new Error(`${unclassified.date} ${unclassified.home}—${unclassified.away} 尚未设置北大杯甲／乙级，请在比赛设定中补全后导出。`);
  const eleven = data.referees.filter((referee) => referee.channels.eleven).map((referee): Cell[] => {
    const { stats, summary, points, wage } = exportContext(referee, 'eleven', season, data);
    const count = (roles: string[], knockout: boolean, event: CompetitionEvent, division?: '甲' | '乙') => wage.contributions
      .filter(({ match, official }) => roles.includes(official.role) && getMatchEvent(match) === event && isKnockoutStage(match.stage) === knockout && (!division || match.division === division))
      .reduce((total, { official }) => total + officialFraction(official), 0);
    const roleGroups = [['referee'], ['assistant1', 'assistant2', 'additionalAssistant1', 'additionalAssistant2'], ['fourth']];
    const roleCounts = [
      ...roleGroups.flatMap((roles) => [count(roles, false, 'freshmen-cup'), count(roles, true, 'freshmen-cup')]),
      ...roleGroups.flatMap((roles) => [count(roles, false, 'mens-pku-cup', '甲'), count(roles, false, 'mens-pku-cup', '乙'), count(roles, true, 'mens-pku-cup', '甲'), count(roles, true, 'mens-pku-cup', '乙')]),
    ];
    const rewardWage = wage.adjustments.filter((item) => item.wage > 0).reduce((sum, item) => sum + item.wage, 0);
    const deductedWage = wage.adjustments.filter((item) => item.wage < 0).reduce((sum, item) => sum + Math.abs(item.wage), 0);
    const rewardPoints = wage.adjustments.filter((item) => item.points > 0).reduce((sum, item) => sum + item.points, 0);
    const deductedPoints = wage.adjustments.filter((item) => item.points < 0).reduce((sum, item) => sum + Math.abs(item.points), 0);
    return [
      referee.name, stats.baseLevel, stats.basePoints, Math.max(0, stats.basePoints + points.total), summary.level, points.matchPoints,
      ...roleCounts, wage.bonusWage + rewardWage, deductedWage, rewardPoints, deductedPoints, wage.total,
    ];
  });

  const five = data.referees.filter((referee) => referee.channels.five).map((referee): Cell[] => {
    const { stats, summary, points, wage } = exportContext(referee, 'five', season, data);
    const firstSecond = wage.contributions.filter(({ official }) => ['first', 'second'].includes(official.role)).reduce((sum, { official }) => sum + officialFraction(official), 0);
    const third = wage.contributions.filter(({ official }) => official.role === 'third').reduce((sum, { official }) => sum + officialFraction(official), 0);
    return [
      referee.name, stats.basePoints, stats.baseLevel, firstSecond, third, points.adjustmentPoints,
      wage.adjustmentWage, Math.max(0, stats.basePoints + points.total), summary.level, wage.total,
    ];
  });

  // Keep the channel summaries for existing internal consumers. Downloads use
  // the tournament sheets below so wages and penalties never mix tournaments.
  const events = (['freshmen-cup', 'mens-pku-cup', 'womens-pku-cup'] as const).map(event => {
    const channel: Channel = event === 'womens-pku-cup' ? 'five' : 'eleven';
    const rows: Cell[][] = data.referees.filter(referee => referee.channels[channel]).map(referee => {
      const { stats, summary, points, wage } = exportContext(referee, channel, season, data);
      const contributions = wage.contributions.filter(item => getMatchEvent(item.match) === event);
      const adjustments = wage.adjustments.filter(item => {
        const linkedMatch = data.matches.find(match => match.id === item.matchId);
        return (item.event || (linkedMatch ? getMatchEvent(linkedMatch) : null)) === event;
      });
      const sum = (values: number[], digits: number) => Number(values.reduce((a, b) => a+b, 0).toFixed(digits));
      const bonus = sum([...contributions.map(item => item.bonusWage), ...adjustments.filter(item => item.wage > 0).map(item => item.wage)], 2);
      const extraPoints = sum(adjustments.filter(item => item.points > 0).map(item => item.points), 1);
      const deductedPoints = sum(adjustments.filter(item => item.points < 0).map(item => -item.points), 1);
      const deductedWage = sum(adjustments.filter(item => item.wage < 0).map(item => -item.wage), 2);
      const total = sum([...contributions.map(item => item.wage), ...adjustments.map(item => item.wage)], 2);
      const currentPoints = Number(Math.max(0, stats.basePoints+points.total).toFixed(1));
      const count = (roles: string[], knockout?: boolean, division?: '甲' | '乙') => contributions.filter(item => roles.includes(item.official.role) && (knockout === undefined || isKnockoutStage(item.match.stage) === knockout) && (!division || item.match.division === division)).reduce((sum, item) => sum+officialFraction(item.official), 0);
      if (channel === 'five') return [referee.name, stats.basePoints, stats.baseLevel, count(['first', 'second']), count(['third']), bonus, extraPoints, deductedPoints, deductedWage, currentPoints, summary.level, total];
      const roleGroups = [['referee'], ['assistant1', 'assistant2', 'additionalAssistant1', 'additionalAssistant2'], ['fourth']];
      const counts = event === 'freshmen-cup'
        ? roleGroups.flatMap(roles => [count(roles, false), count(roles, true)])
        : roleGroups.flatMap(roles => [count(roles, false, '甲'), count(roles, false, '乙'), count(roles, true, '甲'), count(roles, true, '乙')]);
      return [referee.name, stats.baseLevel, stats.basePoints, currentPoints, summary.level, sum(contributions.map(item => item.points), 1), ...counts, bonus, extraPoints, deductedPoints, deductedWage, total];
    });
    return { event, name: event === 'freshmen-cup' ? '新生杯' : event === 'mens-pku-cup' ? '男足北大杯' : '女足北大杯', rows: [eventExportHeaders[event], ...rows] };
  });
  return {
    eleven: [elevenExportHeaders, ...eleven],
    five: [fiveExportHeaders, ...five],
    events: selectedEvent ? events.filter(sheet => sheet.event === selectedEvent) : events,
  };
}

const escapeXml = (value: string) => value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]!);
const columnName = (index: number) => {
  let name = '';
  for (let value = index + 1; value; value = Math.floor((value - 1) / 26)) name = String.fromCharCode(65 + ((value - 1) % 26)) + name;
  return name;
};

function worksheet(rows: Cell[][], widths: number[], pointColumns: number[]) {
  const lastColumn = columnName(rows[0].length - 1);
  const body = rows.map((row, rowIndex) => {
    const cells = row.map((cell, columnIndex) => {
      const reference = `${columnName(columnIndex)}${rowIndex + 1}`;
      if (typeof cell === 'number') return `<c r="${reference}" s="${pointColumns.includes(columnIndex) ? 5 : 3}"><v>${Number.isFinite(cell) ? cell : 0}</v></c>`;
      const style = rowIndex === 0 ? 1 : columnIndex === 0 ? 2 : 4;
      return `<c r="${reference}" s="${style}" t="inlineStr"><is><t>${escapeXml(cell)}</t></is></c>`;
    }).join('');
    return `<row r="${rowIndex + 1}"${rowIndex === 0 ? ' ht="28" customHeight="1"' : ''}>${cells}</row>`;
  }).join('');
  const columns = widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${lastColumn}${rows.length}"/><sheetViews><sheetView zoomScale="85" workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="20"/><cols>${columns}</cols><sheetData>${body}</sheetData><autoFilter ref="A1:${lastColumn}${rows.length}"/><pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.2" footer="0.2"/></worksheet>`;
}

const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="0.##"/><numFmt numFmtId="165" formatCode="0.0"/></numFmts><fonts count="2"><font><sz val="11"/><name val="等线"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="等线"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF8C1D2F"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFD9D9D9"/></left><right style="thin"><color rgb="FFD9D9D9"/></right><top style="thin"><color rgb="FFD9D9D9"/></top><bottom style="thin"><color rgb="FFD9D9D9"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="6"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="165" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf></cellXfs><cellStyles count="1"><cellStyle name="常规" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;

export function createSeasonWorkbook(data: DataStore, season = CURRENT_SEASON, event?: CompetitionEvent) {
  const rows = seasonExportRows(data, season, event);
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>${rows.events.map((sheet, i) => `<sheet name="${sheet.name}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')}</sheets></workbook>`;
  return zipSync({
    '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${rows.events.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`),
    '_rels/.rels': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'),
    'xl/workbook.xml': strToU8(workbook),
    'xl/_rels/workbook.xml.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rows.events.map((_, i) => `<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('')}<Relationship Id="rId${rows.events.length+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    'xl/styles.xml': strToU8(styles),
    ...Object.fromEntries(rows.events.map((sheet, i) => [`xl/worksheets/sheet${i+1}.xml`, strToU8(worksheet(sheet.rows, sheet.rows[0].map(header => header === '姓名' ? 17 : String(header).includes('积分') || String(header).includes('扣除') || header === '本赛事执裁得分' ? 18 : 13), sheet.rows[0].flatMap((header, i) => String(header).includes('积分') || String(header).includes('得分') ? [i] : [])))])),
  });
}

export function downloadSeasonWorkbook(data: DataStore, season = CURRENT_SEASON, event?: CompetitionEvent) {
  const workbook = createSeasonWorkbook(data, season, event);
  const url = URL.createObjectURL(new Blob([workbook], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const link = document.createElement('a');
  link.href = url;
  const name = event ? ({ 'freshmen-cup': '新生杯', 'mens-pku-cup': '男足北大杯', 'womens-pku-cup': '女足北大杯' }[event]) : '';
  link.download = `${season.replace(/–/g, '-')}${name}裁判积分与工资表.xlsx`;
  link.click();
  URL.revokeObjectURL(url);
}
