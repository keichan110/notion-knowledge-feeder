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

  it('200以外のレスポンスコードの場合は空文字を返す', () => {
    vi.mocked(UrlFetchApp.fetch).mockReturnValue(mockResponse(404, 'Not Found') as never);

    expect(fetchArticleContent('https://example.com')).toBe('');
  });

  it('fetchが例外を投げた場合は空文字を返す', () => {
    vi.mocked(UrlFetchApp.fetch).mockImplementation(() => {
      throw new Error('network error');
    });

    expect(fetchArticleContent('https://example.com')).toBe('');
  });
});
