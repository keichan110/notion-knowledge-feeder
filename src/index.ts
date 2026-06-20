import {
  acceptUrlPost,
  processPendingArticles as runArticleIngestPendingArticles,
  processTrendingQiita as runArticleIngestTrendingQiita,
  processTrendingZenn as runArticleIngestTrendingZenn,
} from './pipelines/article-ingest';

/**
 * iOSショートカットからのPOSTリクエストをarticle-ingest Pipelineへ渡す。
 * @param e GASのDoPostイベントオブジェクト
 * @returns 処理結果を含むJSONレスポンス
 */
export function doPost(e: GoogleAppsScript.Events.DoPost): GoogleAppsScript.Content.TextOutput {
  return acceptUrlPost(e);
}

/**
 * Qiitaのトレンドフィード登録をarticle-ingest Pipelineで実行する。
 * GASタイムトリガー（日次）から呼び出される。
 */
export function processTrendingQiita(): void {
  runArticleIngestTrendingQiita();
}

/**
 * Zennのトレンドフィード登録をarticle-ingest Pipelineで実行する。
 * GASタイムトリガー（日次）から呼び出される。
 */
export function processTrendingZenn(): void {
  runArticleIngestTrendingZenn();
}

/**
 * 処理待ち記事の1件処理をarticle-ingest Pipelineで実行する。
 * 10分間隔のGASタイムトリガーから呼び出される。
 */
export function processPendingArticles(): void {
  runArticleIngestPendingArticles();
}
