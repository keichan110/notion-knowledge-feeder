import { clearHasPending, getConfig, hasPending, setHasPending } from './config';
import { callGeminiAPI, type GeminiResult } from './gemini';
import { fetchArticleContent } from './jina';
import { log } from './log';
import { createPendingRecord, queryPendingRecord, updateRecord } from './notion';
import { createResponse } from './utils';

/**
 * iOSショートカットからのPOSTリクエストを受け取り、NotionにURLを仮登録する。
 * @param e GASのDoPostイベントオブジェクト
 * @returns 処理結果を含むJSONレスポンス
 */
export function doPost(e: GoogleAppsScript.Events.DoPost): GoogleAppsScript.Content.TextOutput {
  // TODO(dev-log): 本番運用時に削除
  log.info('doPost', 'called');

  const { secretToken, notionDbId, notionAccessToken } = getConfig();

  // TODO(dev-log): 本番運用時に削除
  log.info('doPost', 'config loaded');

  let body: { token?: string; url?: string };
  try {
    body = JSON.parse(e.postData.contents) as { token?: string; url?: string };
  } catch {
    // TODO(dev-log): 本番運用時に削除
    log.warn('doPost', 'invalid JSON', { contents: e.postData.contents });
    return createResponse(false, 'Invalid JSON');
  }

  // TODO(dev-log): 本番運用時に削除
  log.info('doPost', 'token check', {
    match: body.token === secretToken,
    bodyTokenLength: body.token?.length ?? 0,
    secretTokenLength: secretToken.length,
  });

  if (body.token !== secretToken) {
    return createResponse(false, 'Unauthorized');
  }

  const url = body.url;
  if (!url) {
    // TODO(dev-log): 本番運用時に削除
    log.warn('doPost', 'url missing');
    return createResponse(false, 'URL is required');
  }

  // TODO(dev-log): 本番運用時に削除
  log.info('doPost', 'calling createPendingRecord', { url });

  try {
    createPendingRecord(url, notionDbId, notionAccessToken);
  } catch (err) {
    log.error('doPost', 'notion write failed', err, { url });
    return createResponse(false, `Notion write failed: ${String(err)}`);
  }

  log.info('doPost', 'accepted', { url });
  setHasPending();

  return createResponse(true, 'accepted');
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

    // TODO(dev-log): 本番運用時に削除
    log.info('processPendingArticles', 'jina ok', { chars: articleText.length });

    step = 'gemini';
    const geminiResult: GeminiResult = callGeminiAPI(articleText, geminiModel, geminiApiKey);

    // TODO(dev-log): 本番運用時に削除
    log.info('processPendingArticles', 'gemini ok', {
      title: geminiResult.title,
      confidence: geminiResult.confidence,
    });

    step = 'notion';
    updateRecord(pending.id, geminiResult, '完了', notionAccessToken);

    // TODO(dev-log): 本番運用時に削除
    log.info('processPendingArticles', 'notion updated', { pageId: pending.id });
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
 * フェーズ5-Step1: テストURLをNotionに仮登録し、HAS_PENDINGフラグを立てるデバッグ関数。
 * 実行後、GASスクリプトプロパティの HAS_PENDING が設定されることを確認する。
 */
// biome-ignore lint/correctness/noUnusedVariables: GAS entry point
function testRegisterPending() {
  const { notionDbId, notionAccessToken } = getConfig();
  const testUrl = 'https://zenn.dev/';

  log.info('testRegisterPending', 'start', { url: testUrl });
  let pageId: string;
  try {
    pageId = createPendingRecord(testUrl, notionDbId, notionAccessToken);
  } catch (err) {
    log.error('testRegisterPending', 'createPendingRecord failed', err, { url: testUrl });
    return;
  }

  setHasPending();
  log.info('testRegisterPending', 'done', { pageId });
}

/**
 * フェーズ5-Step2: NotionのPendingレコードを1件取り出し、Jina→Gemini→Notion更新を実行するデバッグ関数。
 * testRegisterPending の実行後に呼び出す。
 */
// biome-ignore lint/correctness/noUnusedVariables: GAS entry point
function testProcessPending() {
  log.info('testProcessPending', 'start');
  processPendingArticles();
  log.info('testProcessPending', 'done');
}

/**
 * doPost の動作をGASエディタから直接確認するデバッグ関数。
 * スクリプトプロパティの SECRET_TOKEN を使って正しいtokenでリクエストをシミュレートする。
 * 実行後、Notionに「処理中」レコードが作成されれば doPost は正常動作している。
 */
// biome-ignore lint/correctness/noUnusedVariables: GAS entry point
function debugDoPost() {
  const secretToken = PropertiesService.getScriptProperties().getProperty('SECRET_TOKEN') ?? '';
  log.info('debugDoPost', 'SECRET_TOKEN loaded', { tokenLength: secretToken.length });

  const fakeEvent = {
    postData: {
      contents: JSON.stringify({ token: secretToken, url: 'https://example.com' }),
    },
  } as unknown as GoogleAppsScript.Events.DoPost;

  const result = doPost(fakeEvent);
  log.info('debugDoPost', 'response', { body: result.getContent() });
}
