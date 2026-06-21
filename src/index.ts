import {
  acceptUrlPost,
  processPendingArticles as runArticleIngestPendingArticles,
  processTrendingQiita as runArticleIngestTrendingQiita,
  processTrendingZenn as runArticleIngestTrendingZenn,
} from './pipelines/article-ingest';
import { runGmailDigest as runGmailDigestPipeline } from './pipelines/gmail-digest';
import { runLabelCleanup as runGmailLabelCleanupPipeline } from './pipelines/gmail-label-cleanup';

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

/**
 * アーカイブ済みメールの運用ラベル整理をgmail-label-cleanup Pipelineで実行する。
 * GASタイムトリガー（日次）から呼び出される。
 */
export function runGmailLabelCleanup(): void {
  runGmailLabelCleanupPipeline();
}

/**
 * 前日のNewsletterメールをSlackにダイジェスト投稿するgmail-digest Pipelineを実行する。
 * GASタイムトリガー（日次・7時台）から呼び出される。
 * @returns なし
 */
export function runGmailDigest(): void {
  runGmailDigestPipeline();
}
