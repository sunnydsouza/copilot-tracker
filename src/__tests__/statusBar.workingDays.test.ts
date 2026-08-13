import { expect } from 'chai';
import * as vscode from 'vscode';
import { createStatusBarItem, initStatusBarMode, updateStatusBar } from '../statusBar';
import { UsageData } from '../dataService';
import { setDefaultPacingOptions } from '../pacing';

function makeUsageData(): UsageData {
  return {
    totalUsage: 2380,
    limit: 7000,
    remaining: 4620,
    billedTotal: 0,
    models: [],
    dateRange: 'Aug 1, 2026 – Aug 13, 2026',
    dataSource: 'api',
  };
}

describe('statusBar – working-day pacing', () => {
  afterEach(() => {
    vscode.workspace._clearConfig();
    setDefaultPacingOptions({ mode: 'calendar' });
  });

  it('shows actual 34.0% versus target 45.0% for workday 9/20', () => {
    vscode.workspace._clearConfig();
    vscode.workspace._setConfig('copilot-premium-tracker.statusBarMode', 'classic');
    vscode.workspace._setConfig('copilot-premium-tracker.pacingMode', 'custom');
    vscode.workspace._setConfig('copilot-premium-tracker.customWorkingDays', 20);

    const item = createStatusBarItem();
    initStatusBarMode();
    updateStatusBar(item, makeUsageData(), new Date(Date.UTC(2026, 7, 13, 12, 0)));

    expect(item.text).to.include('34.0% / 45.0%');
    expect(item.tooltip).to.include('Workday 9/20');
    expect(item.tooltip).to.include('350.0 requests/workday');
  });
});
