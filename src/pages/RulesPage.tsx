import './RulesPage.css';
import { BookOpen, Download, FileText } from 'lucide-react';
import { PageHeader } from '../components/ui';
import { assetUrl, useData } from '../hooks/useData';
import type { RuleBlock, RuleChapter, RulesData, WageStandards } from '../domain/types';
import { defaultWageStandards } from '../domain/calculations';
import { eventName } from '../domain/competitions';

const wageTables: RulesData['wageTables'] = {
  eleven: {
    caption: '北大杯、新生杯的工资标准',
    headers: ['级别', '裁判员', '助理裁判员', '第四官员'],
    rows: [
      ['A', '125', '70', '45'],
      ['B', '120', '65', '40'],
      ['C', '110', '60', '30'],
      ['D', '100', '55', '25'],
      ['E', '90', '50', '20'],
    ],
  },
  five: {
    caption: '女足北大杯的工资标准',
    headers: ['级别', '第一裁判员与第二裁判员', '第三裁判员'],
    rows: [
      ['A', '60', '30'],
      ['B', '50', '25'],
      ['C', '40', '20'],
    ],
  },
};

const chapters: RuleChapter[] = [
  {
    id: 'chapter-1',
    numeral: '一',
    title: '裁判员的执法资格',
    blocks: [
      { kind: 'subheading', text: '1.总则' },
      { kind: 'paragraph', text: '北京大学裁判部注册的裁判员，有十一人制裁判员、十一人制助理裁判员、五人制裁判员、第四官员四类资格。' },
      { kind: 'subheading', text: '2.资格的获得' },
      { kind: 'paragraph', text: '四类资格分别通过培训并考核获得。对于有国家认证的十一人制裁判，可以视等级直接获得十一人制裁判员或助理裁判员的执法资格。' },
      { kind: 'subheading', text: '3.培训' },
      { kind: 'clause', marker: '1）', text: '裁判培训的时间和内容由裁判部负责。' },
      { kind: 'clause', marker: '2）', text: '十一人制培训分为理论培训和现场培训两部分。原则上，培训由A级裁判，或其他取得国家认证的，且有一定执法经验的裁判进行。' },
      { kind: 'clause', marker: '3）', text: '五人制培训进行理论培训，培训由校内裁判进行。' },
      { kind: 'clause', marker: '4）', text: '第四官员培训进行理论培训，培训由校内裁判进行。内容为第四官员职责中涉及到的规则，以及北大杯、新生杯的具体工作事项和流程。' },
      { kind: 'subheading', text: '4.考核' },
      { kind: 'clause', marker: '1）', text: '十一人制助理裁判员考核分为理论考核与现场执法考核两部分。理论考核的形式为闭卷考试。通过理论考核的裁判员需在作为十一人制助理裁判员所执法的前两场比赛后，各提交一份裁判报告与赛后总结。' },
      { kind: 'clause', marker: '2）', text: '十一人制裁判员需在成为十一人制助理裁判员至少一学期，且作为助理裁判员执法过至少五场比赛后，进行理论考核与现场执法考核。理论考核的形式为闭卷考试。通过理论考核后，在作为十一人制裁判员所执法的前两场比赛后，应各提交一份裁判报告与赛后总结。' },
      { kind: 'clause', marker: '3）', text: '五人制考核分为理论考核与现场执法考核两部分。通过理论考核的裁判员需作为第二裁判员搭档资历较丰富的第一裁判员进行至少2场执法实践后才可以担任第一裁判员。在这两场比赛过后，需各提交一份裁判报告与赛后总结，以此作为评判标准。' },
      { kind: 'clause', marker: '4）', text: '第四官员考核分为理论考核与实践报告两部分。理论考核的形式为开卷考试。通过理论考核的裁判员需在所执法的第一场比赛过后，提交详细的裁判报告与赛后总结，以此作为评判标准。' },
      { kind: 'subheading', text: '5.其他赛制' },
      { kind: 'paragraph', text: '其他赛制的比赛，根据规则，由裁判部确定安排五人制或十一人制的裁判员。' },
    ],
  },
  {
    id: 'chapter-2',
    numeral: '二',
    title: '裁判员的资历',
    blocks: [
      { kind: 'subheading', text: '1.总则' },
      { kind: 'paragraph', text: '十一人制裁判与五人制裁判积分分开计算。' },
      { kind: 'paragraph', text: '十一人制裁判员根据其执法场次，分为 A、B、C、D、E 五档。' },
      { kind: 'paragraph', text: '五人制裁判员根据其执法场次，分为 A、B、C 三档。' },
      { kind: 'subheading', text: '2.积分标准' },
      { kind: 'paragraph', text: '基本积分：每场比赛，主裁判 4 分，助理裁判 2 分，五人制裁判 2 分，第四官员（五人制中的第三裁判员）1 分。' },
      { kind: 'paragraph', text: '所有杯赛，进入淘汰赛阶段后每场积分乘 1.5。' },
      { kind: 'paragraph', text: '十一人制北大杯所有比赛的积分在此基础上乘 1.2。' },
      { kind: 'subheading', text: '3.升级标准' },
      { kind: 'paragraph', text: '所有新裁判积分为 0 分，十一人制级别为 E，五人制级别为 C。' },
      { kind: 'paragraph', text: '有国家认证的裁判员，如有国家一级或以上裁判员资格则直接定为 A 级。其他人员十一人制比赛定为 C 级，五人制比赛定为 B 级。对于其他有过执法经验的裁判员，裁判部认为优秀的，十一人制比赛可以定为 D 级。这些裁判员的初始积分由裁判部评估后确定。这些裁判员所执法的第一场十一人制比赛和五人制比赛均需有高级裁判作为第四官员或第三裁判员给出评估报告后才可确定其等级。' },
      { kind: 'paragraph', text: '对于十一人制比赛，积分满 10 分者可以由 E 升至 D 级，积分满 30 分可以升至 C 级，积分满 80 分可以升至 B 级，积分满 140 分可以升至 A 级。' },
      { kind: 'paragraph', text: '对于五人制比赛，积分满 5 分者可以由 C 升至 B 级，积分满 15 分可以升至 A 级。若裁判员未取得十一人制裁判员资格则十一人制级别最高为 C，积分上限为 80 分。若裁判员未取得五人制裁判员资格则五人制级别最高为 C，积分上限为 5 分。' },
      { kind: 'paragraph', text: '对于表现优异的裁判，如果在上一学期中积极参与裁判工作，且无专业性及以上错误，且其积分达到升级标准的 90%，也可以升级。' },
      { kind: 'paragraph', text: '升级只能在赛事开始前进行。' },
      { kind: 'subheading', text: '4.按参与度扣分与降级' },
      { kind: 'paragraph', text: '在该学期拥有北京大学学籍的裁判为校内裁判。已从北京大学毕业的裁判为校外裁判。为鼓励校内裁判在有条件的情况下积极参与裁判工作，校内裁判一学年未参与裁判工作，将给予一定的扣分。扣除十一人制裁判积分 10 分，五人制裁判积分 5 分 。' },
      { kind: 'paragraph', text: '十一人制中，十一人制裁判最低扣至 30 分，十一人制助理裁判最低扣至 10 分，第四官员最低扣至 0 分。' },
      { kind: 'paragraph', text: '五人制中，五人制裁判最低扣至 5 分，第四官员（五人制中的第三裁判员）最低扣至 0 分。' },
      { kind: 'paragraph', text: '裁判员扣分后执法的第一场比赛，需高级裁判进行考核。' },
      { kind: 'subheading', text: '5.北大杯、新生杯的工资标准' },
      { kind: 'table', table: 'eleven' },
      { kind: 'subheading', text: '6.女足北大杯的工资标准' },
      { kind: 'table', table: 'five' },
    ],
  },
  {
    id: 'chapter-3',
    numeral: '三',
    title: '集体活动',
    blocks: [
      { kind: 'subheading', text: '1.裁判会' },
      { kind: 'clause', marker: '1）', text: '裁判会的内容：赛事的准备、业务的交流、集体学习' },
      { kind: 'clause', marker: '2）', text: '裁判会的时间：约每月一次。在杯赛开始前、进行到关键阶段时，以及裁判业务出现重大问题时，应当开裁判会。' },
      { kind: 'subheading', text: '2.海淀区和西城区裁判培训' },
      { kind: 'clause', marker: '1）', text: '每年区一级足协组织培训新裁判时，裁判部应基于自愿原则以足协名义进行集体报名。' },
      { kind: 'clause', marker: '2）', text: '对于参加区一级培训通过的裁判员，安排比赛任务时可以提高其被选择的优先级。' },
    ],
  },
  {
    id: 'chapter-4',
    numeral: '四',
    title: '裁判员选派的原则',
    blocks: [
      { kind: 'clause', marker: '1.', text: '裁判员的选派本着自愿报名的原则，裁判部对裁判员的选派具有最终决定权。' },
      { kind: 'clause', marker: '2.', text: '当周赛程确定后，裁判部在裁判群中发布赛程表，裁判员可自行选择不回避的场次报名。同一岗位有多名裁判员报名的，由裁判部决定人员选派。' },
      { kind: 'clause', marker: '3.', text: '裁判员报名时，应当综合考虑自身能力水平、时间安排、体能状况，选择适合的比赛进行报名。如果裁判部认为一名裁判员的能力水平不足以胜任其报名的比赛，即使暂无其他裁判员报名，也可以拒绝选派该裁判员。' },
      { kind: 'clause', marker: '4.', text: '对于重要比赛（重要比赛由裁判部定义），裁判部有权跳过自愿报名环节，在北大足协执行委员会的指导下，直接指定全部或部分裁判员。' },
      { kind: 'clause', marker: '5.', text: '裁判员学籍所在的院系的球队、学籍曾经所在的院系的球队、作为运动员效力的球队、作为运动员曾经效力的球队均为裁判员的相关球队。' },
      { kind: 'clause', marker: '6.', text: '男足新生杯和男足北大杯的小组赛阶段，与对阵双方所在小组的球队相关的裁判员应当回避。男足新生杯和男足北大杯的淘汰赛阶段，与对阵双方及下一轮可能与对阵双方比赛的球队相关的裁判员应当回避。女足北大杯的全部阶段，与对阵双方相关的裁判员应当回避。男足新生杯和男足北大杯的分组排位赛，与对阵双方所在排位小组的球队相关的裁判员应当回避；单场排位赛，与对阵双方相关的裁判员应当回避。' },
    ],
  },
  {
    id: 'chapter-5',
    numeral: '五',
    title: '比赛要求',
    blocks: [
      { kind: 'subheading', text: '1.赛前' },
      { kind: 'paragraph', text: '比赛的裁判员安排确定后，（十一人制）裁判员、（五人制）第一裁判员应当联系裁判组成员并保存成员的联系方式。' },
      { kind: 'paragraph', text: '裁判组成员应在比赛开始前，十一人制至少        30 分钟，五人制至少 15 分钟到场，并进行必要的准备。' },
      { kind: 'paragraph', text: '若发生特殊情况，即裁判员人数较少，连场执法比赛，则可以不遵守提前  30 分钟到场的规定，但必须在微信群中做好赛前准备。' },
      { kind: 'paragraph', text: '若为早场比赛或特殊时间比赛，裁判员可以在比赛开始前至少 15 分钟到场，但必须提前在微信群中做好赛前准备，使得比赛可以按时开始。' },
      { kind: 'subheading', text: '2.赛后' },
      { kind: 'paragraph', text: '按照比赛的要求填写比赛结果的报告。裁判组进行必要的总结。' },
      { kind: 'paragraph', text: '若比赛中出现直接红牌，或其他较为严重，可能引起后续纪律处罚与争议的事件，则每位比赛官员都应主动上交裁判报告。' },
    ],
  },
  {
    id: 'chapter-6',
    numeral: '六',
    title: '奖励',
    blocks: [
      { kind: 'subheading', text: '1.北大杯的奖励' },
      { kind: 'paragraph', text: '男足甲级北大杯的赛事（包括升降级附加赛），裁判工资（不包含其他奖励）为原定工资的 1.1 倍。' },
      { kind: 'subheading', text: '2.单场比赛的奖励' },
      { kind: 'clause', marker: '1）', text: '北大杯、新生杯达到半决赛阶段后，主裁判、助理裁判每场奖励 10 元，第四官员每场奖励 5 元。决赛主裁判奖励 20 元，助理裁判奖励 20 元，第四官员奖励 10 元。' },
      { kind: 'clause', marker: '2）', text: '遇到恶劣天气（如雨雪天气、雾霾天气、高温天气等），每人每场奖励10 元。' },
      { kind: 'clause', marker: '3）', text: '若比赛时间为早场（10 点及10点前所开始的比赛）、晚场（20点及20点之后所开始的比赛），或者为非常规时间（如周中时间等），每人每场奖励 10 元。' },
      { kind: 'clause', marker: '4）', text: '若在比赛开始前 2 小时内，原定的裁判因故无法执法比赛，则替代者可获得 10 元奖励。' },
      { kind: 'subheading', text: '3.其他奖励' },
      { kind: 'clause', marker: '1）', text: '参加区一级培训通过的裁判员，当学期北大杯积分达到 30 分，可奖励报名费补助20%。下学期新生杯积分达到 50 分，可再奖励报名费补助 30%。' },
      { kind: 'clause', marker: '2）', text: '通过北大足协或北大校队、院队预约的其他形式的比赛，奖励以组织方为准' },
    ],
  },
  {
    id: 'chapter-7',
    numeral: '七',
    title: '处罚',
    blocks: [
      { kind: 'subheading', text: '1.总则' },
      { kind: 'paragraph', text: '对裁判员处罚应是积极的导向，令其意识到自己的错误并提高执法水平。' },
      { kind: 'paragraph', text: '裁判部对裁判员进行处罚时，应对事实进行充分的认定。处罚的力度应该综合考虑错误的性质、对比赛的影响、对裁判员、赛事、足协形象的影响，认错态度等。' },
      { kind: 'paragraph', text: '在认定裁判员是否具有态度问题时，如考虑到这一问题可能是由于疏忽或不可抗力造成，可以参照因故迟到、早退、缺勤条从轻处罚。但无论如何，裁判员应为自己的行为负责。' },
      { kind: 'paragraph', text: '裁判部在安排裁判工作时，对于近期曾被处罚，尤其是对比赛造成过较大影响的裁判，应降低其被选择的优先级。' },
      { kind: 'paragraph', text: '对于处罚条例中未提到的问题，可以根据上述精神给予适当处罚。' },
      { kind: 'subheading', text: '2.处罚的内容' },
      { kind: 'clause', marker: '1）', text: '内部通报批评；' },
      { kind: 'clause', marker: '2）', text: '扣除本场比赛应得积分；' },
      { kind: 'clause', marker: '3）', text: '扣除本场比赛部分或全部工资；' },
      { kind: 'clause', marker: '4）', text: '扣除裁判员积分；' },
      { kind: 'clause', marker: '5）', text: '停哨；' },
      { kind: 'clause', marker: '6）', text: '取消单项或两项裁判员资格，裁判员积分清零；' },
      { kind: 'clause', marker: '7）', text: '数年内不得申请裁判资格考核；' },
      { kind: 'clause', marker: '8）', text: '通报学校。' },
      { kind: 'subheading', text: '3.过失的定义' },
      { kind: 'clause', marker: '1）', text: '不可避免的失误：根据证据可以证明即便裁判员合理选位、认真观察，亦难以做出准确的判罚的判罚失误。' },
      { kind: 'clause', marker: '2）', text: '专业性失误：根据证据可以证明此情况可以通过裁判员合理选位、认真观察做出准确的判罚，但裁判员由于经验不足、水平所限出现的失误。' },
      { kind: 'clause', marker: '3）', text: '技术性失误：裁判员由于对规则掌握不牢，在比赛中对某一现象已经认定，但应用规则有误出现的失误。' },
      { kind: 'clause', marker: '4）', text: '时间问题：裁判员由于自身原因，没有遵守提前半小时到达比赛场地的规定或者提前离场。' },
      { kind: 'clause', marker: '5）', text: '态度问题：裁判员由于态度问题跑动不积极或不认真执法，例如在执法过程中打手机、聊天、不佩戴手表等等。' },
      { kind: 'clause', marker: '6）', text: '职业道德问题：裁判员由于个人偏好、情感等或由于受贿等原因，在比赛中有意偏袒某一方，或与他人发生语言或肢体冲突。' },
      { kind: 'clause', marker: '7）', text: '其他更为严重的问题。' },
      { kind: 'subheading', text: '4.罚则' },
      { kind: 'clause', marker: '1）', text: '不可避免的失误：不进行处罚，但应该将事件记录。' },
      { kind: 'clause', marker: '2）', text: '专业性失误：扣除本场比赛应得积分，内部通报批评。' },
      { kind: 'clause', marker: '3）', text: '技术性失误：扣除本场比赛应得积分，并根据严重程度扣除本场比赛 20%~50% 的工资，内部通报批评。' },
      { kind: 'clause', marker: '4）', text: '时间问题：' },
      { kind: 'clause', marker: 'a.', text: '未按时开准备会：在比赛开始前15-30分钟到场，且未提前进行赛前准备的，第一次进行警告，如警告后再犯的，扣除本场比赛20%且不少于15元的工资。比赛开始前15分钟以内到场，且未提前进行赛前准备的，扣除本场比赛30%的积分，同时扣除本场比赛比赛40%的，不低于20元的工资，内部通报批评。在比赛前 15 分钟以内到场，虽然提前进行了赛前准备，但不足以使得比赛准时开始的，依照前款的规定处罚。因连场执法导致准备会、比赛推迟等正当原因可以免于处罚。' },
      { kind: 'clause', marker: 'b.', text: '无故迟到：比赛开始后30分钟以内到场，扣除本场比赛应得积分，根据迟到时间扣除本场比赛20%-50%的工资与额外10-30分的裁判积分。比赛开始后30-60分钟以内到场，扣除50%的裁判积分与本场比赛全部工资，停哨两周。比赛开始后60分钟内未到场，视为无故缺勤。' },
      { kind: 'clause', marker: 'c.', text: '无故早退：无故早退，如因个人事务、时间看错等提前吹停比赛，扣除50%的裁判积分与本场比赛全部工资，停哨三周。' },
      { kind: 'clause', marker: 'd.', text: '因故迟到、早退：因不可抗力（天气原因、交通原因、身体原因等）迟到、早退或缺勤，视对比赛的影响和裁判员的态度，比照无故迟到、早退的罚则从轻或减轻处罚。裁判员应上交对相关事件的说明。' },
      { kind: 'clause', marker: '5）', text: '态度问题：' },
      { kind: 'clause', marker: 'a.', text: '无故缺勤：裁判员未经说明，或故意在比赛原定开始时间后60分钟内未到达比赛场地，视为无故缺勤。无故缺勤者，取消单项裁判员资格，裁判员积分清零，一年内不得再次申请考核。' },
      { kind: 'clause', marker: 'b.', text: '不认真填写比赛记录：对比赛的记录出现空缺或者疏漏，不交或不认真填写裁判报告。扣除比赛应得积分。严重者，如明显影响到赛果统计，扣除本场比赛20%的，不低于20元的工资。' },
      { kind: 'clause', marker: 'c.', text: '裁判装备未带齐：比赛开始后，未携带哨子、手表、挑边器、红黄牌等。扣除比赛应得积分，并扣除本场比赛20%的，不低于20元的工资。内部通报批评。' },
      { kind: 'clause', marker: 'd.', text: '未着裁判服：未着裁判服（尤其是着休闲装、牛仔裤等）参与裁判工作，扣除比赛应得积分，并扣除本场比赛20%-50%的工资。内部通报批评。' },
      { kind: 'clause', marker: 'e.', text: '不积极跑动：助理裁判员不跟越位线，主裁判出现多次明显的倦于跑动（如不追反击，球已发展到禁区内裁判员还在中圈附近等），五人制裁判明显未按跑位要求选位，扣除本场比赛应得积分，视比赛影响扣除50%-100%的工资和5-10分的裁判积分，停哨一至二周。' },
      { kind: 'clause', marker: 'f.', text: '不认真执法：在比赛中闲聊、注意力明显不集中，玩手机，打电话等，扣除本场比赛应得积分，视比赛影响扣除50%-100%的工资和5-20分的裁判积分，处以至少一周，不超过三周的停哨。' },
      { kind: 'clause', marker: 'g.', text: '屡犯不改：对已指出过、裁判会议强调过、已处罚过的问题上再次犯错，定义为屡犯不改。除原定的处罚外，还可以扣除最高不超过10分的裁判积分与最多不超过两周的停哨。' },
      { kind: 'clause', marker: 'h.', text: '其他态度问题：其他管理办法中没有涉及的态度问题的具体处罚应参照本管理办法的精神，由裁判部讨论决定具体处罚。' },
      { kind: 'clause', marker: '6）', text: '职业道德问题：根据严重程度，处以取消单项裁判员资格、裁判员积分清零、数年不得申请裁判员资格、通报学校的处罚。其中，与他人发生骂战、肢体冲突者，取消全部裁判员身份，二年内不得再次申请考核。如有受贿或其他破坏比赛公正的行为，一经查实，取消全部裁判员身份，三年内不得再次申请考核。' },
      { kind: 'clause', marker: '7）', text: '其他更为严重的问题：取消全部裁判员身份，三年内不得再次申请考核，并通报学校。' },
    ],
  },
  {
    id: 'chapter-8',
    numeral: '八',
    title: '对外比赛的裁判任务',
    blocks: [
      { kind: 'subheading', text: '1.总则' },
      { kind: 'paragraph', text: '本着提高裁判员执法水平的原则，裁判部鼓励裁判员在优先协会内工作的前提下，参加其他比赛的执法。同时，协会和裁判部也会积极创造条件，为裁判员争取锻炼机会。' },
      { kind: 'subheading', text: '2.申请条例' },
      { kind: 'paragraph', text: '比赛申办方需填写北京大学裁判部所发的《裁判申请表》，交予裁判部备案。' },
      { kind: 'subheading', text: '3.锦标赛' },
      { kind: 'paragraph', text: '经协会同意，裁判部可以承接非足协主办的锦标赛事的裁判任务。裁判部在确定承接裁判任务之前，应和主办方确定以下问题：' },
      { kind: 'clause', marker: '1）', text: '裁判费。原则上，十一人制比赛的裁判费，主裁判不低于每场120元，助理裁判不低于75元；五人制比赛，每名裁判不低于50元。' },
      { kind: 'clause', marker: '2）', text: '赛程。应要求主办方有完整的赛事规程，确定比赛时间。对于比赛时间或参赛队伍不能在赛事开始时确定的，应要求主办方至少提前48小时确定赛程。同时，如果赛程有变更，应要求主办方至少提前24小时通知，否则应按临时变更处理，支付裁判费。' },
      { kind: 'clause', marker: '3）', text: '场地。由主办方提供场地。如果比赛由于场地原因不能进行，应按临时变更赛程处理，支付裁判费。' },
      { kind: 'clause', marker: '4）', text: '人员。应要求主办方比赛时必须有人到场。' },
      { kind: 'clause', marker: '5）', text: '裁判员不足时的解决方案。裁判部在承接赛事前也应仔细考虑裁判员是否足够，不要盲目承接比赛。' },
      { kind: 'paragraph', text: '此外，协会有权收取不超过10%的裁判费作为管理费用，归入协会经费。' },
      { kind: 'subheading', text: '4.单场比赛' },
      { kind: 'paragraph', text: '对于需要裁判的单场比赛，裁判部仅将有意向的裁判介绍给比赛组织者单独联系，不直接负责。' },
      { kind: 'paragraph', text: '如果发生拖欠裁判费等有损裁判员利益的情况，裁判部在核实后，可以本着保护裁判员利益的原则，代表裁判员出面协商，并将事件记录在案，谨慎考虑以后与该组织者的合作。' },
    ],
  },
];

