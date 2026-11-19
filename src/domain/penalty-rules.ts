import type { Qualification, Role } from './types';
export type Range = readonly [number, number];
export interface PenaltyRule {
  code: string; title: string; category: string; clause: string; text: string;
  matchPoints: number; cumulative: number; wage: Range; minimumWage?: number;
  extra: Range; suspension: Range; warning?: boolean; notice?: boolean; schoolNotice?: boolean;
  qualifications?: 'current' | 'all' | 'choose'; years?: number;
  recordOnly?: boolean; custom?: boolean;
}
const fixed = (n: number): Range => [n, n];
const rule = (code: string, title: string, category: string, clause: string, text: string, options: Partial<PenaltyRule> = {}): PenaltyRule => ({ code, title, category, clause, text, matchPoints: 0, cumulative: 0, wage: fixed(0), extra: fixed(0), suspension: fixed(0), ...options });
export const penaltyRules: PenaltyRule[] = [
  rule('unavoidable', '不可避免的失误（仅记录）', '判罚失误', '第七章4.1', '不进行处罚，但应记录事件。', { recordOnly: true }),
  rule('professional', '专业性失误', '判罚失误', '第七章4.2', '扣除本场应得积分，内部通报批评。', { matchPoints: 100, notice: true }),
  rule('technical', '技术性失误', '判罚失误', '第七章4.3', '扣除本场应得积分；按严重程度扣除本场20%–50%的工资，内部通报批评。', { matchPoints: 100, wage: [20, 50], notice: true }),
  rule('preparation-warning', '赛前15–30分钟到场且未准备：首次', '到场与离场', '第七章4.4.a', '第一次给予警告；因连场等正当原因可免罚。', { warning: true }),
  rule('preparation-repeat', '赛前15–30分钟到场且未准备：警告后再犯', '到场与离场', '第七章4.4.a', '扣除本场20%且不少于15元的工资。', { wage: fixed(20), minimumWage: 15 }),
  rule('preparation-late', '赛前不足15分钟，准备不足影响准时开赛', '到场与离场', '第七章4.4.a', '扣除本场30%的积分和40%且不低于20元的工资，内部通报批评。15分钟边界须结合条文认定。', { matchPoints: 30, wage: fixed(40), minimumWage: 20, notice: true }),
  rule('late-under-30', '无故迟到：开赛后30分钟以内到场', '到场与离场', '第七章4.4.b', '扣除本场应得积分、本场20%–50%的工资，另扣10–30分裁判积分；幅度由裁判部确定。', { matchPoints: 100, wage: [20, 50], extra: [10, 30] }),
  rule('late-30-60', '无故迟到：开赛后超过30至60分钟到场', '到场与离场', '第七章4.4.b', '扣除50%的裁判积分和本场全部工资，停哨两周。', { cumulative: 50, wage: fixed(100), suspension: fixed(2) }),
  rule('early-departure', '无故早退／因个人事务提前吹停', '到场与离场', '第七章4.4.c', '扣除50%的裁判积分和本场全部工资，停哨三周。', { cumulative: 50, wage: fixed(100), suspension: fixed(3) }),
  rule('absence', '无故缺勤：开赛后60分钟仍未到场', '到场与离场', '第七章4.5.a', '取消单项裁判资格、裁判积分清零，一年内不得再次申请考核。条款未明示工资处理，请明确填写；积分清零同时取消本场已计积分。', { matchPoints: 100, cumulative: 100, wage: [0, 100], qualifications: 'current', years: 1 }),
  rule('report', '比赛记录／裁判报告缺失或不认真', '履职与态度', '第七章4.5.b', '扣除本场应得积分。', { matchPoints: 100 }),
  rule('report-severe', '比赛记录／报告问题：严重影响赛果统计', '履职与态度', '第七章4.5.b', '扣除本场应得积分和本场20%且不低于20元的工资。', { matchPoints: 100, wage: fixed(20), minimumWage: 20 }),
  rule('equipment', '裁判装备未带齐', '履职与态度', '第七章4.5.c', '扣除本场应得积分和本场20%且不低于20元的工资，内部通报批评。', { matchPoints: 100, wage: fixed(20), minimumWage: 20, notice: true }),
  rule('kit', '未着裁判服', '履职与态度', '第七章4.5.d', '扣除本场应得积分和本场20%–50%的工资，内部通报批评。', { matchPoints: 100, wage: [20, 50], notice: true }),
  rule('movement', '不积极跑动', '履职与态度', '第七章4.5.e', '扣除本场应得积分、本场50%–100%的工资及5–10分裁判积分，停哨一至二周。', { matchPoints: 100, wage: [50, 100], extra: [5, 10], suspension: [1, 2] }),
  rule('inattention', '不认真执法：闲聊／玩手机／注意力不集中', '履职与态度', '第七章4.5.f', '扣除本场应得积分、本场50%–100%的工资及5–20分裁判积分，停哨一至三周。', { matchPoints: 100, wage: [50, 100], extra: [5, 20], suspension: [1, 3] }),
  rule('morality', '职业道德问题：裁判部认定的其他情形', '职业道德', '第七章4.6', '按严重程度取消单项或两项资格、裁判积分清零、数年不得考核，可通报学校。适用资格、年限及工资处理须明确决定。', { matchPoints: 100, cumulative: 100, wage: [0, 100], qualifications: 'choose' }),
  rule('fight', '与他人发生骂战或肢体冲突', '职业道德', '第七章4.6', '取消全部裁判身份，积分清零，二年内不得再次申请考核。工资处理须明确决定。', { matchPoints: 100, cumulative: 100, wage: [0, 100], qualifications: 'all', years: 2 }),
  rule('bribery', '受贿或破坏比赛公正（已查实）', '职业道德', '第七章4.6', '取消全部裁判身份，积分清零，三年内不得再次申请考核。工资处理须明确决定。', { matchPoints: 100, cumulative: 100, wage: [0, 100], qualifications: 'all', years: 3 }),
  rule('severe-other', '其他更为严重的问题', '职业道德', '第七章4.7', '取消全部裁判身份，三年内不得再次申请考核，并通报学校。条款未明示积分和工资数额，须由裁判部明确决定；如选择累计积分清零，将两个赛制赛前积分清零。', { custom: true, wage: [0, 100], qualifications: 'all', years: 3, schoolNotice: true }),
  rule('custom', '其他／裁判部另行决定', '其他处理', '第七章1、4.4.d、4.5.h', '未列明问题或因不可抗力从轻处理，须写明事实、依据与裁判部决定。', { custom: true, wage: [0, 100], extra: [0, 100000], suspension: [0, 52] }),
];
export const qualificationNames: Record<Qualification, string> = { elevenReferee: '十一人制裁判员', elevenAssistant: '十一人制助理裁判员', fiveReferee: '五人制裁判员', fourthOfficial: '第四官员／五人制第三裁判员' };
export const qualifications = Object.keys(qualificationNames) as Qualification[];
export const qualificationForRole = (role: Role): Qualification => role === 'referee' ? 'elevenReferee' : ['assistant1', 'assistant2', 'additionalAssistant1', 'additionalAssistant2'].includes(role) ? 'elevenAssistant' : ['first', 'second'].includes(role) ? 'fiveReferee' : 'fourthOfficial';
