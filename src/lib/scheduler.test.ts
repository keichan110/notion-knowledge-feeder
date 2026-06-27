import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./log', () => ({
  log: {
    error: vi.fn(),
  },
}));

import { log } from './log';
import {
  always,
  dailyAt,
  dueHours,
  everyHours,
  type Job,
  runCadence,
  runTrigger,
  weeklyAt,
} from './scheduler';

// 2026-06-23T23:00:00Z = JST 2026-06-24 08:00（水曜=weekday 3）
const NOW = new Date('2026-06-23T23:00:00.000Z');
// 日曜=0
const SUNDAY = 0;
const WEDNESDAY = 3;

beforeEach(() => {
  mockJst('8', WEDNESDAY);
});

describe('dueHours', () => {
  it('dailyAt(7) は [7] を返す', () => {
    expect(dueHours(dailyAt(7))).toEqual([7]);
  });

  it('weeklyAt(0, 14) は曜日非依存で [14] を返す', () => {
    expect(dueHours(weeklyAt(SUNDAY, 14))).toEqual([14]);
  });

  it('everyHours(3) は [0,3,6,9,12,15,18,21] を返す', () => {
    expect(dueHours(everyHours(3))).toEqual([0, 3, 6, 9, 12, 15, 18, 21]);
  });

  it('everyHours(1) は 0〜23 の全24時間を返す', () => {
    expect(dueHours(everyHours(1))).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23,
    ]);
  });

  it('always() は 0〜23 の全24時間を返す', () => {
    expect(dueHours(always())).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23,
    ]);
  });
});

describe('runTrigger', () => {
  it('成功時に fn が呼ばれる', () => {
    const fn = vi.fn();

    runTrigger('job', fn);

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('失敗時に onError(name, err) を呼んでから元のエラーをrethrowする', () => {
    const err = new Error('failed');
    const fn = vi.fn(() => {
      throw err;
    });
    const onError = vi.fn();

    expect(() => runTrigger('job', fn, onError)).toThrow(err);

    expect(onError).toHaveBeenCalledWith('job', err);
  });

  it('onError省略時は log.error が呼ばれる', () => {
    const err = new Error('failed');

    expect(() =>
      runTrigger('job', () => {
        throw err;
      })
    ).toThrow(err);

    expect(log.error).toHaveBeenCalledWith('scheduler', 'job failed', err);
  });
});

describe('runCadence', () => {
  it('dailyAt: hour===target なら run される', () => {
    mockJst('7', WEDNESDAY);
    const run = vi.fn();

    runCadence([job('daily-job', dailyAt(7), run)], { now: NOW });

    expect(run).toHaveBeenCalledTimes(1);
  });

  it('dailyAt: hour>target でも run されない（exact-hour・catch-upなし）', () => {
    mockJst('8', WEDNESDAY);
    const run = vi.fn();

    runCadence([job('daily-job', dailyAt(7), run)], { now: NOW });

    expect(run).not.toHaveBeenCalled();
  });

  it('dailyAt: hour<target なら run されない', () => {
    mockJst('6', WEDNESDAY);
    const run = vi.fn();

    runCadence([job('daily-job', dailyAt(7), run)], { now: NOW });

    expect(run).not.toHaveBeenCalled();
  });

  it('dailyAt: ScriptProperties を一切触らない', () => {
    mockJst('7', WEDNESDAY);

    runCadence([job('daily-job', dailyAt(7), vi.fn())], { now: NOW });

    expect(PropertiesService.getScriptProperties).not.toHaveBeenCalled();
  });

  it('weeklyAt: 曜日と時刻が一致したら run される', () => {
    mockJst('14', SUNDAY);
    const run = vi.fn();

    runCadence([job('weekly-job', weeklyAt(SUNDAY, 14), run)], { now: NOW });

    expect(run).toHaveBeenCalledTimes(1);
  });

  it('weeklyAt: 時刻が一致しても曜日が外れたら run されない', () => {
    mockJst('14', WEDNESDAY);
    const run = vi.fn();

    runCadence([job('weekly-job', weeklyAt(SUNDAY, 14), run)], { now: NOW });

    expect(run).not.toHaveBeenCalled();
  });

  it('weeklyAt: 曜日が一致しても時刻が外れたら run されない', () => {
    mockJst('13', SUNDAY);
    const run = vi.fn();

    runCadence([job('weekly-job', weeklyAt(SUNDAY, 14), run)], { now: NOW });

    expect(run).not.toHaveBeenCalled();
  });

  it('weeklyAt: ScriptProperties を一切触らない', () => {
    mockJst('14', SUNDAY);

    runCadence([job('weekly-job', weeklyAt(SUNDAY, 14), vi.fn())], { now: NOW });

    expect(PropertiesService.getScriptProperties).not.toHaveBeenCalled();
  });

  it('everyHours: hour%n===0 で run される', () => {
    mockJst('9', WEDNESDAY);
    const run = vi.fn();

    runCadence([job('every-job', everyHours(3), run)], { now: NOW });

    expect(run).toHaveBeenCalledTimes(1);
  });

  it('everyHours: hour%n!==0 で run されない', () => {
    mockJst('8', WEDNESDAY);
    const run = vi.fn();

    runCadence([job('every-job', everyHours(3), run)], { now: NOW });

    expect(run).not.toHaveBeenCalled();
  });

  it('always: 時刻に関係なく run される', () => {
    mockJst('5', WEDNESDAY);
    const run = vi.fn();

    runCadence([job('always-job', always(), run)], { now: NOW });

    expect(run).toHaveBeenCalledTimes(1);
  });

  it('集約: 一部ジョブが throw しても残りのジョブは実行され最後に AggregateError 相当が throw される', () => {
    const err = new Error('failed');
    const failedRun = vi.fn(() => {
      throw err;
    });
    const nextRun = vi.fn();

    expect(() =>
      runCadence(
        [job('failed-job', everyHours(1), failedRun), job('next-job', everyHours(1), nextRun)],
        { now: NOW, onError: vi.fn() }
      )
    ).toThrow('runCadence failed: failed-job');

    expect(nextRun).toHaveBeenCalledTimes(1);
  });

  it('onError フックが失敗ジョブごとに呼ばれる', () => {
    const firstErr = new Error('first failed');
    const secondErr = new Error('second failed');
    const onError = vi.fn();

    expect(() =>
      runCadence(
        [
          job('first-job', everyHours(1), () => {
            throw firstErr;
          }),
          job('second-job', everyHours(1), () => {
            throw secondErr;
          }),
        ],
        { now: NOW, onError }
      )
    ).toThrow('runCadence failed: first-job, second-job');

    expect(onError).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenNthCalledWith(1, 'first-job', firstErr);
    expect(onError).toHaveBeenNthCalledWith(2, 'second-job', secondErr);
  });
});

function mockJst(hour: string, weekday: number): void {
  // currentJstWeekday は 'yyyy-MM-dd' を getUTCDay() に渡す。2026-06-21 は日曜なので
  // weekday（日曜=0）を足した日付を返せば、getUTCDay() が同じ weekday を返す。
  const day = String(21 + weekday).padStart(2, '0');
  const date = `2026-06-${day}`;
  vi.mocked(Utilities.formatDate).mockImplementation((_date, _tz, fmt) =>
    fmt === 'H' ? hour : date
  );
}

function job(name: string, at: Job['at'], run: () => void): Job {
  return { name, weight: 'light', at, run };
}
