const MAX_CONTENT_LENGTH = 8000;

export function fetchArticleContent(url: string): string {
  const jinaUrl = `https://r.jina.ai/${url}`;
  try {
    const response = UrlFetchApp.fetch(jinaUrl, { muteHttpExceptions: true });
    if (response.getResponseCode() !== 200) {
      throw new Error();
    }
    const text = response.getContentText();
    return text.length > MAX_CONTENT_LENGTH ? text.substring(0, MAX_CONTENT_LENGTH) : text;
  } catch {
    return '';
  }
}
