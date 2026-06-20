const ZENN_FEED_URL = 'https://zenn.dev/feed';
const ZENN_TREND_LIMIT = 3;

/**
 * ZennのトレンドRSSフィードからトレンドURLリストを取得する。
 * @returns 記事URLの配列
 * @throws フェッチ失敗・非200レスポンス・XMLパース失敗の場合
 */
export function fetchZennTrendUrls(): string[] {
  const response = UrlFetchApp.fetch(ZENN_FEED_URL, { muteHttpExceptions: true });
  const status = response.getResponseCode();
  if (status !== 200) {
    throw new Error(`HTTP ${status}`);
  }
  const xml = response.getContentText();

  const doc = XmlService.parse(xml);
  const channel = doc.getRootElement().getChild('channel');
  const items = channel?.getChildren('item') ?? [];
  return items
    .map((item) => item.getChildText('link') ?? '')
    .filter(Boolean)
    .slice(0, ZENN_TREND_LIMIT);
}
