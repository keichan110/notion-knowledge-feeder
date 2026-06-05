import { log } from './log';

const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;

/**
 * Jina AI Reader経由で記事本文を全文取得する。
 * 429 Too Many Requests の場合は指数バックオフで最大3回リトライする。
 * @param url 取得対象の記事URL
 * @returns 記事本文の全文。取得に失敗した場合は空文字列
 */
export function fetchArticleContent(url: string): string {
  const jinaUrl = `https://r.jina.ai/${url}`;
  let backoffMs = INITIAL_BACKOFF_MS;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = UrlFetchApp.fetch(jinaUrl, { muteHttpExceptions: true });
      const status = response.getResponseCode();

      if (status === 200) {
        const text = response.getContentText();
        // TODO(dev-log): 本番運用時に削除
        log.info('fetchArticleContent', 'fetched', { chars: text.length });
        return text;
      }

      if (status === 429 && attempt < MAX_RETRIES) {
        log.warn('fetchArticleContent', '429 rate limited, retrying', { attempt, backoffMs, url });
        Utilities.sleep(backoffMs);
        backoffMs *= 2;
        continue;
      }

      log.error('fetchArticleContent', 'non-200 response', undefined, { status, url });
      return '';
    } catch (err) {
      log.error('fetchArticleContent', 'fetch failed', err, { url });
      return '';
    }
  }

  log.error('fetchArticleContent', 'max retries exceeded', undefined, { url });
  return '';
}
