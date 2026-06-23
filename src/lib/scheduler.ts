import { log } from './log';

const JST_TIME_ZONE = 'Asia/Tokyo';
const LOG_MOD = 'scheduler';
const DAILY_GUARD_PREFIX = 'scheduler:dailyAt:lastRunDate:';

/** 宣言的スケジュールテーブルで使う発火条件。 */
export type Schedule = { kind: 'dailyAt'; hour: number } | { kind: 'everyHours'; n: number };

/** スケジューラが実行する1ジョブの定義。 */
export type Job = {
  name: string;
  weight: 'heavy' | 'light';
  at: Schedule;
  run: () => void;
};

/** ジョブ失敗時に呼ばれるエラーフック。 */
export type TriggerErrorHook = (name: string, err: unknown) => void;

/** runCadenceの実行時オプション。 */
export type RunCadenceOptions = {
  now?: Date;
  onError?: TriggerErrorHook;
};

/**
 * 日次の発火条件を作る。
 * @param hour JSTで発火可能になる時刻（0〜23）
 * @returns 日次スケジュール
 */
export const dailyAt = (hour: number): Schedule => ({ kind: 'dailyAt', hour });

/**
 * N時間ごとの発火条件を作る。
 * @param n 発火間隔（時間）
 * @returns N時間ごとのスケジュール
 */
export const everyHours = (n: number): Schedule => ({ kind: 'everyHours', n });

/**
 * スケジュールが静的にdueになりうる時刻を返す。
 * @param at 判定対象のスケジュール
 * @returns 0〜23時のうちdueになる時刻
 */
export function dueHours(at: Schedule): number[] {
  if (at.kind === 'dailyAt') return [at.hour];
  return hoursOfDay().filter((hour) => hour % at.n === 0);
}

/**
 * トリガー境界で処理を実行し、失敗をログまたは注入フックへ渡してから再throwする。
 * @param name トリガーまたはジョブ名
 * @param fn 実行する処理
 * @param onError 失敗時の通知フック
 * @returns なし
 */
export function runTrigger(name: string, fn: () => void, onError = defaultOnError): void {
  try {
    fn();
  } catch (err) {
    onError(name, err);
    throw err;
  }
}

/**
 * JSTの現在時刻を見てdueなジョブだけを実行する。
 * @param jobs 宣言的スケジュールテーブル
 * @param opts 現在時刻やエラーフックの差し替え
 * @returns なし
 */
export function runCadence(jobs: readonly Job[], opts: RunCadenceOptions = {}): void {
  const now = opts.now ?? new Date();
  const hour = currentJstHour(now);
  const today = currentJstDate(now);
  const errors: TriggerFailure[] = [];

  for (const job of jobs) {
    if (!isDue(job, hour, today)) continue;

    try {
      runTrigger(job.name, job.run, opts.onError);
      if (job.at.kind === 'dailyAt') {
        markDailyJobDone(job.name, today);
      }
    } catch (err) {
      errors.push({ name: job.name, err });
    }
  }

  if (errors.length > 0) {
    throw new CadenceAggregateError(errors);
  }
}

type TriggerFailure = { name: string; err: unknown };

class CadenceAggregateError extends Error {
  readonly errors: TriggerFailure[];

  constructor(errors: TriggerFailure[]) {
    super(`runCadence failed: ${errors.map(({ name }) => name).join(', ')}`);
    this.name = 'CadenceAggregateError';
    this.errors = errors;
  }
}

function isDue(job: Job, hour: number, today: string): boolean {
  if (job.at.kind === 'dailyAt') {
    return hour >= job.at.hour && lastDailyRunDate(job.name) !== today;
  }
  return hour % job.at.n === 0;
}

function lastDailyRunDate(name: string): string | null {
  return PropertiesService.getScriptProperties().getProperty(dailyGuardKey(name));
}

function markDailyJobDone(name: string, today: string): void {
  PropertiesService.getScriptProperties().setProperty(dailyGuardKey(name), today);
}

function dailyGuardKey(name: string): string {
  return `${DAILY_GUARD_PREFIX}${name}`;
}

function currentJstHour(now: Date): number {
  return Number(Utilities.formatDate(now, JST_TIME_ZONE, 'H'));
}

function currentJstDate(now: Date): string {
  return Utilities.formatDate(now, JST_TIME_ZONE, 'yyyy-MM-dd');
}

function hoursOfDay(): number[] {
  return Array.from({ length: 24 }, (_, hour) => hour);
}

function defaultOnError(name: string, err: unknown): void {
  log.error(LOG_MOD, `${name} failed`, err);
}
