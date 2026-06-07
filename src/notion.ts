import type { GeminiResult } from './gemini';

const NOTION_API_BASE = 'https://api.notion.com/v1';

export type NotionDbId = string;
export type NotionConnectAccessToken = string;

/**
 * URLが既にNotionデータベースに登録済みの場合にスローされるエラー。
 */
export class DuplicateUrlError extends Error {
  constructor(url: string) {
    super(`URL already registered: ${url}`);
    this.name = 'DuplicateUrlError';
  }
}

/**
 * URLとステータス「処理中」でNotionにレコードを仮登録する。
 * @param url 保存対象の記事URL
 * @param notionDbId 保存先NotionデータベースID
 * @param notionAccessToken Notion APIアクセストークン
 * @returns 作成されたNotionページID
 * @throws {DuplicateUrlError} URLが既に登録済みの場合
 */
export function createPendingRecord(
  url: string,
  notionDbId: NotionDbId,
  notionAccessToken: NotionConnectAccessToken
): string {
  if (isUrlRegistered(url, notionDbId, notionAccessToken)) throw new DuplicateUrlError(url);

  const response = UrlFetchApp.fetch(
    `${NOTION_API_BASE}/pages`,
    notionFetchOptions('post', notionAccessToken, {
      parent: { database_id: notionDbId },
      properties: {
        URL: { url },
        // biome-ignore lint/complexity/useLiteralKeys: 日本語キーはブラケット記法を維持
        ['ステータス']: { select: { name: '処理中' } },
      },
    })
  );

  assertOk(response);
  return (JSON.parse(response.getContentText()) as { id: string }).id;
}

/**
 * ステータスが「処理中」のレコードを作成日昇順で1件取得する。
 * @param notionDbId 検索対象のNotionデータベースID
 * @param notionAccessToken Notion APIアクセストークン
 * @returns ページIDとURLのオブジェクト。該当レコードがなければ `null`
 */
export function queryPendingRecord(
  notionDbId: NotionDbId,
  notionAccessToken: NotionConnectAccessToken
): { id: string; url: string } | null {
  const response = UrlFetchApp.fetch(
    `${NOTION_API_BASE}/databases/${notionDbId}/query`,
    notionFetchOptions('post', notionAccessToken, {
      filter: {
        property: 'ステータス',
        select: { equals: '処理中' },
      },
      sorts: [{ timestamp: 'created_time', direction: 'ascending' }],
      page_size: 1,
    })
  );

  assertOk(response);

  const result = JSON.parse(response.getContentText()) as {
    results: { id: string; properties: { URL?: { url?: string } } }[];
  };

  if (result.results.length === 0) return null;

  const page = result.results[0];
  return { id: page.id, url: page.properties.URL?.url ?? '' };
}

/**
 * 既存のNotionレコードをGeminiの要約結果で更新する。
 * @param pageId 更新対象のNotionページID
 * @param data Geminiの要約結果。`status` が `'エラー'` の場合は `null` を渡す
 * @param status 更新後のステータス（`'完了'` または `'エラー'`）
 * @param notionAccessToken Notion APIアクセストークン
 */
export function updateRecord(
  pageId: string,
  data: GeminiResult | null,
  status: '完了' | 'エラー',
  notionAccessToken: NotionConnectAccessToken
): void {
  const properties: Record<string, unknown> = {
    // biome-ignore lint/complexity/useLiteralKeys: 日本語キーはブラケット記法を維持
    ['ステータス']: { select: { name: status } },
  };

  if (status === '完了' && data) {
    // biome-ignore lint/complexity/useLiteralKeys: 日本語キーはブラケット記法を維持
    properties['タイトル'] = { title: [{ text: { content: data.title } }] };
    // biome-ignore lint/complexity/useLiteralKeys: 日本語キーはブラケット記法を維持
    properties['既読'] = { checkbox: false };
    // biome-ignore lint/complexity/useLiteralKeys: 日本語キーはブラケット記法を維持
    properties['カテゴリー'] = { select: { name: data.category } };
    // biome-ignore lint/complexity/useLiteralKeys: 日本語キーはブラケット記法を維持
    properties['タグ'] = { multi_select: data.tags.map((tag) => ({ name: tag })) };
  }

  const propResponse = UrlFetchApp.fetch(
    `${NOTION_API_BASE}/pages/${pageId}`,
    notionFetchOptions('patch', notionAccessToken, { properties })
  );
  assertOk(propResponse);

  if (status === '完了' && data) {
    const children = [
      {
        object: 'block',
        type: 'paragraph',
        paragraph: { rich_text: [{ type: 'text', text: { content: data.overview } }] },
      },
      {
        object: 'block',
        type: 'heading_2',
        heading_2: { rich_text: [{ type: 'text', text: { content: '要約' } }] },
      },
      ...data.summary.flatMap((section) => [
        {
          object: 'block',
          type: 'heading_3',
          heading_3: { rich_text: [{ type: 'text', text: { content: section.heading } }] },
        },
        {
          object: 'block',
          type: 'paragraph',
          paragraph: { rich_text: [{ type: 'text', text: { content: section.body } }] },
        },
      ]),
    ];

    const blockResponse = UrlFetchApp.fetch(
      `${NOTION_API_BASE}/blocks/${pageId}/children`,
      notionFetchOptions('patch', notionAccessToken, { children })
    );
    assertOk(blockResponse);
  }
}

function isUrlRegistered(
  url: string,
  notionDbId: NotionDbId,
  notionAccessToken: NotionConnectAccessToken
): boolean {
  const response = UrlFetchApp.fetch(
    `${NOTION_API_BASE}/databases/${notionDbId}/query`,
    notionFetchOptions('post', notionAccessToken, {
      filter: {
        property: 'URL',
        url: { equals: url },
      },
      page_size: 1,
    })
  );

  assertOk(response);

  const result = JSON.parse(response.getContentText()) as { results: unknown[] };
  return result.results.length > 0;
}

/**
 * Notion API呼び出し用のfetchオプションを生成する。
 * @param method HTTPメソッド（`'post'` または `'patch'`）
 * @param token Notion APIアクセストークン
 * @param payload リクエストボディとして送信するオブジェクト
 * @returns `UrlFetchApp.fetch` に渡すオプションオブジェクト
 */
function notionFetchOptions(
  method: 'post' | 'patch',
  token: NotionConnectAccessToken,
  payload: object
): GoogleAppsScript.URL_Fetch.URLFetchRequestOptions {
  return {
    method,
    contentType: 'application/json',
    headers: {
      Authorization: `Bearer ${token}`,
      'Notion-Version': '2022-06-28',
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  };
}

/**
 * Notion APIレスポンスのステータスコードを検証する。
 * @param response `UrlFetchApp.fetch` から返されたレスポンス
 * @throws ステータスコードが200以外の場合にエラーをスローする
 */
function assertOk(response: GoogleAppsScript.URL_Fetch.HTTPResponse): void {
  if (response.getResponseCode() !== 200) {
    throw new Error(`Notion API error: ${response.getContentText()}`);
  }
}
