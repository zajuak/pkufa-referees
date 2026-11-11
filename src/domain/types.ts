export type Channel = 'eleven' | 'five';
export type CompetitionEvent = 'freshmen-cup' | 'mens-pku-cup' | 'womens-pku-cup';
export type Level = 'A' | 'B' | 'C' | 'D' | 'E';
export type MatchStatus = 'scheduled' | 'completed' | 'cancelled';
export type Stage = 'group' | 'placement' | 'knockout' | 'semifinal' | 'final' | 'third';
export type Role = 'referee' | 'assistant1' | 'assistant2' | 'additionalAssistant1' | 'additionalAssistant2' | 'fourth' | 'first' | 'second' | 'third';
export type Bonus = 'early' | 'late' | 'weekday' | 'badWeather';

export interface HistoricalStats {
  pointsEarned: number;
  roleCounts: Record<string, number>;
  bonusWage: number;
  deductedWage: number;
  bonusPoints: number;
  deductedPoints: number;
}

export interface ChannelStats {
  basePoints: number;
  baseLevel: Level;
  levelOverride?: Level;
  previousWage: number;
  historical: HistoricalStats;
  source?: { file: string; row: number };
}

export interface Referee {
  id: string;
  name: string;
  channels: Partial<Record<Channel, ChannelStats>>;
  avoidanceColleges?: string[];
}

export interface Official {
  role: Role;
  refereeId: string | null;
  name: string;
  substitute?: boolean;
}

export type MatchTeamSource =
  | { kind: 'match'; matchId: string; outcome: 'winner' | 'loser' }
  | { kind: 'group'; group: string; rank: number };

export interface Match {
  id: string;
  season?: string;
  week: number;
  channel: Channel;
  event?: CompetitionEvent;
  competition: string;
  date: string;
  time: string;
  venue: string;
  group: string;
  home: string;
  away: string;
  result?: { home: number; away: number; homePenalties?: number; awayPenalties?: number };
  placementMode?: 'grouped' | 'single';
  homeSource?: MatchTeamSource;
  awaySource?: MatchTeamSource;
  homeColor?: string;
  awayColor?: string;
  stage: Stage;
  division: '甲' | '乙' | null;
  status: MatchStatus;
  note: string;
  bonuses: Bonus[];
  officials: Official[];
  additionalAssistants?: boolean;
  /** Absent means automatic; supplement adds colleges, replace specifies the full list. */
  avoidanceOverride?: { mode: 'supplement' | 'replace'; colleges: string[] };
  /** Read-only summary provided to public schedule clients. */
  avoidanceSummary?: { colleges: string[]; complete: boolean };
}

export interface Adjustment {
  id: string;
  refereeId: string;
  channel: Channel;
  season: string;
  event?: CompetitionEvent;
  date: string;
  type: 'reward' | 'penalty';
  points: number;
  wage: number;
  reason: string;
}

export type RuleBlock =
  | { kind: 'subheading'; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'clause'; marker: string; text: string }
  | { kind: 'table'; table: 'eleven' | 'five' };

export interface RuleChapter {
  id: string;
  numeral: string;
  title: string;
  blocks: RuleBlock[];
}

export interface RuleWageTable {
  caption: string;
  headers: string[];
  rows: string[][];
}

export interface RulesData {
  chapters: RuleChapter[];
  wageTables: Record<'eleven' | 'five', RuleWageTable>;
}

export type WageStandards = Partial<Record<CompetitionEvent, Partial<Record<Level, number[]>>>>;

export interface Unavailability {
  id: string;
  refereeId: string;
  start: string;
  end: string;
  reason: string;
}

export interface Team {
  event: CompetitionEvent;
  name: string;
  color: string;
  colleges?: string[];
}

export interface GroupOrder {
  event: CompetitionEvent;
  season: string;
  group: string;
  teams: string[];
}

export interface DataStore {
  teams?: Team[];
  colleges?: string[];
  groupOrders?: GroupOrder[];
  access?: { role: 'public' | 'referee' | 'admin'; refereeId?: string };
  revision?: number;
  updatedAt?: string;
  unavailability?: Unavailability[];
  version: number;
  meta: {
    association: string;
    season: string;
    rulesVersion: string;
    importedAt: string;
    sourceFiles: string[];
    counts: { elevenMatches: number; fiveMatches: number; cancelledMatches: number };
  };
  referees: Referee[];
  matches: Match[];
  adjustments: Adjustment[];
  rules?: RulesData;
  wageStandards?: WageStandards;
}

export interface OfficialCalculation {
  points: number;
  baseWage: number;
  bonusWage: number;
  wage: number;
}
