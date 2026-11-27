import { afterEach, describe, expect, it, vi } from 'vitest';
import { assignmentExportRows, exportAssignments } from '../src/domain/downloads';
import { assignmentOccurrences } from '../src/domain/workload';
import type { Match, Role } from '../src/domain/types';
const make=(overrides:Partial<Match>={}):Match=>({id:'m1',season:'2026–27',week:1,channel:'eleven',event:'freshmen-cup',competition:'新生杯',date:'2026-11-28',time:'12:00-14:00',venue:'北场',group:'',home:'甲',away:'乙',stage:'semifinal',division:null,status:'scheduled',note:'',bonuses:[],officials:[['referee','主裁甲'],['assistant1','边裁乙'],['assistant2','边裁丙'],['fourth','四官丁']].map(([role,name])=>({role:role as Role,name,refereeId:name})),...overrides});
const record=(rows:string[][],index=1)=>Object.fromEntries(rows[0].map((name,i)=>[name,rows[index][i]]));
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers();});
describe('选派表按岗位导出',()=>{
 it('十一人制四个岗位各占独立列，姓名不混合',()=>{
  const rows=assignmentExportRows([make()]);expect(rows[0]).not.toContain('选派');expect(record(rows)).toMatchObject({'赛制':'十一人制','主裁判':'主裁甲','第一助理':'边裁乙','第二助理':'边裁丙','第四官员':'四官丁'});expect(rows[1]).toHaveLength(rows[0].length);expect(rows[0]).not.toContain('第一附加助理');
 });
 it('有附加助理时放在第四官员后面，并映射到正确姓名',()=>{
  const m=make({additionalAssistants:true});m.officials.unshift({role:'additionalAssistant2',name:'附加己',refereeId:'a2'},{role:'additionalAssistant1',name:'附加戊',refereeId:'a1'});const rows=assignmentExportRows([m]);expect(rows[0].slice(7,13)).toEqual(['主裁判','第一助理','第二助理','第四官员','第一附加助理','第二附加助理']);expect(record(rows)).toMatchObject({'第四官员':'四官丁','第一附加助理':'附加戊','第二附加助理':'附加己'});
 });
 it('仅五人制时使用三个裁判列，不生成四官或附加岗位',()=>{
  const m=make({channel:'five',event:'womens-pku-cup',competition:'女足北大杯',officials:[{role:'first',name:'一裁甲',refereeId:'f1'},{role:'second',name:'二裁乙',refereeId:'f2'},{role:'third',name:'三裁丙',refereeId:'f3'}]});const rows=assignmentExportRows([m]);expect(record(rows)).toMatchObject({'第一裁判':'一裁甲','第二裁判':'二裁乙','第三裁判':'三裁丙'});expect(rows[0]).not.toContain('第四官员');expect(rows[1]).toHaveLength(rows[0].length);
 });
 it('混合赛制正确映射三名五人制裁判，不适用岗位显示横线',()=>{
  const m=make({additionalAssistants:true});const five=make({id:'five',channel:'five',competition:'女足北大杯',officials:[{role:'first',name:'一裁甲',refereeId:'f1'},{role:'second',name:'二裁乙',refereeId:'f2'},{role:'third',name:'三裁丙',refereeId:'f3'}]});const rows=assignmentExportRows([m,five]);expect(record(rows,2)).toMatchObject({'主裁判 / 第一裁判':'一裁甲','第一助理 / 第二裁判':'二裁乙','第二助理 / 第三裁判':'三裁丙','第四官员':'-','第一附加助理':'-','第二附加助理':'-'});expect(rows[2]).toHaveLength(rows[0].length);
 });
 it('适用未选派留空，排位赛不适用附加岗位显示横线',()=>{
  const rows=assignmentExportRows([make({additionalAssistants:true,officials:[]}),make({id:'rank',stage:'placement',additionalAssistants:false,officials:[]})]);expect(record(rows)).toMatchObject({'主裁判':'','第四官员':'','第一附加助理':'','第二附加助理':''});expect(record(rows,2)).toMatchObject({'第一附加助理':'-','第二附加助理':'-'});
 });
 it('已取消比赛不导出残留的选派姓名，也不单独触发附加列',()=>{
  const rows=assignmentExportRows([make({status:'cancelled',additionalAssistants:true})]);expect(record(rows)).toMatchObject({'主裁判':'','第一助理':'','第四官员':'','状态':'已取消'});expect(rows[0]).not.toContain('第一附加助理');
 });
 it('续赛日历行按原场和续赛分别导出对应裁判，不丢失或错位',()=>{
  const m=make({interrupted:true,resumption:{date:'2026-11-29',time:'16:00-18:00'},officials:[{role:'referee',name:'原场甲',refereeId:'r1',fraction:0.5,actualBonus:0},{role:'referee',name:'续赛乙',refereeId:'r2',fraction:0.5,actualBonus:0,dutyDate:'2026-11-29',dutyTime:'16:00-18:00'}]});const rows=assignmentExportRows(assignmentOccurrences([m]));expect(record(rows)).toMatchObject({'日期':'2026-11-28','主裁判':'原场甲'});expect(record(rows,2)).toMatchObject({'日期':'2026-11-29','主裁判':'续赛乙'});
 });
 it('下载保持中文 BOM、引号和换行转义以及公式注入防护，横线仍是普通横线',async()=>{
  vi.useFakeTimers();let blob:Blob|undefined;const click=vi.fn();const link={href:'',download:'',click};vi.stubGlobal('document',{createElement:()=>link});vi.spyOn(URL,'createObjectURL').mockImplementation(value=>{blob=value as Blob;return'blob:csv';});vi.spyOn(URL,'revokeObjectURL').mockImplementation(()=>{});
  const m=make({additionalAssistants:true,note:'=SUM(1,2)\n含"引号"',home:'甲,队'});const rank=make({id:'rank',stage:'placement',additionalAssistants:false});exportAssignments([m,rank]);expect(link.download).toBe('裁判选派.csv');expect(click).toHaveBeenCalledOnce();const bytes=new Uint8Array(await blob!.arrayBuffer());expect([...bytes.slice(0,3)]).toEqual([239,187,191]);const contents=await blob!.text();expect(contents).toContain('"主裁判","第一助理","第二助理","第四官员","第一附加助理","第二附加助理"');expect(contents).toContain('"甲,队"');expect(contents).toContain('"\'=SUM(1,2)\n含""引号"""');expect(contents).toContain('"-","-"');expect(contents).not.toContain('"\'-"');vi.runAllTimers();
 });
});
