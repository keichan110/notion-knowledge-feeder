import { log } from './log';

const JST_TIME_ZONE = 'Asia/Tokyo';
const LOG_MOD = 'scheduler';

/** 宣言的スケジュールテーブルで使う発火条件。 */
export type Schedule =
  | { kind: 'always' }
  | { kind: 'dailyAt'; hour: number }
  | { kind: 'weeklyAt'; weekday: number; hour: number }
  | { kind: 'everyHours'; n: number };

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
 * 週次の発火条件を作る。
 * @param weekday JSTで発火する曜日（日曜=0〜土曜=6）
 * @param hour JSTで発火する時刻（0〜23）
 * @returns 週次スケジュール
 */
export const weeklyAt = (weekday: number, hour: number): Schedule => ({
  kind: 'weeklyAt',
  weekday,
  hour,
});

/**
 * 常に発火する条件を作る。
 * @returns 常時実行スケジュール
 */
export const always = (): Schedule => ({ kind: 'always' });

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
  if (at.kind === 'always') return hoursOfDay();
  if (at.kind === 'dailyAt') return [at.hour];
  if (at.kind === 'weeklyAt') return [at.hour];
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
  const weekday = currentJstWeekday(now);
  const errors: TriggerFailure[] = [];

  for (const job of jobs) {
    if (!isDue(job, hour, weekday)) continue;

    try {
      runTrigger(job.name, job.run, opts.onError);
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

function isDue(job: Job, hour: number, weekday: number): boolean {
  if (job.at.kind === 'always') return true;
  if (job.at.kind === 'dailyAt') return hour === job.at.hour;
  if (job.at.kind === 'weeklyAt') {
    return weekday === job.at.weekday && hour === job.at.hour;
  }
  return hour % job.at.n === 0;
}

function currentJstHour(now: Date): number {
  return Number(Utilities.formatDate(now, JST_TIME_ZONE, 'H'));
}

function currentJstWeekday(now: Date): number {
  // SimpleDateFormat の 'u' は GAS でのサポートが不確実なため使わない。
  // 確実にサポートされる 'yyyy-MM-dd' でJST日付を得て、JS標準の getUTCDay()（日曜=0）で曜日を取る。
  const jstDate = Utilities.formatDate(now, JST_TIME_ZONE, 'yyyy-MM-dd');
  return new Date(`${jstDate}T00:00:00Z`).getUTCDay();
}

function hoursOfDay(): number[] {
  return Array.from({ length: 24 }, (_, hour) => hour);
}

function defaultOnError(name: string, err: unknown): void {
  log.error(LOG_MOD, `${name} failed`, err);
}
