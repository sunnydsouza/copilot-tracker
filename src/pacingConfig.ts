import * as vscode from 'vscode';
import { PacingMode, PacingOptions, setDefaultPacingOptions } from './pacing';

export function getPacingOptionsFromConfig(): PacingOptions {
  const config = vscode.workspace.getConfiguration('copilot-premium-tracker');
  const rawMode = config.get<string>('pacingMode', 'calendar');
  const mode: PacingMode = rawMode === 'weekdays' || rawMode === 'custom' ? rawMode : 'calendar';
  const workingDaysPerMonth = config.get<number>('customWorkingDays', 20);
  const excludedDates = config.get<string[]>('excludedDates', []);

  const options: PacingOptions = {
    mode,
    workingDaysPerMonth: mode === 'custom' ? workingDaysPerMonth : undefined,
    excludedDates,
  };

  // Status-bar rendering happens before/alongside dashboard rendering and keeps
  // the shared pacing engine aligned with the current VS Code configuration.
  setDefaultPacingOptions(options);
  return options;
}
