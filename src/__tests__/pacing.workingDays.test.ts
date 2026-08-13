import { expect } from 'chai';
import {
  calculatePacing,
  getRecommendedPercentage,
  getWorkingDaysInMonth,
  setDefaultPacingOptions,
} from '../pacing';

describe('pacing – working-day modes', () => {
  afterEach(() => setDefaultPacingOptions({ mode: 'calendar' }));

  it('counts 21 Monday-Friday workdays in August 2026', () => {
    const date = new Date(Date.UTC(2026, 7, 13));
    expect(getWorkingDaysInMonth(date)).to.equal(21);
  });

  it('treats August 13, 2026 as workday 9 of 21 in weekday mode', () => {
    const date = new Date(Date.UTC(2026, 7, 13, 12, 0));
    const result = calculatePacing(2380, 7000, date, undefined, { mode: 'weekdays' });

    expect(result.pacingDay).to.equal(9);
    expect(result.pacingDaysInMonth).to.equal(21);
    expect(result.dayOfMonth).to.equal(9);
    expect(result.daysInMonth).to.equal(21);
    expect(result.targetPercentage).to.be.closeTo(9 / 21, 0.0001);
    expect(result.baseDailyBudget).to.be.closeTo(7000 / 21, 0.0001);
  });

  it('supports the 20-workday / 7000-request example with a 45% target', () => {
    const date = new Date(Date.UTC(2026, 7, 13, 12, 0));
    const result = calculatePacing(2380, 7000, date, undefined, {
      mode: 'custom',
      workingDaysPerMonth: 20,
    });

    expect(result.pacingDay).to.equal(9);
    expect(result.pacingDaysInMonth).to.equal(20);
    expect(result.targetPercentage).to.equal(0.45);
    expect(result.baseDailyBudget).to.equal(350);
    expect(result.daysRemaining).to.equal(12);
  });

  it('pauses the budget on weekends', () => {
    const saturday = new Date(Date.UTC(2026, 7, 15, 12, 0));
    const result = calculatePacing(3000, 7000, saturday, undefined, { mode: 'weekdays' });

    expect(result.isWorkingDay).to.equal(false);
    expect(result.pacingDay).to.equal(10);
    expect(result.remainingToday).to.equal(0);
    expect(result.targetPercentage).to.be.closeTo(10 / 21, 0.0001);
  });

  it('excludes configured leave or holiday dates', () => {
    const date = new Date(Date.UTC(2026, 7, 13, 12, 0));
    const options = { mode: 'weekdays' as const, excludedDates: ['2026-08-10'] };
    const result = calculatePacing(2000, 7000, date, undefined, options);

    expect(result.pacingDay).to.equal(8);
    expect(result.pacingDaysInMonth).to.equal(20);
    expect(result.targetPercentage).to.equal(0.4);
  });

  it('uses configured pacing as the default for dashboard-style callers', () => {
    const date = new Date(Date.UTC(2026, 7, 13, 12, 0));
    setDefaultPacingOptions({ mode: 'custom', workingDaysPerMonth: 20 });

    expect(getRecommendedPercentage(date)).to.equal(0.45);
    expect(calculatePacing(2380, 7000, date).targetPercentage).to.equal(0.45);
  });
});
