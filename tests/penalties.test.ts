import { describe, expect, it, vi } from 'vitest';
import type { DataStore, Match, PenaltyInput } from '../src/domain/types';
import { initialChannelStats } from '../src/domain/referees';
import { getChannelSummary, getSeasonWage } from '../src/domain/calculations';
import { quotePenalty, pointsBeforeIncident } from '../src/domain/penalties';
import { penaltyRules } from '../src/domain/penalty-rules';
import { penaltyEligibilityIssues } from '../src/domain/penalty-eligibility';
import { assignmentIssues, matchInterval } from '../src/domain/scheduling';
import { seasonExportRows } from '../src/domain/season-export';
// @ts-expect-error Shared server API.
import { handleApi } from '../server/api.mjs';
// @ts-expect-error Snapshot schema.
import { validateSnapshot } from '../server/validation.mjs';
// @ts-expect-error Public serializer.
import { readableStore } from '../server/access.mjs';
const season='2026–27';
function seed():DataStore{
 const make=(id:string,date:string,overrides:Partial<Match>={}):Match=>({id,season,week:1,channel:'eleven',event:'freshmen-cup',competition:'新生杯',date,time:'12:00-14:00',venue:'北场',group:'A',home:'甲',away:'乙',stage:'group',division:null,status:'completed',note:'',bonuses:[],officials:[{role:'referee',refereeId:'r1',name:'裁判甲'}],...overrides});
 return {version:1,revision:0,meta:{association:'测试',season,rulesVersion:'2026秋',importedAt:'2026-11-01',sourceFiles:[],counts:{elevenMatches:3,fiveMatches:2,cancelledMatches:0}},referees:[{id:'r1',name:'裁判甲',channels:{eleven:{...initialChannelStats('eleven'),basePoints:100,baseLevel:'A'},five:{...initialChannelStats('five'),basePoints:50,baseLevel:'A'}}},{id:'r2',name:'裁判乙',channels:{eleven:initialChannelStats('eleven'),five:initialChannelStats('five')}}],matches:[make('prior','2026-10-03'),make('current','2026-10-10',{stage:'knockout',time:'20:00-22:00',bonuses:['badWeather']}),make('later','2026-10-17'),make('five-prior','2026-10-02',{channel:'five',event:'womens-pku-cup',competition:'女足北大杯',officials:[{role:'first',refereeId:'r1',name:'裁判甲'}]}),make('five-later','2026-10-20',{channel:'five',event:'womens-pku-cup',competition:'女足北大杯',officials:[{role:'third',refereeId:'r1',name:'裁判甲'}]})],adjustments:[]};
}
const input=(ruleCode='professional',extra:Partial<PenaltyInput>={}):PenaltyInput=>({matchId:'current',refereeId:'r1',ruleCode,reason:'本场具体事实和裁判部决定',effectiveDate:'2026-10-11',...extra});
function fixture(initial=seed()){
 let data=structuredClone(initial),writes=0;
 const repo={load:async()=>structuredClone(data),save:async(next:DataStore)=>{data=structuredClone(next);writes++;}};
 const call=(method:string,path:string,body?:unknown,authenticated=true,revision=data.revision)=>handleApi(new Request('https://test'+path,{method,headers:{'Content-Type':'application/json','If-Match':String(revision)},...(body===undefined?{}:{body:JSON.stringify(body)})}),repo,{authenticated,publicQueries:true});
 return {call,get data(){return data;},get writes(){return writes;}};
}
describe('按管理办法登记处罚',()=>{
 it.each(penaltyRules.map(r=>[r.code,r] as const))('条款 %s 可独立预览并通过持久化校验',async(code,r)=>{
  const f=fixture();const response=await f.call('POST','/api/penalties',input(code,{matchPointsPercent:r.matchPoints,cumulativePercent:r.cumulative,wagePercent:r.wage[0],extraPoints:r.extra[0],suspensionWeeks:r.suspension[0],qualificationYears:r.years|| (r.qualifications?2:0),qualifications:r.qualifications==='choose'?['elevenReferee']:[]}));expect(response.status).toBe(201);expect(validateSnapshot(f.data)).toBeTruthy();
 });
 it('事件记录不附加通报，备份恢复验证决策百分比与生效日期',async()=>{
  expect(()=>quotePenalty(seed(),input('unavoidable',{internalNotice:true}))).toThrow();
  const f=fixture();await f.call('POST','/api/penalties',input());
  for(const change of [(d:DataStore)=>d.adjustments[0].penalty!.decision.wagePercent=NaN,(d:DataStore)=>d.adjustments[0].penalty!.decision.effectiveDate='2020-01-01']){const d=structuredClone(f.data);change(d);expect(()=>validateSnapshot(d)).toThrow();}
 });
 it('工资比例包含时间天气补贴，积分基数取违规比赛前，不混入本场和后续比赛',()=>{
  const d=seed(),q=quotePenalty(d,input('technical',{wagePercent:20}));expect(q.penalty.basis).toMatchObject({matchPoints:6,baseWage:125,bonusWage:20,totalWage:145,beforePoints:104});expect(q).toMatchObject({points:-6,wage:-29});
  expect(quotePenalty(d,input('late-30-60'))).toMatchObject({points:-52,wage:-145});
  expect(pointsBeforeIncident(d,'r1','eleven',matchInterval(d.matches[1])![0],'current')).toBe(104);
 });
 it.each([['technical',20],['technical',50],['kit',20],['kit',50],['movement',50],['movement',100],['inattention',50],['inattention',100]] as const)('%s支持条款边界%s%%', (code,wagePercent)=>{
  const r=penaltyRules.find(r=>r.code===code)!;expect(quotePenalty(seed(),input(code,{wagePercent,extraPoints:r.extra[0],suspensionWeeks:r.suspension[0]})).wage).toBe(-145*wagePercent/100);
 });
 it.each([{wagePercent:19},{wagePercent:51},{wagePercent:NaN},{wagePercent:-1},{extraPoints:1},{cumulativePercent:100},{matchPointsPercent:50}])('不允许绕过条款范围：%j',extra=>expect(()=>quotePenalty(seed(),input('technical',extra))).toThrow());
 it('区间不得擅自选默认幅度；从轻需依据且不超过原上限',()=>{
  expect(()=>quotePenalty(seed(),input('technical'))).toThrow();expect(()=>quotePenalty(seed(),input('technical',{wagePercent:10,mitigated:true}))).toThrow();
  expect(quotePenalty(seed(),input('technical',{wagePercent:10,matchPointsPercent:30,mitigated:true,mitigationReason:'因不可抗力，裁判部决定减轻'}))).toMatchObject({points:-1.8,wage:-14.5});
  expect(()=>quotePenalty(seed(),input('technical',{wagePercent:60,mitigated:true,mitigationReason:'理由'}))).toThrow();
 });
 it('最低金额以本次总工资计算，并最多扣完半场实际收入；积分保持一位小数',()=>{
  const d=seed(),m=d.matches[1];d.referees[0].channels.eleven!.baseLevel='E';m.interrupted=true;m.resumption={date:'2026-10-11',time:'12:00-14:00'};m.officials=[{role:'fourth',refereeId:'r1',name:'裁判甲',fraction:0.5,actualBonus:3},{role:'fourth',refereeId:'r2',name:'裁判乙',fraction:0.5,actualBonus:0,dutyDate:'2026-10-11',dutyTime:'12:00-14:00'}];
  const q=quotePenalty(d,input('equipment'));expect(q).toMatchObject({points:-0.8,wage:-13});expect(q.penalty.basis.totalWage).toBe(13);
 });
 it('续赛处罚以续赛发生时点取赛前累计，排除同场原场已计积分，工资仍用账面整场工资',()=>{
  const d=seed(),m=d.matches[1];m.interrupted=true;m.resumption={date:'2026-10-18',time:'12:00-14:00'};
  const q=quotePenalty(d,input('late-30-60',{dutySession:'resumption',effectiveDate:'2026-10-19'}));expect(q.penalty.basis).toMatchObject({date:'2026-10-18',beforePoints:108,totalWage:145});expect(q.points).toBe(-54);
 });
 it('预览无写入，服务端核算防伪造，旧版本提交拒绝；之后改工资不重算已冻结处罚',async()=>{
  const f=fixture(),body={...input('technical',{wagePercent:20}),points:-9999,wage:-9999};const p=await f.call('POST','/api/penalties/preview',body);expect(p.status).toBe(200);expect(f.writes).toBe(0);
  expect((await f.call('POST','/api/penalties',body)).status).toBe(201);expect(f.data.adjustments[0]).toMatchObject({points:-6,wage:-29});
  expect((await f.call('POST','/api/penalties',body,true,0)).status).toBe(409);expect(f.writes).toBe(1);f.data.wageStandards={'freshmen-cup':{A:[250,70,45]}};expect(f.data.adjustments[0].wage).toBe(-29);expect(validateSnapshot(f.data)).toBeTruthy();
 });
 it.each(['unavoidable','preparation-warning'])('允许零扣分零扣薪的事件／警告：%s',async code=>{
  const f=fixture();expect((await f.call('POST','/api/penalties',input(code))).status).toBe(201);expect(f.data.adjustments[0]).toMatchObject({type:'penalty',points:0,wage:0});expect(validateSnapshot(f.data)).toBeTruthy();
 });
 it('多项处罚不会重复扣掉本场积分或扣出超过整场的工资',async()=>{
  const f=fixture();for(let i=0;i<3;i++)expect((await f.call('POST','/api/penalties',input('technical',{wagePercent:50}))).status).toBe(201);
  expect(f.data.adjustments.reduce((s,a)=>s+a.points,0)).toBe(-6);expect(f.data.adjustments.reduce((s,a)=>s+a.wage,0)).toBe(-145);
 });
 it('累计扣分不形成未来积分负债，屡犯不改受10分与2周上限限制',()=>{
  const d=seed();d.referees[0].channels.eleven!.basePoints=0;const q=quotePenalty(d,input('inattention',{wagePercent:50,extraPoints:20,suspensionWeeks:1,repeat:true,repeatPoints:10,repeatWeeks:2}));expect(q.penalty.deductions.extraPoints).toBe(4);expect(q.penalty.sanctions.suspensionEnd).toBe('2026-11-01');expect(()=>quotePenalty(d,input('professional',{repeat:true,repeatPoints:11,repeatWeeks:0}))).toThrow();
 });
 it('原定裁判已被替换须明确确认，未计本场收入不能再次扣除，但可处理其累计积分和资格',()=>{
  const d=seed();d.referees[1].channels.eleven!.basePoints=20;expect(()=>quotePenalty(d,{...input('absence',{wagePercent:100}),refereeId:'r2',role:'assistant1'})).toThrow();
  const q=quotePenalty(d,{...input('absence',{wagePercent:100}),refereeId:'r2',role:'assistant1',originalAssignmentConfirmed:true});expect(q).toMatchObject({points:-20,wage:0});expect(q.penalty.basis.originalAssignment).toBe(true);expect(q.penalty.sanctions.qualifications).toEqual(['elevenAssistant']);
 });
 it('停哨会拦截该时段新选派并标记已有选派，期满自动解除，之前比赛不受影响',async()=>{
  const f=fixture();expect((await f.call('POST','/api/penalties',input('late-30-60'))).status).toBe(201);
  expect(penaltyEligibilityIssues('r1','referee','2026-10-24',f.data.adjustments).join()).toContain('停哨');expect(penaltyEligibilityIssues('r1','referee','2026-10-25',f.data.adjustments)).toEqual([]);expect(penaltyEligibilityIssues('r1','referee','2026-10-03',f.data.adjustments)).toEqual([]);
  const make=(date:string)=>({...f.data.matches[0],id:'new-'+date,date,status:'scheduled',home:'丙',away:'丁'});
  expect((await f.call('POST','/api/matches',make('2026-10-21'))).status).toBe(400);expect((await f.call('POST','/api/matches',make('2026-10-26'))).status).toBe(201);
  expect(assignmentIssues(f.data.matches[2],f.data.matches,[],{adjustments:f.data.adjustments}).join()).toContain('停哨');
 });
 it('取消单项资格仅限制对应岗位，不自动因年限到期恢复，考核通过恢复要符合日期和范围',async()=>{
  const f=fixture();expect((await f.call('POST','/api/penalties',input('absence',{wagePercent:100}))).status).toBe(201);const a=f.data.adjustments[0];
  expect(penaltyEligibilityIssues('r1','referee','2028-10-11',f.data.adjustments).join()).toContain('资格');expect(penaltyEligibilityIssues('r1','assistant1','2026-10-11',f.data.adjustments)).toEqual([]);
  expect((await f.call('POST',`/api/penalties/${a.id}/reinstate`,{date:'2026-10-12',reason:'考核',qualifications:['elevenReferee']})).status).toBe(400);
  vi.useFakeTimers();vi.setSystemTime(new Date('2030-01-01T00:00:00Z'));
  try{expect((await f.call('POST',`/api/penalties/${a.id}/reinstate`,{date:'2027-10-11',reason:'重新考核通过',qualifications:['elevenReferee']})).status).toBe(200);expect(penaltyEligibilityIssues('r1','referee','2027-10-11',f.data.adjustments)).toEqual([]);expect(validateSnapshot(f.data)).toBeTruthy();}finally{vi.useRealTimers();}
 });
 it('全部身份取消时两个赛制按赛前积分清零，保留之后取得的积分并正确公开与导出',async()=>{
  const f=fixture();expect((await f.call('POST','/api/penalties',input('fight',{wagePercent:100,schoolNotice:true}))).status).toBe(201);const a=f.data.adjustments[0];expect(a.crossChannelPoints).toEqual({channel:'five',points:-52});expect(a.penalty!.sanctions.qualifications).toHaveLength(4);
  expect(getChannelSummary(f.data.referees[0],'eleven',f.data.matches,f.data.adjustments)!.points).toBe(4);expect(getChannelSummary(f.data.referees[0],'five',f.data.matches,f.data.adjustments)!.points).toBe(1);
  const pub=readableStore(f.data,{authenticated:false,publicQueries:true});expect(pub.adjustments[0].penalty).toBeUndefined();expect(getChannelSummary(pub.referees[0],'five',pub.matches,pub.adjustments)!.points).toBe(1);expect(seasonExportRows(f.data).five[1]).toContain(-52);expect(validateSnapshot(f.data)).toBeTruthy();
 });
 it('撤销保留审计记录并还原金额与资格状态，禁止直接删除新处罚',async()=>{
  const f=fixture();const before=getChannelSummary(f.data.referees[0],'eleven',f.data.matches,[])!.points;await f.call('POST','/api/penalties',input('absence',{wagePercent:100}));const id=f.data.adjustments[0].id;
  expect((await f.call('DELETE','/api/adjustments/'+id)).status).toBe(400);expect((await f.call('POST',`/api/penalties/${id}/revoke`,{reason:'事实核对后撤销'})).status).toBe(200);expect(f.data.adjustments).toHaveLength(1);expect(f.data.adjustments[0].voidedAt).toBeTruthy();expect(getChannelSummary(f.data.referees[0],'eleven',f.data.matches,f.data.adjustments)!.points).toBe(before);expect(penaltyEligibilityIssues('r1','referee','2028-01-01',f.data.adjustments)).toEqual([]);expect(readableStore(f.data,{publicQueries:true}).adjustments).toHaveLength(0);expect(validateSnapshot(f.data)).toBeTruthy();
 });
 it('历史奖励仍可查询和核算，新入口不允许新增奖励；原有历史处罚兼容',()=>{
  const d=seed();d.adjustments=[{id:'legacy',matchId:'current',refereeId:'r1',channel:'eleven',event:'freshmen-cup',season,date:'2026-10-10',type:'reward',points:2,wage:10,reason:'历史奖励'}];expect(validateSnapshot(d)).toBeTruthy();expect(getSeasonWage(d.referees[0],'eleven',season,d.matches,d.adjustments)!.adjustmentWage).toBe(10);
 });
 it('备份拒绝伪造冻结金额、跨渠道清零、错误资格和撤销审计',async()=>{
  const f=fixture();await f.call('POST','/api/penalties',input('professional'));for(const change of [ (d:DataStore)=>d.adjustments[0].points=-100, (d:DataStore)=>d.adjustments[0].penalty!.deductions.wage=100, (d:DataStore)=>d.adjustments[0].crossChannelPoints={channel:'five',points:-50}, (d:DataStore)=>d.adjustments[0].penalty!.sanctions.qualifications=['fake' as never], (d:DataStore)=>d.adjustments[0].voidedAt='invalid' ]){const d=structuredClone(f.data);change(d);expect(()=>validateSnapshot(d)).toThrow();}
 });
 it('未登录、无关联比赛、无事实或非法原场身份均不能登记',async()=>{
  const f=fixture();expect((await f.call('POST','/api/penalties',input(),false)).status).toBe(401);for(const body of [{...input(),matchId:'none'},{...input(),reason:''},{...input(),refereeId:'r2'}])expect((await f.call('POST','/api/penalties',body)).status).toBe(400);expect(f.writes).toBe(0);
 });
});
