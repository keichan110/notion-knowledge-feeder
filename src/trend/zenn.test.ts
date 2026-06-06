import { describe, expect, it, vi } from 'vitest';
import { fetchZennTrendUrls } from './zenn';

const mockFetchResponse = (code: number, text: string) => ({
  getResponseCode: vi.fn().mockReturnValue(code),
  getContentText: vi.fn().mockReturnValue(text),
});

function setupXmlServiceRss(urls: string[]) {
  vi.mocked(XmlService.parse).mockReturnValue({
    getRootElement: vi.fn().mockReturnValue({
      getChild: vi.fn().mockReturnValue({
        getChildren: vi.fn().mockReturnValue(
          urls.map((url) => ({
            getChildText: vi.fn((name: string) => (name === 'link' ? url : null)),
          }))
        ),
      }),
    }),
  } as never);
}

describe('fetchZennTrendUrls', () => {
  it('RSSフィードからURLリストを返す', () => {
    vi.mocked(UrlFetchApp.fetch).mockReturnValue(mockFetchResponse(200, '<rss/>') as never);
    setupXmlServiceRss(['https://zenn.dev/article1', 'https://zenn.dev/article2']);

    expect(fetchZennTrendUrls()).toEqual([
      'https://zenn.dev/article1',
      'https://zenn.dev/article2',
    ]);
  });

  it('linkが空文字のitemは除外する', () => {
    vi.mocked(UrlFetchApp.fetch).mockReturnValue(mockFetchResponse(200, '<rss/>') as never);
    setupXmlServiceRss(['https://zenn.dev/article1', '']);

    expect(fetchZennTrendUrls()).toEqual(['https://zenn.dev/article1']);
  });

  it('200以外のレスポンスコードの場合は空配列を返す', () => {
    vi.mocked(UrlFetchApp.fetch).mockReturnValue(mockFetchResponse(500, 'error') as never);

    expect(fetchZennTrendUrls()).toEqual([]);
  });

  it('fetchが例外を投げた場合は空配列を返す', () => {
    vi.mocked(UrlFetchApp.fetch).mockImplementation(() => {
      throw new Error('network error');
    });

    expect(fetchZennTrendUrls()).toEqual([]);
  });

  it('XMLパースが失敗した場合は空配列を返す', () => {
    vi.mocked(UrlFetchApp.fetch).mockReturnValue(mockFetchResponse(200, 'invalid xml') as never);
    vi.mocked(XmlService.parse).mockImplementation(() => {
      throw new Error('parse error');
    });

    expect(fetchZennTrendUrls()).toEqual([]);
  });

  it('取得件数を3件に絞る', () => {
    vi.mocked(UrlFetchApp.fetch).mockReturnValue(mockFetchResponse(200, '<rss/>') as never);
    const urls = Array.from({ length: 10 }, (_, i) => `https://zenn.dev/article${i}`);
    setupXmlServiceRss(urls);

    expect(fetchZennTrendUrls()).toHaveLength(3);
  });
});
