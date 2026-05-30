import { clearHasPending, getConfig, hasPending, setHasPending } from './config';
import { callGeminiAPI, type GeminiResult } from './gemini';
import { fetchArticleContent } from './jina';
import { createPendingRecord, queryPendingRecord, updateRecord } from './notion';
import { createResponse } from './utils';

export function doPost(e: GoogleAppsScript.Events.DoPost): GoogleAppsScript.Content.TextOutput {
  const { secretToken, notionDbId, notionAccessToken } = getConfig();

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
    createPendingRecord(url, notionDbId, notionAccessToken);
  } catch (err) {
    return createResponse(false, `Notion write failed: ${String(err)}`);
  }

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

  try {
    const articleText = fetchArticleContent(pending.url);
    if (!articleText) throw new Error('Failed to fetch article');

    const geminiResult: GeminiResult = callGeminiAPI(articleText, geminiModel, geminiApiKey);
    updateRecord(pending.id, geminiResult, '完了', notionAccessToken);
  } catch {
    updateRecord(pending.id, null, 'エラー', notionAccessToken);
    return;
  }

  const next = queryPendingRecord(notionDbId, notionAccessToken);
  if (!next) {
    clearHasPending();
  }
}

// フェーズ1: Gemini API単体テスト
// biome-ignore lint/correctness/noUnusedVariables: GAS entry point
function testGeminiAPI() {
  const { geminiModel, geminiApiKey } = getConfig();
  const sampleText = `TypeScriptはMicrosoftが開発・メンテナンスするJavaScriptのスーパーセットです。
静的型付けによってコンパイル時にバグを検出でき、大規模アプリケーション開発における保守性を高めます。
型推論、ジェネリクス、インターフェースなどの機能を備え、2023年時点でReactやNext.jsなど主要フレームワークで標準採用されています。
VSCodeとの統合により補完や型チェックがリアルタイムに機能し、開発体験が大きく向上します。`;

  Logger.log('=== Gemini API テスト開始 ===');
  let result: GeminiResult;
  try {
    result = callGeminiAPI(sampleText, geminiModel, geminiApiKey);
  } catch (err) {
    Logger.log(`ERROR: ${String(err)}`);
    return;
  }

  Logger.log(JSON.stringify(result, null, 2));
  Logger.log(`--- 検証 ---`);
  Logger.log(`title: ${result.title}`);
  Logger.log(`tldr length: ${result.tldr?.length ?? 0} (期待: ≤60文字)`);
  Logger.log(`summary length: ${result.summary?.length ?? 0} (期待: 200〜300文字)`);
  Logger.log(`category: ${result.category}`);
  Logger.log(`tags: ${result.tags?.join(', ')}`);
  Logger.log(`confidence: ${result.confidence}`);
  Logger.log('=== テスト完了 ===');
}

// フェーズ2: Jina単体テスト
// biome-ignore lint/correctness/noUnusedVariables: GAS entry point
function testJinaFetch() {
  const testUrl = 'https://zenn.dev/';

  Logger.log('=== Jina フェッチテスト開始 ===');
  const text = fetchArticleContent(testUrl);
  if (!text) {
    Logger.log('ERROR: フェッチ失敗（空文字が返った）');
    return;
  }
  Logger.log(`取得文字数: ${text.length}`);
  Logger.log(`先頭200文字: ${text.substring(0, 200)}`);
  Logger.log('=== テスト完了 ===');
}

