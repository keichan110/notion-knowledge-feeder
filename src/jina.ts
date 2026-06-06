const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;

/**
 * Jina AI Reader経由で記事本文を全文取得する。
 * 429 Too Many Requests の場合は指数バックオフで最大3回リトライする。
 * @param url 取得対象の記事URL
 * @returns 記事本文の全文
 * @throws フェッチ失敗・非200レスポンス・最大リトライ超過の場合
 */
export function fetchArticleContent(url: string): string {
  const jinaUrl = `https://r.jina.ai/${url}`;
  let backoffMs = INITIAL_BACKOFF_MS;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const response = UrlFetchApp.fetch(jinaUrl, { muteHttpExceptions: true });
    const status = response.getResponseCode();

    if (status === 200) {
      return response.getContentText();
    }

    if (status === 429 && attempt < MAX_RETRIES) {
      Utilities.sleep(backoffMs);
      backoffMs *= 2;
      continue;
    }

    throw new Error(`HTTP ${status}`);
  }

  throw new Error('Max retries exceeded: 429 rate limited');
}
