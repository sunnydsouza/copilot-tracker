import * as vscode from 'vscode';
import { UsageData } from './dataService';
import { calculatePacing, classifyStatus, generatePacerBar } from './pacing';
import { getPacingOptionsFromConfig } from './pacingConfig';

export function createStatusBarItem(): vscode.StatusBarItem {
  const item = vscode.window.createStatusBarItem(
    'copilotPremiumTracker',
    vscode.StatusBarAlignment.Right,
    100
  );
  item.command = 'copilot-premium-tracker.showDashboard';
  item.name = 'Copilot Premium Tracker';
  return item;
}

let cachedMode: 'pacer' | 'classic' = 'pacer';

export function initStatusBarMode(): void {
  const config = vscode.workspace.getConfiguration('copilot-premium-tracker');
  const mode = config.get<string>('statusBarMode', 'pacer');
  cachedMode = mode === 'classic' ? 'classic' : 'pacer';
}

function getStatusBarMode(): 'pacer' | 'classic' {
  return cachedMode;
}

export function updateStatusBar(item: vscode.StatusBarItem, data: UsageData, now: Date = new Date()): void {
  const { totalUsage, limit, remaining } = data;
  const pacing = calculatePacing(totalUsage, limit, now, remaining, getPacingOptionsFromConfig());
  const status = classifyStatus(pacing);
  const mode = getStatusBarMode();

  if (mode === 'pacer') {
    renderPacerMode(item, data, pacing);
  } else {
    renderClassicMode(item, data, pacing);
  }

  // Color based on status (shared)
  if (status === 'exhausted' || pacing.overageCost > 0) {
    item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
  } else if (status === 'over-budget') {
    item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
  } else {
    item.backgroundColor = undefined;
  }

  const usedPct = ((totalUsage / limit) * 100).toFixed(1);
  const targetPct = (pacing.targetPercentage * 100).toFixed(1);
  const formattedPacingBanked = pacing.banked.toFixed(1);
  const bankedStr = pacing.banked >= 0
    ? `+${formattedPacingBanked} saved`
    : `${formattedPacingBanked} overspent`;
  const sourceLabel = data.dataSource === 'api' ? 'Live from API' : 'Manual data';
  const isCalendar = pacing.pacingMode === 'calendar';
  const pacingUnit = isCalendar ? 'day' : 'workday';
  const remainTodayStr = !pacing.isWorkingDay
    ? 'Non-working day · pacing budget paused'
    : pacing.remainingToday > 0
      ? `~${Math.floor(pacing.remainingToday)} requests left today`
      : `Over today's budget by ~${Math.abs(Math.floor(pacing.endOfTodayQuota - pacing.usedRequests))} requests`;

  const tooltipLines = [
    `Copilot Premium: ${totalUsage} / ${limit} (${usedPct}%)`,
    `Target today: ${targetPct}%`,
    `Base budget: ${pacing.baseDailyBudget.toFixed(1)} requests/${pacingUnit}`,
    `Adjusted allowance: ${pacing.dailyAllowance.toFixed(1)} requests/${pacingUnit}`,
    remainTodayStr,
    ...(data.dailyUsage !== undefined ? [`Today's usage: ${data.dailyUsage}`] : []),
    `${bankedStr} vs expected`,
    `Projected: ~${pacing.projectedEnd.toFixed(1)} by month end`,
    isCalendar
      ? `Day ${pacing.dayOfMonth}/${pacing.daysInMonth} · ${pacing.daysRemaining} days left`
      : `Workday ${pacing.pacingDay}/${pacing.pacingDaysInMonth} · ${pacing.daysRemaining} workdays left`,
    `Source: ${sourceLabel}`,
    `Actual vs target: ${usedPct}% used vs ${targetPct}% target`,
  ];
  if (data.resetAt) {
    const resetLabel = new Date(data.resetAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
    tooltipLines.push(`Quota resets: ${resetLabel}`);
  }
  if (pacing.overageCost > 0) {
    tooltipLines.splice(5, 0, `💰 Overage: ${pacing.overageRequests} requests ($${pacing.overageCost.toFixed(2)})`);
  }
  item.tooltip = tooltipLines.join('\n');

  item.show();
}

function renderPacerMode(
  item: vscode.StatusBarItem,
  data: UsageData,
  pacing: ReturnType<typeof calculatePacing>,
): void {
  const bar = generatePacerBar(pacing);

  if (pacing.overageCost > 0) {
    item.text = `$(copilot) ${bar} $${pacing.overageCost.toFixed(2)} over`;
  } else if (!pacing.isWorkingDay) {
    item.text = `$(copilot) ${bar} pacing paused`;
  } else if (pacing.remainingToday > 0) {
    item.text = `$(copilot) ${bar} ~${Math.floor(pacing.remainingToday)} left today`;
  } else {
    const debt = Math.abs(Math.floor(pacing.endOfTodayQuota - pacing.usedRequests));
    item.text = `$(copilot) ${bar} -${debt} behind`;
  }
}

function renderClassicMode(
  item: vscode.StatusBarItem,
  data: UsageData,
  pacing: ReturnType<typeof calculatePacing>,
): void {
  const { totalUsage, limit } = data;

  const dailyProgress = pacing.baseDailyBudget > 0
    ? Math.min(Math.max(0, (totalUsage - pacing.startOfTodayQuota) / pacing.baseDailyBudget), 1)
    : 0;
  const filledCount = Math.round(dailyProgress * 10);
  const emptyCount = 10 - filledCount;
  const bar = '█'.repeat(filledCount) + '░'.repeat(emptyCount);

  const actualPct = ((totalUsage / limit) * 100).toFixed(1);
  const targetPct = (pacing.targetPercentage * 100).toFixed(1);

  item.text = `$(copilot) [${bar}] ${actualPct}% / ${targetPct}%`;
}
