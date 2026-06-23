import { runCadence, runTrigger } from './lib/scheduler';
import {
  acceptUrlPost,
  processPendingArticles as runArticleIngestPendingArticles,
} from './pipelines/article-ingest';
import { HOURLY_SCHEDULE } from './schedule';

/**
 * iOSショートカットからのPOSTリクエストをarticle-ingest Pipelineへ渡す。
 * @param e GASのDoPostイベントオブジェクト
 * @returns 処理結果を含むJSONレスポンス
 */
export function doPost(e: GoogleAppsScript.Events.DoPost): GoogleAppsScript.Content.TextOutput {
  return acceptUrlPost(e);
}

/**
 * 10分間隔のGASトリガースロットでarticle-ingestのpending処理を実行する。
 * @returns なし
 */
export function triggerEvery10Minutes(): void {
  // 10分枠は現状pendingのみ常に実行する。20分機構は必要になった時点でこの粒度に追加する。
  runTrigger('article-ingest:pending', () => runArticleIngestPendingArticles());
}

/**
 * 毎時のGASトリガースロットで宣言的スケジュールテーブルを分岐実行する。
 * @returns なし
 */
export function triggerHourly(): void {
  runCadence(HOURLY_SCHEDULE);
}

// triggerEveryMinuteは将来の即時通知レーン用に予約するが、現時点では作らない。
