/**
 * Jina AI Reader経由で記事本文を全文取得する。
 * @param url 取得対象の記事URL
 * @returns 記事本文の全文。取得に失敗した場合は空文字列
 */
export function fetchArticleContent(url: string): string {
  const jinaUrl = `https://r.jina.ai/${url}`;
  try {
    const response = UrlFetchApp.fetch(jinaUrl, { muteHttpExceptions: true });
    if (response.getResponseCode() !== 200) {
      throw new Error();
    }
    return response.getContentText();
  } catch {
    return '';
  }
}
