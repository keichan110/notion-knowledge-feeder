import { fetchArticleContent } from '../../capabilities/jina';
import { getGeminiConfig, getNotionConfig } from '../../lib/config';
import { log } from '../../lib/log';
import { createResponse, stripQueryString } from '../../lib/utils';
import { type GeminiResult, summarizeArticle } from './gemini';
import {
  clearPendingArticlesFlag,
  DuplicateUrlError,
  hasPendingArticles,
  incrementRetryCount,
  queryPendingRecord,
  registerPendingRecord,
  updateRecord,
} from './pending';
import { fetchQiitaTrendUrls, fetchZennTrendUrls } from './sources';

const MAX_RETRY_COUNT = 5;

/**
 * 認証済みPOSTボディからURLを受け取り、NotionにURLを仮登録する。
 * @param body 認証済みPOSTリクエストのパース済みボディ
 * @returns 処理結果を含むJSONレスポンス
 */
export function acceptUrlPost(body: Record<string, unknown>): GoogleAppsScript.Content.TextOutput {
  const url = typeof body.url === 'string' ? body.url : undefined;
  if (!url) {
    return createResponse(false, 'URL is required');
  }

  try {
    registerPendingUrl(url);
  } catch (err) {
    if (err instanceof DuplicateUrlError) {
      log.error('acceptUrlPost', 'duplicate', err, { url });
      return createResponse(false, 'This URL has already been registered');
    }
    log.error('acceptUrlPost', 'notion write failed', err, { url });
    return createResponse(false, `Notion write failed: ${String(err)}`);
  }

  log.info('acceptUrlPost', 'accepted', { url });

  return createResponse(true, 'accepted');
}

/**
 * QiitaのトレンドフィードからURLを取得してNotionに仮登録する。
 * フィード取得失敗、または1件以上の登録失敗時は例外を投げ、GAS実行を「失敗」にして異常を検知できるようにする。
 */
export function processTrendingQiita(): void {
  let urls: string[];
  try {
    urls = fetchQiitaTrendUrls();
  } catch (err) {
    log.error('processTrendingQiita', 'fetch failed', err);
    // GAS実行を「失敗」にして異常を検知できるよう再throwする
    throw err;
  }
  log.info('processTrendingQiita', 'start', { count: urls.length });

  let registered = 0;
  let failed = 0;
  for (const url of urls) {
    try {
      registerPendingUrl(url);
      registered++;
    } catch (err) {
      if (err instanceof DuplicateUrlError) {
        // バルク登録では同一URLが既登録である可能性が高いため、重複はエラーではなくwarnとして記録する
        log.warn('processTrendingQiita', 'skip duplicate', { url });
      } else {
        log.error('processTrendingQiita', 'register failed', err, { url });
        failed++;
      }
    }
  }

  log.info('processTrendingQiita', 'done', { registered });

  // 残りのURLは処理しきった上で、1件でも失敗があればGAS実行を「失敗」にする
  if (failed > 0) {
    throw new Error(`processTrendingQiita: failed to register ${failed} URL(s)`);
  }
}

/**
 * ZennのトレンドフィードからURLを取得してNotionに仮登録する。
 * フィード取得失敗、または1件以上の登録失敗時は例外を投げ、GAS実行を「失敗」にして異常を検知できるようにする。
 */
export function processTrendingZenn(): void {
  let urls: string[];
  try {
    urls = fetchZennTrendUrls();
  } catch (err) {
    log.error('processTrendingZenn', 'fetch failed', err);
    // GAS実行を「失敗」にして異常を検知できるよう再throwする
    throw err;
  }
  log.info('processTrendingZenn', 'start', { count: urls.length });

  let registered = 0;
  let failed = 0;
  for (const url of urls) {
    try {
      registerPendingUrl(url);
      registered++;
    } catch (err) {
      if (err instanceof DuplicateUrlError) {
        // バルク登録では同一URLが既登録である可能性が高いため、重複はエラーではなくwarnとして記録する
        log.warn('processTrendingZenn', 'skip duplicate', { url });
      } else {
        log.error('processTrendingZenn', 'register failed', err, { url });
        failed++;
      }
    }
  }

  log.info('processTrendingZenn', 'done', { registered });

  // 残りのURLは処理しきった上で、1件でも失敗があればGAS実行を「失敗」にする
  if (failed > 0) {
    throw new Error(`processTrendingZenn: failed to register ${failed} URL(s)`);
  }
}

/**
 * ステータスが「処理待ち」のNotionレコードを1件取得し、Jina・Geminiで処理してNotionを更新する。
 * `HAS_PENDING` フラグがない場合はNotion APIを呼び出さずに即座に終了する。
 * 処理失敗時はリトライ回数の更新を行った上で例外を投げ、GAS実行を「失敗」にして異常を検知できるようにする。
 */
export function processPendingArticles(): void {
  const { geminiModel, geminiApiKey } = getGeminiConfig();
  const { notionDbId, notionAccessToken } = getNotionConfig();

  if (!hasPendingArticles()) return;

  const pending = queryPendingRecord(notionDbId, notionAccessToken);
  if (!pending) {
    clearPendingArticlesFlag();
    return;
  }

  log.info('processPendingArticles', 'start', { pageId: pending.id, url: pending.url });

  let step = 'fetch';
  try {
    const articleText = fetchArticleContent(pending.url);

    step = 'gemini';
    const geminiResult: GeminiResult = summarizeArticle(articleText, geminiModel, geminiApiKey);

    step = 'notion';
    updateRecord(pending.id, geminiResult, '完了', notionAccessToken);
  } catch (err) {
    log.error('processPendingArticles', `failed at ${step}`, err, {
      pageId: pending.id,
      url: pending.url,
      retryCount: pending.retryCount,
    });
    try {
      if (pending.retryCount + 1 > MAX_RETRY_COUNT) {
        updateRecord(pending.id, null, 'エラー', notionAccessToken);
      } else {
        incrementRetryCount(pending.id, pending.retryCount, notionAccessToken);
      }
    } catch (updateErr) {
      log.error('processPendingArticles', 'failed to update error status', updateErr, {
        pageId: pending.id,
      });
    }
    // リトライ更新まで終えた上で、元のエラーを再throwしてGAS実行を「失敗」にし、異常を検知できるようにする
    throw err;
  }

  log.info('processPendingArticles', 'done', { pageId: pending.id });

  const next = queryPendingRecord(notionDbId, notionAccessToken);
  if (!next) {
    clearPendingArticlesFlag();
  }
}

function registerPendingUrl(url: string): void {
  const { notionDbId, notionAccessToken } = getNotionConfig();
  const normalizedUrl = stripQueryString(url);
  registerPendingRecord(normalizedUrl, notionDbId, notionAccessToken);
}
