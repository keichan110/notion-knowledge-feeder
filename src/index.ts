import { getConfig } from './config';
import { callGeminiAPI, type GeminiResult } from './gemini';
import { fetchArticleContent } from './jina';
import { writeToNotion } from './notion';
import { createResponse } from './utils';

// biome-ignore lint/correctness/noUnusedVariables: GAS entry point
function doPost(e: GoogleAppsScript.Events.DoPost): GoogleAppsScript.Content.TextOutput {
  const { secretToken, geminiModel, geminiApiKey, notionDbId, notionAccessToken } = getConfig();

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

  const articleText = fetchArticleContent(url);
  if (!articleText) {
    return createResponse(false, 'Failed to fetch article');
  }

  let geminiResult: GeminiResult;
  try {
    geminiResult = callGeminiAPI(articleText, geminiModel, geminiApiKey);
  } catch {
    return createResponse(false, 'Failed to summarize');
  }

  try {
    writeToNotion(geminiResult, url, notionDbId, notionAccessToken);
  } catch (err) {
    return createResponse(false, `Notion write failed: ${String(err)}`);
  }

  return createResponse(true, 'Success');
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
      { heading: '内容', body: '静的型付けにより実行前にバグを検出できる。型推論・ジェネリクス・インターフェースを備える。' },
      { heading: 'まとめ', body: 'ReactやNext.jsなど主要フレームワークで標準採用。VSCodeとの親和性も高く開発体験が向上する。' },
    ],
    category: '開発',
    tags: ['TypeScript', 'JavaScript', 'Microsoft', 'React', 'Next.js'],
    confidence: 'high' as const,
  };
  const testUrl = 'https://www.typescriptlang.org/';

  Logger.log('=== Notion 書き込みテスト開始 ===');
  try {
    writeToNotion(fixedResult, testUrl, notionDbId, notionAccessToken);
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
    writeToNotion(result, testUrl, notionDbId, notionAccessToken);
  } catch (err) {
    Logger.log(`ERROR: Notion書き込み失敗 - ${String(err)}`);
    return;
  }
  Logger.log('=== 統合テスト完了 ===');
}
