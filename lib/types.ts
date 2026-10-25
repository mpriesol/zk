export type Role = "admin" | "participant";
export type ActivityGroup = "foot" | "exercise" | "other" | "task";
export interface Course {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  timezone: string;
  squirrelLimit: number;
  testMode: boolean;
}
export interface Member {
  id: string;
  courseId: string;
  userId: string | null;
  email?: string;
  nickname: string;
  role: Role;
  active: boolean;
  animations: boolean;
  joinedAt: string;
}
export interface ActivityType {
  id: string;
  name: string;
  group: ActivityGroup;
  hidden: boolean;
  active: boolean;
  challengeId?: string | null;
}
export interface Activity {
  id: string;
  courseId: string;
  memberId: string;
  typeId: string;
  date: string;
  minutes: number | null;
  distance: number | null;
  note: string;
  createdAt: string;
  updatedAt: string;
  group: ActivityGroup;
  typeName: string;
  nickname?: string;
  reactions?: string[];
  comments?: Comment[];
}
export interface Comment {
  id: string;
  activityId: string;
  memberId: string;
  nickname: string;
  body: string;
  createdAt: string;
}
export type Condition =
  | {
      kind: "days";
      count: number;
      groups?: ActivityGroup[];
      minMinutes?: number;
    }
  | {
      kind: "activities";
      count: number;
      groups?: ActivityGroup[];
      minMinutes?: number;
    }
  | { kind: "combination"; conditions: Condition[] }
  | { kind: "manual"; count: number };
export interface Rule {
  id: string;
  key: string;
  name: string;
  description: string;
  gem: string;
  period: "week" | "course";
  version: number;
  effectiveFrom: string;
  condition: Condition;
  active: boolean;
}
export interface Progress {
  current: number;
  target: number;
  complete: boolean;
  explanation: string;
  countedActivityIds: string[];
  missing: string;
  parts?: Progress[];
}
export interface Award {
  id: string;
  memberId: string;
  ruleKey: string;
  periodStart: string;
  periodEnd: string;
  ruleVersion: number;
  name: string;
  gem: string;
  earnedAt: string;
  snapshot: Rule;
}
export interface RuleProgress {
  rule: Rule;
  periodStart: string;
  periodEnd: string;
  progress: Progress;
  award?: Award;
}
export interface Challenge {
  id: string;
  name: string;
  description: string;
  startDate: string;
  endDate: string;
  status: "draft" | "published" | "ended";
  hidden: boolean;
  reward: string;
  condition: Condition;
  typeId: string | null;
  createdAt: string;
  publishedAt: string | null;
  progress?: Progress;
  completed?: boolean;
  manualCompleted?: boolean;
  completion?: { date: string; note: string } | null;
}
export interface Message {
  id: string;
  title: string;
  body: string;
  link: string;
  important: boolean;
  pinned: boolean;
  status: "draft" | "sent";
  audience: "all" | "selected";
  createdAt: string;
  sentAt: string | null;
  readAt?: string | null;
  recipients?: string[];
  push?: boolean;
}
export interface WeekStat {
  week: string;
  activities: number;
  movementDays: number;
  minutes: number | null;
  missingMinutes: number;
  people: number;
}
export interface Summary {
  activities: number;
  movementDays: number;
  minutes: number | null;
  missingMinutes: number;
  people: number;
  byType: { typeId: string; name: string; count: number }[];
  weeks: WeekStat[];
}
export interface AppState {
  course: Course;
  me: Member;
  members: Member[];
  types: ActivityType[];
  activities: Activity[];
  rules: RuleProgress[];
  awards: Award[];
  challenges: Challenge[];
  messages: Message[];
  summary: Summary;
  today: string;
  pushConfigured: boolean;
  vapidPublicKey: string | null;
}
export interface Identity {
  userId: string;
  email: string;
  displayName: string;
  emailVerified?: boolean;
}