export const defaultRules: RulesData = { chapters, wageTables };

export default function RulesPage() {
  const { data } = useData();
  const rules = data!.rules || defaultRules;
  const wageStandards: WageStandards = { ...defaultWageStandards, ...data!.wageStandards };
  return (
    <div className="page rules-page">
      <PageHeader
        eyebrow="REFEREE HANDBOOK"
        title="裁判部管理办法"
        description="以下为办法全文，完整呈现八个章节、全部条款及工资标准表。"
        actions={<span className="season-pill"><BookOpen size={16} />2026年秋修订</span>}
      />

      <div className="rules-source-bar">
        <div className="rules-source-title">
          <FileText size={22} aria-hidden="true" />
          <div>
            <strong>北京大学学生足球协会裁判部管理办法</strong>
            <span>（2026 年秋 修改）</span>
          </div>
        </div>
        <a className="rules-download" href={assetUrl('裁判部管理办法2026秋.docx')} download>
          <Download size={17} aria-hidden="true" />
          下载原始 Word
        </a>
      </div>

      <nav className="rules-toc" aria-label="办法目录">
        <div className="rules-toc-heading">
          <h2>目录</h2>
          <span>共八章</span>
        </div>
        <ol>
          {rules.chapters.map((chapter) => (
            <li key={chapter.id}>
              <a href={`#${chapter.id}`}>
                <span>{chapter.numeral}</span>
                {chapter.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <article className="rules-document" aria-label="裁判部管理办法全文">
        {rules.chapters.map((chapter) => (
          <section className="rules-chapter" id={chapter.id} key={chapter.id}>
            <header className="rules-chapter-header">
              <span className="rules-chapter-number" aria-hidden="true">{chapter.numeral}</span>
              <h2>{chapter.title}</h2>
            </header>
            <div className="rules-chapter-body">
              {chapter.blocks.map((block, index) => (
                <RuleBlockView block={block} wageStandards={wageStandards} key={`${chapter.id}-${index}`} />
              ))}
            </div>
          </section>
        ))}
      </article>
    </div>
  );
}

function RuleBlockView({ block, wageStandards }: { block: RuleBlock; wageStandards: WageStandards }) {
  if (block.kind === 'subheading') {
    return <h3 className="rules-subheading">{block.text}</h3>;
  }

  if (block.kind === 'paragraph') {
    return <p className="rules-paragraph">{block.text}</p>;
  }

  if (block.kind === 'clause') {
    const nested = /^[a-z]\./.test(block.marker);
    return (
      <div className={`rules-clause${nested ? ' nested' : ''}`}>
        <span className="rules-clause-marker">{block.marker}</span>
        <p>{block.text}</p>
      </div>
    );
  }

  const events = block.table === 'eleven' ? (['freshmen-cup', 'mens-pku-cup'] as const) : (['womens-pku-cup'] as const);
  const levels = block.table === 'eleven' ? (['A', 'B', 'C', 'D', 'E'] as const) : (['A', 'B', 'C'] as const);
  const headers = block.table === 'eleven'
    ? ['级别', '裁判员', '助理裁判员', '第四官员']
    : ['级别', '第一裁判员与第二裁判员', '第三裁判员'];
  return <>{events.map((event) => (
    <div className="rules-table-wrap" key={event}>
      <table className="rules-wage-table">
        <caption>{eventName(event)}的工资标准</caption>
        <thead>
          <tr>{headers.map((header) => <th scope="col" key={header}>{header}</th>)}</tr>
        </thead>
        <tbody>
          {levels.map((level) => {
            const rates = wageStandards[event]?.[level] || defaultWageStandards[event]?.[level] || [];
            return (
              <tr key={`${event}-${level}`}>
                <th scope="row">{level}</th>
                {rates.map((rate, index) => <td key={`${event}-${level}-${index}`}>{rate}</td>)}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  ))}</>;
}
