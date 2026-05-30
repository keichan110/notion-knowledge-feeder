import { log } from './log';

/**
 * Jina AI Reader経由で記事本文を全文取得する。
 * @param url 取得対象の記事URL
 * @returns 記事本文の全文。取得に失敗した場合は空文字列
 */
export function fetchArticleContent(url: string): string {
  const jinaUrl = `https://r.jina.ai/${url}`;
  try {
    const response = UrlFetchApp.fetch(jinaUrl, { muteHttpExceptions: true });
    const status = response.getResponseCode();
    if (status !== 200) {
      log.error('fetchArticleContent', 'non-200 response', undefined, { status, url });
      return '';
    }
    const text = response.getContentText();
    // TODO(dev-log): 本番運用時に削除
    log.info('fetchArticleContent', 'fetched', { chars: text.length });
    return text;
  } catch (err) {
    log.error('fetchArticleContent', 'fetch failed', err, { url });
    return '';
  }
}
