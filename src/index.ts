import { clearHasPending, getConfig, hasPending, setHasPending } from './config';
import { callGeminiAPI, type GeminiResult } from './gemini';
import { fetchArticleContent } from './jina';
import { log } from './log';
import {
  createPendingRecord,
  DuplicateUrlError,
  incrementRetryCount,
  queryPendingRecord,
  updateRecord,
} from './notion';
import { fetchQiitaTrendUrls, fetchZennTrendUrls } from './trend';
import { createResponse, stripQueryString } from './utils';

const MAX_RETRY_COUNT = 5;

/**
 * iOSショートカットからのPOSTリクエストを受け取り、NotionにURLを仮登録する。
 * @param e GASのDoPostイベントオブジェクト
 * @returns 処理結果を含むJSONレスポンス
 */
export function doPost(e: GoogleAppsScript.Events.DoPost): GoogleAppsScript.Content.TextOutput {
  const { secretToken } = getConfig();

  let body: { token?: string; url?: string };
  try {
    body = JSON.parse(e.postData.contents) as { token?: string; url?: string };
  } catch {
    return createResponse(false, 'Invalid JSON');
  }

  if (body.token !== secretToken) {
    return createResponse(false, 'Unauthorized');
  }

  const url = body.url;
  if (!url) {
    return createResponse(false, 'URL is required');
  }

  try {
    registerPendingUrl(url);
  } catch (err) {
    if (err instanceof DuplicateUrlError) {
      log.error('doPost', 'duplicate', err, { url });
      return createResponse(false, 'This URL has already been registered');
    }
    log.error('doPost', 'notion write failed', err, { url });
    return createResponse(false, `Notion write failed: ${String(err)}`);
  }

  log.info('doPost', 'accepted', { url });

  return createResponse(true, 'accepted');
}

/**
 * QiitaのトレンドフィードからURLを取得してNotionに仮登録する。
 * GASタイムトリガー（日次）から呼び出される。
 */
export function processTrendingQiita(): void {
  let urls: string[];
  try {
    urls = fetchQiitaTrendUrls();
  } catch (err) {
    log.error('processTrendingQiita', 'fetch failed', err);
    return;
  }
  log.info('processTrendingQiita', 'start', { count: urls.length });

  let registered = 0;
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
      }
    }
  }

  log.info('processTrendingQiita', 'done', { registered });
}

/**
 * ZennのトレンドフィードからURLを取得してNotionに仮登録する。
 * GASタイムトリガー（日次）から呼び出される。
 */
export function processTrendingZenn(): void {
  let urls: string[];
  try {
    urls = fetchZennTrendUrls();
  } catch (err) {
    log.error('processTrendingZenn', 'fetch failed', err);
    return;
  }
  log.info('processTrendingZenn', 'start', { count: urls.length });

  let registered = 0;
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
      }
    }
  }

  log.info('processTrendingZenn', 'done', { registered });
}

/**
 * ステータスが「処理待ち」のNotionレコードを1件取得し、Jina・Geminiで処理してNotionを更新する。
 * 10分間隔のGASタイムトリガーから呼び出される。
 * `HAS_PENDING` フラグがない場合はNotion APIを呼び出さずに即座に終了する。
 */
export function processPendingArticles(): void {
  const { geminiModel, geminiApiKey, notionDbId, notionAccessToken } = getConfig();

  if (!hasPending()) return;

  const pending = queryPendingRecord(notionDbId, notionAccessToken);
  if (!pending) {
    clearHasPending();
    return;
  }

  log.info('processPendingArticles', 'start', { pageId: pending.id, url: pending.url });

  let step = 'fetch';
  try {
    const articleText = fetchArticleContent(pending.url);

    step = 'gemini';
    const geminiResult: GeminiResult = callGeminiAPI(articleText, geminiModel, geminiApiKey);

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
    return;
  }

  log.info('processPendingArticles', 'done', { pageId: pending.id });

  const next = queryPendingRecord(notionDbId, notionAccessToken);
  if (!next) {
    clearHasPending();
  }
}

function registerPendingUrl(url: string): void {
  const { notionDbId, notionAccessToken } = getConfig();
  const normalizedUrl = stripQueryString(url);
  createPendingRecord(normalizedUrl, notionDbId, notionAccessToken);
  setHasPending();
}