// フェーズ3: Gemini結果固定値 → Notion書き込みテスト
// biome-ignore lint/correctness/noUnusedVariables: GAS entry point
function testGeminiToNotion() {
  const { notionDbId, notionAccessToken } = getConfig();
  const fixedResult = {
    title: '[テスト] TypeScript入門',
    tldr: ['TypeScriptはJSに型安全性を加えた言語。', '大規模開発での保守性向上が主な利点。'],
    summary: [
      { heading: '背景', body: 'TypeScriptはMicrosoftが開発するJavaScriptのスーパーセット。' },
      {
        heading: '内容',
        body: '静的型付けにより実行前にバグを検出できる。型推論・ジェネリクス・インターフェースを備える。',
      },
      {
        heading: 'まとめ',
        body: 'ReactやNext.jsなど主要フレームワークで標準採用。VSCodeとの親和性も高く開発体験が向上する。',
      },
    ],
    category: '開発',
    tags: ['TypeScript', 'JavaScript', 'Microsoft', 'React', 'Next.js'],
    confidence: 'high' as const,
  };
  const testUrl = 'https://www.typescriptlang.org/';

  Logger.log('=== Notion 書き込みテスト開始 ===');
  try {
    const pageId = createPendingRecord(testUrl, notionDbId, notionAccessToken);
    updateRecord(pageId, fixedResult, '完了', notionAccessToken);
    Logger.log('Notion書き込み成功');
  } catch (err) {
    Logger.log(`ERROR: ${String(err)}`);
    return;
  }
  Logger.log('=== テスト完了 ===');
}

// フェーズ4: 全体統合テスト（Jina → Gemini → Notion）
// biome-ignore lint/correctness/noUnusedVariables: GAS entry point
function testRun() {
  const { geminiModel, geminiApiKey, notionDbId, notionAccessToken } = getConfig();
  const testUrl = 'https://zenn.dev/';

  Logger.log('=== 統合テスト開始 ===');
  const articleText = fetchArticleContent(testUrl);
  if (!articleText) {
    Logger.log('ERROR: Jinaフェッチ失敗');
    return;
  }
  Logger.log(`Fetched: ${articleText.substring(0, 200)}`);

  let result: GeminiResult;
  try {
    result = callGeminiAPI(articleText, geminiModel, geminiApiKey);
  } catch (err) {
    Logger.log(`ERROR: Gemini失敗 - ${String(err)}`);
    return;
  }
  Logger.log(JSON.stringify(result));

  try {
    const pageId = createPendingRecord(testUrl, notionDbId, notionAccessToken);
    updateRecord(pageId, result, '完了', notionAccessToken);
  } catch (err) {
    Logger.log(`ERROR: Notion書き込み失敗 - ${String(err)}`);
    return;
  }
  Logger.log('=== 統合テスト完了 ===');
}

// フェーズ5: 非同期フロー統合テスト（仮登録 → Jina → Gemini → Notion更新）
// biome-ignore lint/correctness/noUnusedVariables: GAS entry point
function testRunAsync() {
  const { geminiModel, geminiApiKey, notionDbId, notionAccessToken } = getConfig();
  const testUrl = 'https://zenn.dev/';

  Logger.log('=== 統合テスト開始（非同期フロー） ===');
  Logger.log('Step1: 仮登録...');
  let pageId: string;
  try {
    pageId = createPendingRecord(testUrl, notionDbId, notionAccessToken);
    Logger.log(`仮登録完了: ${pageId}`);
  } catch (err) {
    Logger.log(`ERROR: 仮登録失敗 - ${String(err)}`);
    return;
  }

  Logger.log('Step2: Jina取得...');
  const articleText = fetchArticleContent(testUrl);
  if (!articleText) {
    Logger.log('ERROR: Jinaフェッチ失敗');
    updateRecord(pageId, null, 'エラー', notionAccessToken);
    return;
  }
  Logger.log(`取得文字数: ${articleText.length}`);

  Logger.log('Step3: Gemini要約...');
  let result: GeminiResult;
  try {
    result = callGeminiAPI(articleText, geminiModel, geminiApiKey);
  } catch (err) {
    Logger.log(`ERROR: Gemini失敗 - ${String(err)}`);
    updateRecord(pageId, null, 'エラー', notionAccessToken);
    return;
  }
  Logger.log(JSON.stringify(result));

  Logger.log('Step4: Notion更新...');
  try {
    updateRecord(pageId, result, '完了', notionAccessToken);
  } catch (err) {
    Logger.log(`ERROR: Notion更新失敗 - ${String(err)}`);
    return;
  }
  Logger.log('=== 統合テスト完了 ===');
}
