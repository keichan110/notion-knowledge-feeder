import { log } from '../log';

const ZENN_FEED_URL = 'https://zenn.dev/feed';
const ZENN_TREND_LIMIT = 10;

/**
 * ZennのトレンドRSSフィードからトレンドURLリストを取得する。
 * @returns 記事URLの配列。取得・パースに失敗した場合は空配列
 */
export function fetchZennTrendUrls(): string[] {
  let xml: string;
  try {
    const response = UrlFetchApp.fetch(ZENN_FEED_URL, { muteHttpExceptions: true });
    const status = response.getResponseCode();
    if (status !== 200) {
      log.warn('fetchZennTrendUrls', 'non-200 response', { status });
      return [];
    }
    xml = response.getContentText();
  } catch (err) {
    log.error('fetchZennTrendUrls', 'fetch failed', err);
    return [];
  }

  try {
    const doc = XmlService.parse(xml);
    const channel = doc.getRootElement().getChild('channel');
    const items = channel?.getChildren('item') ?? [];
    return items
      .map((item) => item.getChildText('link') ?? '')
      .filter(Boolean)
      .slice(0, ZENN_TREND_LIMIT);
  } catch (err) {
    log.error('fetchZennTrendUrls', 'parse failed', err);
    return [];
  }
}
