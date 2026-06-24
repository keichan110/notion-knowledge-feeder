import { authenticatePostRequest } from './lib/auth';
import { runCadence } from './lib/scheduler';
import { acceptUrlPost } from './pipelines/article-ingest';
import { HOURLY_SCHEDULE, TEN_MINUTE_SCHEDULE } from './schedule';

/**
 * iOSショートカットからのPOSTリクエストをarticle-ingest Pipelineへ渡す。
 * @param e GASのDoPostイベントオブジェクト
 * @returns 処理結果を含むJSONレスポンス
 */
export function doPost(e: GoogleAppsScript.Events.DoPost): GoogleAppsScript.Content.TextOutput {
  const auth = authenticatePostRequest(e);
  if (!auth.success) return auth.response;

  return acceptUrlPost(auth.body);
}

/**
 * 10分間隔のGASトリガースロットでarticle-ingestのpending処理を実行する。
 * @returns なし
 */
export function triggerEvery10Minutes(): void {
  runCadence(TEN_MINUTE_SCHEDULE);
}

/**
 * 毎時のGASトリガースロットで宣言的スケジュールテーブルを分岐実行する。
 * @returns なし
 */
export function triggerHourly(): void {
  runCadence(HOURLY_SCHEDULE);
}

// triggerEveryMinuteは将来の即時通知レーン用に予約するが、現時点では作らない。
