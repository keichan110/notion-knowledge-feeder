import { describe, expect, it, vi } from 'vitest';
import type { GeminiResult } from './gemini';
import { writeToNotion } from './notion';

const mockData: GeminiResult = {
  title: 'テスト記事',
  tldr: ['何の記事かを示す文', 'なぜ重要かを示す文'],
  summary: [
    { heading: '背景', body: '背景の詳細' },
    { heading: '内容', body: '内容の詳細' },
    { heading: 'まとめ', body: 'まとめの詳細' },
  ],
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
    // biome-ignore lint/complexity/useLiteralKeys: 日本語キーはブラケット記法を維持
    expect(payload.properties['カテゴリー'].select.name).toBe('AI/ML');
    // biome-ignore lint/complexity/useLiteralKeys: 日本語キーはブラケット記法を維持
    expect(payload.properties['タグ'].multi_select).toEqual([
      { name: 'TypeScript' },
      { name: 'Vitest' },
    ]);
    expect(payload.properties.Confidence.select.name).toBe('high');

    expect(payload.children[0].heading_2.rich_text[0].text.content).toBe('TL;DR');
    expect(payload.children[1].bulleted_list_item.rich_text[0].text.content).toBe('何の記事かを示す文');
    expect(payload.children[2].bulleted_list_item.rich_text[0].text.content).toBe('なぜ重要かを示す文');
    expect(payload.children[3].heading_2.rich_text[0].text.content).toBe('要約');
    expect(payload.children[4].heading_3.rich_text[0].text.content).toBe('背景');
    expect(payload.children[5].paragraph.rich_text[0].text.content).toBe('背景の詳細');
    expect(payload.children[6].heading_3.rich_text[0].text.content).toBe('内容');
    expect(payload.children[7].paragraph.rich_text[0].text.content).toBe('内容の詳細');
    expect(payload.children[8].heading_3.rich_text[0].text.content).toBe('まとめ');
    expect(payload.children[9].paragraph.rich_text[0].text.content).toBe('まとめの詳細');
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
