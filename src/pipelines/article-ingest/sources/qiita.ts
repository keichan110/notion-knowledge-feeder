const QIITA_FEED_URL = 'https://qiita.com/popular-items/feed.atom';
const ATOM_NS_URI = 'http://www.w3.org/2005/Atom';
const QIITA_TREND_LIMIT = 3;

/**
 * Qiitaの人気記事AtomフィードからトレンドURLリストを取得する。
 * @returns 記事URLの配列
 * @throws フェッチ失敗・非200レスポンス・XMLパース失敗の場合
 */
export function fetchQiitaTrendUrls(): string[] {
  const response = UrlFetchApp.fetch(QIITA_FEED_URL, { muteHttpExceptions: true });
  const status = response.getResponseCode();
  if (status !== 200) {
    throw new Error(`HTTP ${status}`);
  }
  const xml = response.getContentText();

  const doc = XmlService.parse(xml);
  const root = doc.getRootElement();
  const ns = XmlService.getNamespace(ATOM_NS_URI);
  const urls: string[] = [];
  for (const entry of root.getChildren('entry', ns)) {
    for (const link of entry.getChildren('link', ns)) {
      if (
        link.getAttribute('rel')?.getValue() === 'alternate' &&
        link.getAttribute('type')?.getValue() === 'text/html'
      ) {
        const href = link.getAttribute('href')?.getValue();
        if (href) urls.push(href);
      }
    }
  }
  return urls.slice(0, QIITA_TREND_LIMIT);
}
