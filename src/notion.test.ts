import { describe, expect, it, vi } from 'vitest';
import type { GeminiResult } from './gemini';
import { writeToNotion } from './notion';

const mockData: GeminiResult = {
  title: 'テスト記事',
  tldr: '要約文',
  summary: '詳細要約',
  category: 'AI/ML',
  tags: ['TypeScript', 'Vitest'],
  confidence: 'high',
};

const mockResponse = (code: number, text = '') => ({
  getResponseCode: vi.fn().mockReturnValue(code),
  getContentText: vi.fn().mockReturnValue(text),
});

describe('writeToNotion', () => {
  it('200レスポンスの場合は正常終了する', () => {
    vi.mocked(UrlFetchApp.fetch).mockReturnValue(mockResponse(200) as never);

    expect(() =>
      writeToNotion(mockData, 'https://example.com', 'db-id', 'notion-key')
    ).not.toThrow();
  });

  it('正しいエンドポイントとヘッダーでfetchする', () => {
    vi.mocked(UrlFetchApp.fetch).mockReturnValue(mockResponse(200) as never);

    writeToNotion(mockData, 'https://example.com', 'db-id', 'notion-key');

    expect(UrlFetchApp.fetch).toHaveBeenCalledWith(
      'https://api.notion.com/v1/pages',
      expect.objectContaining({
        method: 'post',
        contentType: 'application/json',
        headers: {
          Authorization: 'Bearer notion-key',
          'Notion-Version': '2022-06-28',
        },
      })
    );
  });

  it('ペイロードにGeminiResultとURLが含まれる', () => {
    vi.mocked(UrlFetchApp.fetch).mockReturnValue(mockResponse(200) as never);

    writeToNotion(mockData, 'https://example.com', 'db-id', 'notion-key');

    const call = vi.mocked(UrlFetchApp.fetch).mock.calls[0];
    const options = call[1] as { payload: string };
    const payload = JSON.parse(options.payload);

    expect(payload.parent.database_id).toBe('db-id');
    // biome-ignore lint/complexity/useLiteralKeys: 日本語キーはブラケット記法を維持
    expect(payload.properties['タイトル'].title[0].text.content).toBe('テスト記事');
    expect(payload.properties['既読'].checkbox).toBe(false);
    expect(payload.properties.URL.url).toBe('https://example.com');
    expect(payload.properties['TL;DR'].rich_text[0].text.content).toBe('要約文');
    // biome-ignore lint/complexity/useLiteralKeys: 日本語キーはブラケット記法を維持
    expect(payload.properties['カテゴリー'].select.name).toBe('AI/ML');
    // biome-ignore lint/complexity/useLiteralKeys: 日本語キーはブラケット記法を維持
    expect(payload.properties['タグ'].multi_select).toEqual([
      { name: 'TypeScript' },
      { name: 'Vitest' },
    ]);
    expect(payload.properties.Confidence.select.name).toBe('high');
  });

  it('200以外のレスポンスの場合はエラーを投げる', () => {
    vi.mocked(UrlFetchApp.fetch).mockReturnValue(
      mockResponse(400, '{"message":"Bad Request"}') as never
    );

    expect(() => writeToNotion(mockData, 'https://example.com', 'db-id', 'notion-key')).toThrow(
      'Notion API error'
    );
  });
});
