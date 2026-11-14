import { strToU8, zipSync } from 'fflate';
import { CURRENT_SEASON, getChannelSummary, getSeasonPoints, getSeasonWage, isKnockoutStage, effectiveMatchStatus } from './calculations';
import { getMatchEvent } from './competitions';
import { officialDuty, officialFraction } from './workload.ts';
import type { Channel, CompetitionEvent, DataStore, Referee } from './types';

type Cell = string | number;

export const elevenExportHeaders = ['姓名', '原级别', '原积分', '现积分', '现级别', '得分', '新生-主', '新生-主淘', '新生-边', '新生-边淘', '新生-四', '新生-四淘', '北大-主甲', '北大-主乙', '北大-主甲淘', '北大-主乙淘', '北大-边甲', '北大-边乙', '北大-边甲淘', '北大-边乙淘', '北大-四甲', '北大-四乙', '北大-四甲淘', '北大-四乙淘', '奖金', '扣钱', '额外得分', '扣分', '工资'];
export const fiveExportHeaders = ['姓名', '原积分', '原评级', '一裁/二裁', '三裁', '奖惩积分', '奖惩工资', '新积分', '新评级', '工资'];

function exportContext(referee: Referee, channel: Channel, season: string, data: DataStore) {
  const { matches, adjustments, wageStandards } = data;
  return {
    stats: referee.channels[channel]!,
    summary: getChannelSummary(referee, channel, matches, adjustments, wageStandards)!,
    points: getSeasonPoints(referee, channel, season, matches, adjustments, wageStandards)!,
    wage: getSeasonWage(referee, channel, season, matches, adjustments, wageStandards)!,
  };
}

export function seasonExportRows(data: DataStore, season = CURRENT_SEASON) {
  const unclassified = data.matches.find((match) => getMatchEvent(match) === 'mens-pku-cup' && (match.season || CURRENT_SEASON) === season && match.officials.some((o) => o.refereeId && effectiveMatchStatus(officialDuty(match, o)) === 'completed') && !['甲', '乙'].includes(match.division || ''));
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

  return {
    eleven: [elevenExportHeaders, ...eleven],
    five: [fiveExportHeaders, ...five],
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

export function createSeasonWorkbook(data: DataStore, season = CURRENT_SEASON) {
  const rows = seasonExportRows(data, season);
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets><sheet name="十一人制" sheetId="1" r:id="rId1"/><sheet name="五人制" sheetId="2" r:id="rId2"/></sheets></workbook>`;
  return zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'),
    '_rels/.rels': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'),
    'xl/workbook.xml': strToU8(workbook),
    'xl/_rels/workbook.xml.rels': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'),
    'xl/styles.xml': strToU8(styles),
    'xl/worksheets/sheet1.xml': strToU8(worksheet(rows.eleven, [15, 10, 11, 11, 10, 10, ...Array(18).fill(13), 11, 11, 12, 11, 12], [2, 3, 5, 26, 27])),
    'xl/worksheets/sheet2.xml': strToU8(worksheet(rows.five, [17, 11, 11, 14, 10, 13, 13, 11, 11, 12], [1, 5, 7])),
  });
}

export function downloadSeasonWorkbook(data: DataStore, season = CURRENT_SEASON) {
  const workbook = createSeasonWorkbook(data, season);
  const url = URL.createObjectURL(new Blob([workbook], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${season.replace(/–/g, '-')}裁判积分与工资表.xlsx`;
  link.click();
  URL.revokeObjectURL(url);
}
