import { describe, expect, it } from 'vitest';
import type { DataStore, Match, Official } from '../src/domain/types';
import { automaticTimeBonuses, matchBonuses } from '../src/domain/time-bonuses';
import { calculateOfficial, getSeasonWage } from '../src/domain/calculations';
// @ts-expect-error Shared Fetch API is implemented in Node ESM.
import { handleApi } from '../server/api.mjs';
// @ts-expect-error XLSX import shares the same time classification.
import { importAssignmentWorkbook } from '../server/assignment-import.mjs';
import { strToU8, zipSync } from 'fflate';
const official: Official = { role: 'referee', refereeId: 'r1', name: '测试裁判' };
const match = (overrides: Partial<Match> = {}): Match => ({ id: 'm1', season: '2026–27', week: 1, channel: 'eleven', event: 'freshmen-cup', competition: '新生杯', date: '2026-11-07', time: '12:00-14:00', venue: '测试场', group: 'A', home: '测试甲', away: '测试乙', stage: 'group', division: null, status: 'completed', note: '', bonuses: [], officials: [official], ...overrides });
function seed(): DataStore { return { version: 1, revision: 0, meta: { association: '测试', season: '2026–27', rulesVersion: '测试', importedAt: '2026-11-01T00:00:00Z', sourceFiles: [], counts: { elevenMatches: 1, fiveMatches: 0, cancelledMatches: 0 } }, matches: [match({ bonuses: ['early', 'late', 'weekday', 'badWeather'] })], referees: [{ id: 'r1', name: '测试裁判', channels: { eleven: { basePoints: 0, baseLevel: 'C', previousWage: 0, historical: { pointsEarned: 0, roleCounts: {}, bonusWage: 0, deductedWage: 0, bonusPoints: 0, deductedPoints: 0 } } } }], adjustments: [] }; }

describe('开赛时间及非周末自动判定', () => {
  it.each([
    ['09:59-11:59', ['early']], ['10:00-12:00', ['early']], ['10:01-12:01', []],
    ['19:59-21:59', []], ['20:00-22:00', ['late']], ['23:00-01:00', ['late']],
    ['18:00-20:00', []], ['20:00—22:00', ['late']], ['00:00-02:00', ['early']], [' 10:00 – 12:00 ', ['early']],
  ])('%s 按开始时间判定，包含 10:00 和 20:00 边界', (time, expected) => {
    expect(automaticTimeBonuses(match({ time: time as string }))).toEqual(expected);
  });
  it('周一至周五是非常规时间，周六周日不是；与周四起算的比赛周相互独立', () => {
    for (const date of ['2026-11-09','2026-11-10','2026-11-11','2026-11-12','2026-11-13']) expect(automaticTimeBonuses(match({ date }))).toEqual(['weekday']);
    for (const date of ['2026-11-07','2026-11-08']) expect(automaticTimeBonuses(match({ date }))).toEqual([]);
    expect(automaticTimeBonuses(match({ date: '2026-11-06', time: '09:00-11:00' }))).toEqual(['early', 'weekday']);
    expect(automaticTimeBonuses(match({ date: '2026-11-06', time: '20:00-22:00' }))).toEqual(['late', 'weekday']);
  });
  it('无效待填值不抛异常，旧手动时间标记会被取代，天气标记保留', () => {
    expect(automaticTimeBonuses(match({ date: '', time: '' }))).toEqual([]);
    expect(automaticTimeBonuses(match({ date: '2026-02-30', time: '25:90' }))).toEqual([]);
    expect(matchBonuses(match({ bonuses: ['early','late','weekday','badWeather','badWeather'] }))).toEqual(['badWeather']);
  });
  it('早场和非常规时间只补一次，仍可叠加天气、半决赛及临时替补', () => {
    const m = match({ date: '2026-11-06', time: '09:00-11:00', stage: 'semifinal', bonuses: ['early','weekday','badWeather'] });
    const result = calculateOfficial(m, { ...official, role: 'additionalAssistant1', substitute: true }, 'C');
    expect(result).toMatchObject({ points: 3, baseWage: 60, bonusWage: 40, wage: 100 });
    expect(calculateOfficial({ ...m, date: '2026-11-08', time: '12:00-14:00', stage: 'group', bonuses: ['early','weekday'] }, official, 'C').bonusWage).toBe(0);
    const data=seed(); expect(getSeasonWage(data.referees[0], 'eleven', '2026–27', [{ ...m, status: 'cancelled' }], [])!.total).toBe(0);
  });
  it('已有赛程读取、保存和改期统一重算，不信任客户端手动时间标记', async () => {
    let data=seed();let writes=0;
    const repo={async load(){return structuredClone(data);},async save(next:DataStore){data=next;writes++;}};
    const call=(method:string,url:string,body?:unknown)=>handleApi(new Request('https://test'+url,{method,headers:{'Content-Type':'application/json','If-Match':String(data.revision)},...(body?{body:JSON.stringify(body)}:{})}),repo,{authenticated:true});
    const read=await(await call('GET','/api/data')).json();expect(read.matches[0].bonuses).toEqual(['badWeather']);expect(writes).toBe(0);
    const created=await(await call('POST','/api/matches',match({id:'m2',date:'2026-11-08',time:'10:00-12:00',bonuses:['late','weekday','badWeather']}))).json();expect(created.bonuses).toEqual(['early','badWeather']);
    const changed=await(await call('PUT','/api/matches/m2',match({id:'m2',date:'2026-11-09',time:'20:00-22:00',bonuses:['early','badWeather']}))).json();expect(changed.bonuses).toEqual(['late','weekday','badWeather']);
    expect(calculateOfficial(changed,official,'C').bonusWage).toBe(20);
  });
  it('Excel 无需填写晚场备注，也会从实际时间自动补上标记', () => {
    const data=seed();data.matches=[];
    const row=(values:string[],n:number)=>`<row r="${n}">${values.map((v,i)=>`<c r="${String.fromCharCode(65+i)}${n}" t="inlineStr"><is><t>${v}</t></is></c>`).join('')}</row>`;
    const workbook=zipSync({'xl/workbook.xml':strToU8('<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="测试" sheetId="1" r:id="rId1"/></sheets></workbook>'),'xl/_rels/workbook.xml.rels':strToU8('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'),'xl/worksheets/sheet1.xml':strToU8(`<worksheet><sheetData>${row(['日期','时间','场地','组别','主队','客队','主裁判','助理1','助理2','四官'],1)}${row(['11.7','20:00-22:00','测试场','A','测试甲','测试乙','','','',''],2)}</sheetData></worksheet>`)});
    importAssignmentWorkbook(data,workbook,'2026–27');expect(data.matches[0].bonuses).toEqual(['late']);
  });
});
