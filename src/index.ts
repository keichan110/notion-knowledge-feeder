import { clearHasPending, getConfig, hasPending, setHasPending } from './config';
import { callGeminiAPI, type GeminiResult } from './gemini';
import { fetchArticleContent } from './jina';
import { log } from './log';
import { createPendingRecord, DuplicateUrlError, queryPendingRecord, updateRecord } from './notion';
import { fetchQiitaTrendUrls, fetchZennTrendUrls } from './trend';
import { createResponse, stripQueryString } from './utils';

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
    log.error('doPost', 'notion write failed', err, { url });
    return createResponse(false, `Notion write failed: ${String(err)}`);
  }

  log.info('doPost', 'accepted', { url });

  return createResponse(true, 'accepted');
}

/**
 * QiitaのトレンドフィードからURLを取得してNotionに仮登録する。
 * GASタイムトリガー（週次）から呼び出される。
 */
export function processTrendingQiita(): void {
  const urls = fetchQiitaTrendUrls();
  log.info('processTrendingQiita', 'start', { count: urls.length });

  let registered = 0;
  for (const url of urls) {
    try {
      registerPendingUrl(url);
      registered++;
    } catch (err) {
      log.error('processTrendingQiita', 'register failed', err, { url });
    }
  }

  log.info('processTrendingQiita', 'done', { registered });
}

/**
 * ZennのトレンドフィードからURLを取得してNotionに仮登録する。
 * GASタイムトリガー（週次）から呼び出される。
 */
export function processTrendingZenn(): void {
  const urls = fetchZennTrendUrls();
  log.info('processTrendingZenn', 'start', { count: urls.length });

  let registered = 0;
  for (const url of urls) {
    try {
      registerPendingUrl(url);
      registered++;
    } catch (err) {
      log.error('processTrendingZenn', 'register failed', err, { url });
    }
  }

  log.info('processTrendingZenn', 'done', { registered });
}

/**
 * ステータスが「処理中」のNotionレコードを1件取得し、Jina・Geminiで処理してNotionを更新する。
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
    if (!articleText) throw new Error('Failed to fetch article');

    step = 'gemini';
    const geminiResult: GeminiResult = callGeminiAPI(articleText, geminiModel, geminiApiKey);

    step = 'notion';
    updateRecord(pending.id, geminiResult, '完了', notionAccessToken);
  } catch (err) {
    log.error('processPendingArticles', `failed at ${step}`, err, {
      pageId: pending.id,
      url: pending.url,
    });
    updateRecord(pending.id, null, 'エラー', notionAccessToken);
    return;
  }

  log.info('processPendingArticles', 'done', { pageId: pending.id });

  const next = queryPendingRecord(notionDbId, notionAccessToken);
  if (!next) {
    clearHasPending();
  }
}

/**
 * ZennトレンドフィードからURL一覧を取得してログに出力する。
 * GASエディタから手動実行してURLが正しく取得できるか確認するためのデバッグ用関数。
 */
export function testFetchZennUrls(): void {
  const urls = fetchZennTrendUrls();
  // TODO(dev-log): 本番運用時に削除
  log.info('testFetchZennUrls', 'fetched', { count: urls.length, urls });
}

/**
 * QiitaトレンドフィードからURL一覧を取得してログに出力する。
 * GASエディタから手動実行してURLが正しく取得できるか確認するためのデバッグ用関数。
 */
export function testFetchQiitaUrls(): void {
  const urls = fetchQiitaTrendUrls();
  // TODO(dev-log): 本番運用時に削除
  log.info('testFetchQiitaUrls', 'fetched', { count: urls.length, urls });
}

function registerPendingUrl(url: string): void {
  const { notionDbId, notionAccessToken } = getConfig();
  const normalizedUrl = stripQueryString(url);
  try {
    createPendingRecord(normalizedUrl, notionDbId, notionAccessToken);
  } catch (err) {
    if (err instanceof DuplicateUrlError) {
      log.info('registerPendingUrl', 'skip duplicate', { url: normalizedUrl });
      return;
    }
    throw err;
  }
  setHasPending();
}
