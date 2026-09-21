export type TimeRangeOption = "7d" | "14d" | "30d" | "90d" | "all";

export type MetricMode = "points" | "cards";

export interface AnalyticsCard {
  id: string;
  number: number;
  title: string;
  points?: number | null;
  priority?: string | null;
  owner?: string | null;
  columnId: string;
  createdAt: Date | string;
  completedAt?: Date | string | null;
  dueDate?: Date | string | null;
  activities?: Array<{
    id?: string;
    type: string;
    fromValue?: string | null;
    toValue?: string | null;
    createdAt: Date | string;
  }>;
}

export interface AnalyticsColumn {
  id: string;
  name: string;
  order: number;
  isDone?: boolean;
  cards?: AnalyticsCard[];
}

export interface AnalyticsProject {
  id: string;
  name: string;
  columns: AnalyticsColumn[];
}

export interface VelocityInterval {
  date: string;
  label: string;
  completedPoints: number;
  completedCards: number;
}

export interface BurndownPoint {
  date: string;
  label: string;
  idealRemaining: number;
  actualRemaining: number;
}

export interface CycleTimeRecord {
  cardId: string;
  cardNumber: number;
  title: string;
  leadTimeDays: number;
  cycleTimeDays: number;
  completedAt: string;
}

export interface CycleTimeSummary {
  avgLeadTimeDays: number;
  avgCycleTimeDays: number;
  medianCycleTimeDays: number;
  completedCount: number;
  records: CycleTimeRecord[];
}

export interface CumulativeFlowPoint {
  date: string;
  label: string;
  [columnName: string]: string | number;
}

export interface AnalyticsKpis {
  totalPoints: number;
  completedPoints: number;
  inProgressPoints: number;
  totalCards: number;
  completedCards: number;
  weeklyVelocity: number;
  avgCycleTimeDays: number;
  completionRate: number;
}
