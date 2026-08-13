export interface PacingResult {
  usedRequests: number;
  monthlyLimit: number;
  remaining: number;
  dayOfMonth: number;
  daysInMonth: number;
  daysRemaining: number;
  baseDailyBudget: number;
  dailyAllowance: number;
  avgDailyUsage: number;
  expectedByNow: number;
  banked: number;
  multiplier: number;
  projectedEnd: number;
  timeOfDayProgress: number;
  overageRequests: number;
  overageCost: number;
  startOfTodayQuota: number;
  endOfTodayQuota: number;
  remainingToday: number;
  pacingMode: PacingMode;
  pacingDay: number;
  pacingDaysInMonth: number;
  targetPercentage: number;
  isWorkingDay: boolean;
}

export type UsageStatus = 'on-track' | 'over-budget' | 'ahead' | 'exhausted';
export type PacingMode = 'calendar' | 'weekdays' | 'custom';

export interface PacingOptions {
  /** Calendar days (legacy), Mon-Fri weekdays, or a custom number of Mon-Fri workdays. */
  mode?: PacingMode;
  /** Intended number of workdays in the month. Used only in custom mode. */
  workingDaysPerMonth?: number;
  /** ISO dates (YYYY-MM-DD) that should not count as workdays. */
  excludedDates?: string[];
}

interface PacingSchedule {
  mode: PacingMode;
  totalDays: number;
  elapsedBeforeToday: number;
  currentDay: number;
  remainingDays: number;
  isWorkingDay: boolean;
}

let defaultPacingOptions: PacingOptions = {};

/** Sets the schedule used by callers that do not pass explicit pacing options. */
export function setDefaultPacingOptions(options: PacingOptions): void {
  defaultPacingOptions = {
    ...options,
    excludedDates: [...(options.excludedDates ?? [])],
  };
}

// Per-request overage price for Copilot premium requests, in USD. GitHub has
// adjusted Copilot pricing in the past; if this changes, update here (and
// consider surfacing as a user setting). See CODE_REVIEW L3.
export const COST_PER_PREMIUM_REQUEST = 0.04;

export function getDaysInMonth(date: Date = new Date()): number {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
}

