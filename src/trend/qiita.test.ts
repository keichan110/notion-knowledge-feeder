import { describe, expect, it, vi } from 'vitest';
import { fetchQiitaTrendUrls } from './qiita';

const mockFetchResponse = (code: number, text: string) => ({
  getResponseCode: vi.fn().mockReturnValue(code),
  getContentText: vi.fn().mockReturnValue(text),
});

function setupXmlServiceAtom(urls: string[]) {
  const ns = {};
  vi.mocked(XmlService.getNamespace).mockReturnValue(ns as never);
  vi.mocked(XmlService.parse).mockReturnValue({
    getRootElement: vi.fn().mockReturnValue({
      getChildren: vi.fn().mockReturnValue(
        urls.map((url) => ({
          getChildren: vi.fn().mockReturnValue([
            {
              getAttribute: vi.fn((name: string) => {
                const attrs: Record<string, string> = {
                  rel: 'alternate',
                  type: 'text/html',
                  href: url,
                };
                return name in attrs ? { getValue: () => attrs[name] } : null;
              }),
            },
          ]),
        }))
      ),
    }),
  } as never);
}

describe('fetchQiitaTrendUrls', () => {
  it('AtomフィードからURLリストを返す', () => {
    vi.mocked(UrlFetchApp.fetch).mockReturnValue(mockFetchResponse(200, '<feed/>') as never);
    setupXmlServiceAtom(['https://qiita.com/article1', 'https://qiita.com/article2']);

    expect(fetchQiitaTrendUrls()).toEqual([
      'https://qiita.com/article1',
      'https://qiita.com/article2',
    ]);
  });

  it('rel="alternate"でもtype="text/html"でないlinkは除外する', () => {
    vi.mocked(UrlFetchApp.fetch).mockReturnValue(mockFetchResponse(200, '<feed/>') as never);
    const ns = {};
    vi.mocked(XmlService.getNamespace).mockReturnValue(ns as never);
    vi.mocked(XmlService.parse).mockReturnValue({
      getRootElement: vi.fn().mockReturnValue({
        getChildren: vi.fn().mockReturnValue([
          {
            getChildren: vi.fn().mockReturnValue([
              {
                getAttribute: vi.fn((name: string) => {
                  const attrs: Record<string, string> = {
                    rel: 'alternate',
                    type: 'application/atom+xml',
                    href: 'https://qiita.com/feed',
                  };
                  return name in attrs ? { getValue: () => attrs[name] } : null;
                }),
              },
            ]),
          },
        ]),
      }),
    } as never);

    expect(fetchQiitaTrendUrls()).toEqual([]);
  });

  it('200以外のレスポンスコードの場合はthrowする', () => {
    vi.mocked(UrlFetchApp.fetch).mockReturnValue(mockFetchResponse(404, 'Not Found') as never);

    expect(() => fetchQiitaTrendUrls()).toThrow();
  });

  it('fetchが例外を投げた場合はthrowする', () => {
    vi.mocked(UrlFetchApp.fetch).mockImplementation(() => {
      throw new Error('network error');
    });

    expect(() => fetchQiitaTrendUrls()).toThrow('network error');
  });

  it('XMLパースが失敗した場合はthrowする', () => {
    vi.mocked(UrlFetchApp.fetch).mockReturnValue(mockFetchResponse(200, 'invalid xml') as never);
    vi.mocked(XmlService.parse).mockImplementation(() => {
      throw new Error('parse error');
    });

    expect(() => fetchQiitaTrendUrls()).toThrow('parse error');
  });

  it('取得件数を3件に絞る', () => {
    vi.mocked(UrlFetchApp.fetch).mockReturnValue(mockFetchResponse(200, '<feed/>') as never);
    const urls = Array.from({ length: 10 }, (_, i) => `https://qiita.com/article${i}`);
    setupXmlServiceAtom(urls);

    expect(fetchQiitaTrendUrls()).toHaveLength(3);
  });
});
