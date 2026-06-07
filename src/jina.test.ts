import { describe, expect, it, vi } from 'vitest';
import { fetchArticleContent } from './jina';

const mockResponse = (code: number, text: string) => ({
  getResponseCode: vi.fn().mockReturnValue(code),
  getContentText: vi.fn().mockReturnValue(text),
});

describe('fetchArticleContent', () => {
  it('記事本文をそのまま返す', () => {
    vi.mocked(UrlFetchApp.fetch).mockReturnValue(mockResponse(200, 'article content') as never);

    expect(fetchArticleContent('https://example.com')).toBe('article content');
  });

  it('Jina ReaderのURLを組み立ててfetchする', () => {
    vi.mocked(UrlFetchApp.fetch).mockReturnValue(mockResponse(200, '') as never);

    fetchArticleContent('https://example.com/article');

    expect(UrlFetchApp.fetch).toHaveBeenCalledWith(
      'https://r.jina.ai/https://example.com/article',
      { muteHttpExceptions: true }
    );
  });

  it('200以外のレスポンスコードの場合はthrowする', () => {
    vi.mocked(UrlFetchApp.fetch).mockReturnValue(mockResponse(404, 'Not Found') as never);

    expect(() => fetchArticleContent('https://example.com')).toThrow();
  });

  it('fetchが例外を投げた場合はthrowする', () => {
    vi.mocked(UrlFetchApp.fetch).mockImplementation(() => {
      throw new Error('network error');
    });

    expect(() => fetchArticleContent('https://example.com')).toThrow('network error');
  });
});

describe('fetchArticleContent 429リトライ', () => {
  it('429の後に200が返ったときは記事本文を返す', () => {
    vi.mocked(UrlFetchApp.fetch)
      .mockReturnValueOnce(mockResponse(429, 'Too Many Requests') as never)
      .mockReturnValueOnce(mockResponse(200, 'article content') as never);

    expect(fetchArticleContent('https://example.com')).toBe('article content');
  });

  it('429が3回続いたらthrowする', () => {
    vi.mocked(UrlFetchApp.fetch).mockReturnValue(mockResponse(429, '') as never);

    expect(() => fetchArticleContent('https://example.com')).toThrow();
  });

  it('429リトライ時にUtilities.sleepが呼ばれる', () => {
    vi.mocked(UrlFetchApp.fetch)
      .mockReturnValueOnce(mockResponse(429, '') as never)
      .mockReturnValueOnce(mockResponse(200, '') as never);

    fetchArticleContent('https://example.com');

    expect(Utilities.sleep).toHaveBeenCalledWith(1000);
  });

  it('指数バックオフで待機時間が倍増する', () => {
    vi.mocked(UrlFetchApp.fetch).mockReturnValue(mockResponse(429, '') as never);

    expect(() => fetchArticleContent('https://example.com')).toThrow();

    expect(Utilities.sleep).toHaveBeenNthCalledWith(1, 1000);
    expect(Utilities.sleep).toHaveBeenNthCalledWith(2, 2000);
    expect(Utilities.sleep).toHaveBeenNthCalledWith(3, 4000);
  });

  it('429以外のエラーはリトライせず1回で終了する', () => {
    vi.mocked(UrlFetchApp.fetch).mockReturnValue(mockResponse(500, '') as never);

    expect(() => fetchArticleContent('https://example.com')).toThrow();

    expect(UrlFetchApp.fetch).toHaveBeenCalledTimes(1);
  });
});