function toIsoDate(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizeExcludedDates(values: string[] | undefined): Set<string> {
  const valid = (values ?? []).filter(v => /^\d{4}-\d{2}-\d{2}$/.test(v));
  return new Set(valid);
}

function isWeekday(date: Date): boolean {
  const day = date.getUTCDay();
  return day >= 1 && day <= 5;
}

function isConfiguredWorkingDay(date: Date, excludedDates: Set<string>): boolean {
  return isWeekday(date) && !excludedDates.has(toIsoDate(date));
}

/** Returns the Mon-Fri workdays in a month, optionally excluding ISO dates. */
export function getWorkingDaysInMonth(date: Date = new Date(), excludedDates: string[] = []): number {
  const excluded = normalizeExcludedDates(excludedDates);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const days = getDaysInMonth(date);
  let count = 0;

  for (let day = 1; day <= days; day++) {
    if (isConfiguredWorkingDay(new Date(Date.UTC(year, month, day)), excluded)) {
      count++;
    }
  }
  return count;
}

function getPacingSchedule(now: Date, options: PacingOptions): PacingSchedule {
  const mode: PacingMode = options.mode ?? 'calendar';
  const calendarDays = getDaysInMonth(now);
  const calendarDay = now.getUTCDate();

  if (mode === 'calendar') {
    return {
      mode,
      totalDays: calendarDays,
      elapsedBeforeToday: calendarDay - 1,
      currentDay: calendarDay,
      remainingDays: Math.max(1, calendarDays - calendarDay + 1),
      isWorkingDay: true,
    };
  }

  const excluded = normalizeExcludedDates(options.excludedDates);
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  let elapsedBeforeToday = 0;

  for (let day = 1; day < calendarDay; day++) {
    if (isConfiguredWorkingDay(new Date(Date.UTC(year, month, day)), excluded)) {
      elapsedBeforeToday++;
    }
  }

  const isWorkingDay = isConfiguredWorkingDay(now, excluded);
  const naturalWorkingDays = getWorkingDaysInMonth(now, options.excludedDates);
  const configuredTotal = mode === 'custom'
    ? Math.floor(options.workingDaysPerMonth ?? naturalWorkingDays)
    : naturalWorkingDays;
  const totalDays = Math.max(1, Math.min(31, configuredTotal));
  const currentDay = Math.min(totalDays, elapsedBeforeToday + (isWorkingDay ? 1 : 0));
  const elapsedForRemaining = Math.min(totalDays, elapsedBeforeToday);

  return {
    mode,
    totalDays,
    elapsedBeforeToday,
    currentDay,
    remainingDays: Math.max(1, totalDays - elapsedForRemaining),
    isWorkingDay,
  };
}

/**
 * Enhanced pacing calculation inspired by copilot_tracer_extension.
 *
 * By default this preserves the original calendar-day pacing. Pass
 * `{ mode: 'weekdays' }` to pace across Mon-Fri, or `{ mode: 'custom',
 * workingDaysPerMonth: 20 }` to divide the quota across a user-selected number
 * of workdays. Weekends and excluded dates pause the daily budget.
 *
 * All date operations use UTC methods to ensure consistent pacing regardless
 * of the user's local timezone.
 */
export function calculatePacing(
  usedRequests: number,
  monthlyLimit: number,
  now: Date = new Date(),
  remainingTotal?: number,
  options: PacingOptions = defaultPacingOptions,
): PacingResult {
  const schedule = getPacingSchedule(now, options);
  const daysRemaining = schedule.remainingDays;

  const baseDailyBudget = monthlyLimit / schedule.totalDays;
  const remaining = remainingTotal !== undefined
    ? remainingTotal
    : Math.max(0, monthlyLimit - usedRequests);
  const dailyAllowance = Math.max(0, remaining) / daysRemaining;

  // Time-of-day progress (0.0 at midnight UTC, ~1.0 at end of day)
  const timeOfDayProgress = (now.getUTCHours() * 60 + now.getUTCMinutes()) / (24 * 60);

  // Working-day modes pause pacing on weekends/excluded dates. Calendar mode
  // remains identical to the original behavior.
  const effectiveDaysElapsed = Math.max(
    schedule.isWorkingDay ? timeOfDayProgress : 0,
    schedule.elapsedBeforeToday + (schedule.isWorkingDay ? timeOfDayProgress : 0),
  );
  const avgDailyUsage = effectiveDaysElapsed > 0 ? usedRequests / effectiveDaysElapsed : 0;

  // Expected usage by now (smooth intra-day on active pacing days).
  const expectedByNow = effectiveDaysElapsed * baseDailyBudget;
  const banked = expectedByNow - usedRequests; // positive = saved, negative = overspent

  const multiplier = baseDailyBudget > 0 ? dailyAllowance / baseDailyBudget : 1;
  const projectedEnd = effectiveDaysElapsed > 0.05
    ? (usedRequests / effectiveDaysElapsed) * schedule.totalDays
    : 0;

  const overageRequests = Math.max(0, usedRequests - monthlyLimit);
  const overageCost = overageRequests * COST_PER_PREMIUM_REQUEST;

  const cappedElapsedBefore = Math.min(schedule.totalDays, schedule.elapsedBeforeToday);
  const startOfTodayQuota = cappedElapsedBefore * baseDailyBudget;
  const endOfTodayQuota = schedule.isWorkingDay
    ? Math.min(monthlyLimit, (cappedElapsedBefore + 1) * baseDailyBudget)
    : startOfTodayQuota;
  const remainingToday = schedule.isWorkingDay
    ? Math.max(0, endOfTodayQuota - usedRequests)
    : 0;
  const targetPercentage = Math.min(1, schedule.currentDay / schedule.totalDays);

  return {
    usedRequests,
    monthlyLimit,
    remaining,
    // These legacy fields intentionally represent the active pacing schedule.
    // In calendar mode their values are unchanged; working-day modes therefore
    // flow through the existing dashboard without duplicating UI logic.
    dayOfMonth: schedule.currentDay,
    daysInMonth: schedule.totalDays,
    daysRemaining,
    baseDailyBudget,
    dailyAllowance,
    avgDailyUsage,
    expectedByNow,
    banked,
    multiplier,
    projectedEnd,
    timeOfDayProgress,
    overageRequests,
    overageCost,
    startOfTodayQuota,
    endOfTodayQuota,
    remainingToday,
    pacingMode: schedule.mode,
    pacingDay: schedule.currentDay,
    pacingDaysInMonth: schedule.totalDays,
    targetPercentage,
    isWorkingDay: schedule.isWorkingDay,
  };
}

/** Returns the ratio of used requests to the monthly limit (0–1+). */
export function getPacingProgress(usedRequests: number, limit: number): number {
  return limit > 0 ? usedRequests / limit : 0;
}

/** Returns the end-of-current-pacing-day target fraction (0–1). */
export function getRecommendedPercentage(now: Date = new Date(), options: PacingOptions = defaultPacingOptions): number {
  const schedule = getPacingSchedule(now, options);
  return Math.min(1, schedule.currentDay / schedule.totalDays);
}

/** Classify budget health based on daily pacing. */
export function classifyStatus(result: PacingResult): UsageStatus {
  const { remaining, banked, baseDailyBudget } = result;
  if (remaining <= 0) { return 'exhausted'; }
  if (banked < 0) { return 'over-budget'; }
  if (banked > baseDailyBudget) { return 'ahead'; }
  return 'on-track';
}

/**
 * Generates a ░█ pacer bar with a │ target-position marker.
 *
 * Layout: `████│░░░░░░░` — █ = used portion, ░ = remaining, │ = target marker
 */
export function generatePacerBar(pacing: PacingResult, width: number = 12): string {
  const { usedRequests, monthlyLimit, targetPercentage } = pacing;

  const usedRatio = Math.min(usedRequests / Math.max(1, monthlyLimit), 1);
  const usedChars = Math.round(usedRatio * width);
  const todayPos = Math.min(width - 1, Math.round(targetPercentage * (width - 1)));

  let bar = '';
  for (let i = 0; i < width; i++) {
    if (i === todayPos) {
      bar += '│';
    } else if (i < usedChars) {
      bar += '█';
    } else {
      bar += '░';
    }
  }

  return bar;
}
