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
} from './scheduler';

const TODAY = '2026-06-24';
const NOW = new Date('2026-06-23T23:00:00.000Z');
const DAILY_GUARD_PREFIX = 'scheduler:dailyAt:lastRunDate:';

let getProperty: ReturnType<typeof vi.fn>;
let setProperty: ReturnType<typeof vi.fn>;

beforeEach(() => {
  getProperty = vi.fn().mockReturnValue(null);
  setProperty = vi.fn();

  vi.mocked(PropertiesService.getScriptProperties).mockReturnValue({
    getProperty,
    getProperties: vi.fn().mockReturnValue({}),
    setProperty,
    deleteProperty: vi.fn(),
    deleteAllProperties: vi.fn(),
    getKeys: vi.fn().mockReturnValue([]),
    setProperties: vi.fn(),
  });
  mockJst('8', TODAY);
});

describe('dueHours', () => {
  it('dailyAt(7) は [7] を返す', () => {
    expect(dueHours(dailyAt(7))).toEqual([7]);
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
  it('dailyAt: hour>=target かつ当日未実行なら run し setProperty で当日日付を記録する', () => {
    mockJst('8', TODAY);
    const run = vi.fn();

    runCadence([job('daily-job', dailyAt(7), run)], { now: NOW });

    expect(run).toHaveBeenCalledTimes(1);
    expect(setProperty).toHaveBeenCalledWith(`${DAILY_GUARD_PREFIX}daily-job`, TODAY);
  });

  it('dailyAt: 当日実行済み（getProperty が today を返す）ならスキップする', () => {
    getProperty.mockReturnValue(TODAY);
    const run = vi.fn();

    runCadence([job('daily-job', dailyAt(7), run)], { now: NOW });

    expect(run).not.toHaveBeenCalled();
    expect(setProperty).not.toHaveBeenCalled();
  });

  it('dailyAt catch-up: now=8時・target=7・未実行で run される', () => {
    mockJst('8', TODAY);
    const run = vi.fn();

    runCadence([job('daily-job', dailyAt(7), run)], { now: NOW });

    expect(run).toHaveBeenCalledTimes(1);
  });

  it('dailyAt: hour<target なら run されない', () => {
    mockJst('6', TODAY);
    const run = vi.fn();

    runCadence([job('daily-job', dailyAt(7), run)], { now: NOW });

    expect(run).not.toHaveBeenCalled();
    expect(setProperty).not.toHaveBeenCalled();
  });

  it('everyHours: hour%n===0 で run され setProperty は呼ばれない', () => {
    mockJst('9', TODAY);
    const run = vi.fn();

    runCadence([job('every-job', everyHours(3), run)], { now: NOW });

    expect(run).toHaveBeenCalledTimes(1);
    expect(setProperty).not.toHaveBeenCalled();
  });

  it('everyHours: hour%n!==0 で run されない', () => {
    mockJst('8', TODAY);
    const run = vi.fn();

    runCadence([job('every-job', everyHours(3), run)], { now: NOW });

    expect(run).not.toHaveBeenCalled();
  });

  it('always: 時刻に関係なく run され setProperty は呼ばれない', () => {
    mockJst('5', TODAY);
    const run = vi.fn();

    runCadence([job('always-job', always(), run)], { now: NOW });

    expect(run).toHaveBeenCalledTimes(1);
    expect(setProperty).not.toHaveBeenCalled();
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

  it('dailyAt 失敗時: 当日ガードが記録されない（setProperty が呼ばれない）', () => {
    const err = new Error('failed');
    const run = vi.fn(() => {
      throw err;
    });

    expect(() =>
      runCadence([job('daily-job', dailyAt(7), run)], { now: NOW, onError: vi.fn() })
    ).toThrow('runCadence failed: daily-job');

    expect(setProperty).not.toHaveBeenCalled();
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

function mockJst(hour: string, today: string): void {
  vi.mocked(Utilities.formatDate).mockImplementation((_date, _tz, fmt) =>
    fmt === 'H' ? hour : today
  );
}

function job(name: string, at: Job['at'], run: () => void): Job {
  return { name, weight: 'light', at, run };
}
