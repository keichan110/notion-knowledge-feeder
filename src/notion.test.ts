import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GeminiResult } from './gemini';
import {
  createPendingRecord,
  DuplicateUrlError,
  incrementRetryCount,
  queryPendingRecord,
  updateRecord,
} from './notion';

const mockGeminiResult: GeminiResult = {
  title: 'テスト記事',
  overview: 'TypeScriptとVitestを使ったテスト手法の紹介記事',
  summary: [
    { heading: '背景', body: '背景の詳細' },
    { heading: '内容', body: '内容の詳細' },
  ],
  category: 'AI/ML',
  tags: ['TypeScript', 'Vitest'],
};

const mockResponse = (code: number, text = '') => ({
  getResponseCode: vi.fn().mockReturnValue(code),
  getContentText: vi.fn().mockReturnValue(text),
});

const emptyQueryResponse = () => mockResponse(200, JSON.stringify({ results: [] })) as never;

const hitQueryResponse = () =>
  mockResponse(200, JSON.stringify({ results: [{ id: 'existing-page' }] })) as never;

beforeEach(() => {
  vi.mocked(UrlFetchApp.fetch).mockReset();
});

describe('createPendingRecord', () => {
  it('POST /v1/pages に正しいエンドポイントでfetchする', () => {
    vi.mocked(UrlFetchApp.fetch)
      .mockReturnValueOnce(emptyQueryResponse())
      .mockReturnValueOnce(mockResponse(200, JSON.stringify({ id: 'page-123' })) as never);

    createPendingRecord('https://example.com', 'db-id', 'notion-key');

    expect(UrlFetchApp.fetch).toHaveBeenCalledWith(
      'https://api.notion.com/v1/pages',
      expect.objectContaining({ method: 'post' })
    );
  });

  it('ステータス「処理待ち」とURLをペイロードに含める', () => {
    vi.mocked(UrlFetchApp.fetch)
      .mockReturnValueOnce(emptyQueryResponse())
      .mockReturnValueOnce(mockResponse(200, JSON.stringify({ id: 'page-123' })) as never);

    createPendingRecord('https://example.com', 'db-id', 'notion-key');

    const [, options] = vi.mocked(UrlFetchApp.fetch).mock.calls[1]; // 2番目の呼び出しが作成
    const payload = JSON.parse((options as { payload: string }).payload);
    expect(payload.parent.database_id).toBe('db-id');
    // biome-ignore lint/complexity/useLiteralKeys: 日本語キーはブラケット記法を維持
    expect(payload.properties['ステータス'].select.name).toBe('処理待ち');
    expect(payload.properties.URL.url).toBe('https://example.com');
  });

  it('未登録URLの場合はページIDを返す', () => {
    vi.mocked(UrlFetchApp.fetch)
      .mockReturnValueOnce(emptyQueryResponse())
      .mockReturnValueOnce(mockResponse(200, JSON.stringify({ id: 'page-123' })) as never);

    const id = createPendingRecord('https://example.com', 'db-id', 'notion-key');

    expect(id).toBe('page-123');
  });

  it('登録済みURLの場合はDuplicateUrlErrorを投げてページを作成しない', () => {
    vi.mocked(UrlFetchApp.fetch).mockReturnValueOnce(hitQueryResponse());

    expect(() => createPendingRecord('https://example.com', 'db-id', 'notion-key')).toThrow(
      DuplicateUrlError
    );
    expect(UrlFetchApp.fetch).toHaveBeenCalledTimes(1); // 重複チェックのみ、作成なし
  });

  it('URLフィルタをかけた重複チェッククエリを先に送る', () => {
    vi.mocked(UrlFetchApp.fetch)
      .mockReturnValueOnce(emptyQueryResponse())
      .mockReturnValueOnce(mockResponse(200, JSON.stringify({ id: 'page-123' })) as never);

    createPendingRecord('https://example.com', 'db-id', 'notion-key');

    const [url, options] = vi.mocked(UrlFetchApp.fetch).mock.calls[0];
    expect(url).toBe('https://api.notion.com/v1/databases/db-id/query');
    const payload = JSON.parse((options as { payload: string }).payload);
    expect(payload.filter.property).toBe('URL');
    expect(payload.filter.url.equals).toBe('https://example.com');
    expect(payload.page_size).toBe(1);
  });

  it('200以外のレスポンスの場合はエラーを投げる', () => {
    vi.mocked(UrlFetchApp.fetch).mockReturnValue(mockResponse(400, 'Bad Request') as never);

    expect(() => createPendingRecord('https://example.com', 'db-id', 'notion-key')).toThrow(
      'Notion API error'
    );
  });
});

describe('queryPendingRecord', () => {
  it('ステータス「処理待ち」でフィルタしたクエリを送る', () => {
    vi.mocked(UrlFetchApp.fetch).mockReturnValue(
      mockResponse(
        200,
        JSON.stringify({
          results: [{ id: 'page-1', properties: { URL: { url: 'https://example.com' } } }],
        })
      ) as never
    );

    queryPendingRecord('db-id', 'notion-key');

    const [url, options] = vi.mocked(UrlFetchApp.fetch).mock.calls[0];
    expect(url).toBe('https://api.notion.com/v1/databases/db-id/query');
    const payload = JSON.parse((options as { payload: string }).payload);
    expect(payload.filter.select.equals).toBe('処理待ち');
    expect(payload.sorts).toEqual([
      { property: 'リトライ回数', direction: 'ascending' },
      { timestamp: 'created_time', direction: 'ascending' },
    ]);
    expect(payload.page_size).toBe(1);
  });

  it('結果が存在する場合はIDとURLとリトライ回数を返す', () => {
    vi.mocked(UrlFetchApp.fetch).mockReturnValue(
      mockResponse(
        200,
        JSON.stringify({
          results: [
            {
              id: 'page-1',
              properties: { URL: { url: 'https://example.com' }, リトライ回数: { number: 3 } },
            },
          ],
        })
      ) as never
    );

    const result = queryPendingRecord('db-id', 'notion-key');

    expect(result).toEqual({ id: 'page-1', url: 'https://example.com', retryCount: 3 });
  });

  it('リトライ回数フィールドがない場合はretryCount=0を返す', () => {
    vi.mocked(UrlFetchApp.fetch).mockReturnValue(
      mockResponse(
        200,
        JSON.stringify({
          results: [{ id: 'page-1', properties: { URL: { url: 'https://example.com' } } }],
        })
      ) as never
    );

    const result = queryPendingRecord('db-id', 'notion-key');

    expect(result).toEqual({ id: 'page-1', url: 'https://example.com', retryCount: 0 });
  });

  it('結果が0件の場合はnullを返す', () => {
    vi.mocked(UrlFetchApp.fetch).mockReturnValue(
      mockResponse(200, JSON.stringify({ results: [] })) as never
    );

    const result = queryPendingRecord('db-id', 'notion-key');

    expect(result).toBeNull();
  });

  it('200以外のレスポンスの場合はエラーを投げる', () => {
    vi.mocked(UrlFetchApp.fetch).mockReturnValue(mockResponse(400, 'error') as never);

    expect(() => queryPendingRecord('db-id', 'notion-key')).toThrow('Notion API error');
  });
});

describe('updateRecord', () => {
  it('「完了」時はプロパティ更新とブロック追加の2回fetchする', () => {
    vi.mocked(UrlFetchApp.fetch).mockReturnValue(mockResponse(200, '{}') as never);

    updateRecord('page-1', mockGeminiResult, '完了', 'notion-key');

    expect(UrlFetchApp.fetch).toHaveBeenCalledTimes(2);
    const [firstUrl] = vi.mocked(UrlFetchApp.fetch).mock.calls[0];
    const [secondUrl] = vi.mocked(UrlFetchApp.fetch).mock.calls[1];
    expect(firstUrl).toBe('https://api.notion.com/v1/pages/page-1');
    expect(secondUrl).toBe('https://api.notion.com/v1/blocks/page-1/children');
  });

  it('「完了」時にGeminiResultのプロパティを書き込む', () => {
    vi.mocked(UrlFetchApp.fetch).mockReturnValue(mockResponse(200, '{}') as never);

    updateRecord('page-1', mockGeminiResult, '完了', 'notion-key');

    const [, options] = vi.mocked(UrlFetchApp.fetch).mock.calls[0];
    const payload = JSON.parse((options as { payload: string }).payload);
    // biome-ignore lint/complexity/useLiteralKeys: 日本語キーはブラケット記法を維持
    expect(payload.properties['タイトル'].title[0].text.content).toBe('テスト記事');
    // biome-ignore lint/complexity/useLiteralKeys: 日本語キーはブラケット記法を維持
    expect(payload.properties['ステータス'].select.name).toBe('完了');
  });

  it('「完了」時に概要と要約のブロックを追加する', () => {
    vi.mocked(UrlFetchApp.fetch).mockReturnValue(mockResponse(200, '{}') as never);

    updateRecord('page-1', mockGeminiResult, '完了', 'notion-key');

    const [, options] = vi.mocked(UrlFetchApp.fetch).mock.calls[1];
    const payload = JSON.parse((options as { payload: string }).payload);
    expect(payload.children[0].paragraph.rich_text[0].text.content).toBe(
      'TypeScriptとVitestを使ったテスト手法の紹介記事'
    );
    expect(payload.children[1].heading_2.rich_text[0].text.content).toBe('要約');
    expect(payload.children[2].heading_3.rich_text[0].text.content).toBe('背景');
  });

  it('section.bodyが2000文字を超える場合は複数のparagraphブロックに分割する', () => {
    vi.mocked(UrlFetchApp.fetch).mockReturnValue(mockResponse(200, '{}') as never);
    const longBody = '。'.repeat(2500);
    const result: GeminiResult = {
      ...mockGeminiResult,
      summary: [{ heading: '長文セクション', body: longBody }],
    };

    updateRecord('page-1', result, '完了', 'notion-key');

    const [, options] = vi.mocked(UrlFetchApp.fetch).mock.calls[1];
    const payload = JSON.parse((options as { payload: string }).payload);
    const bodyBlocks = payload.children.filter((b: { type: string }) => b.type === 'paragraph');
    // overview用1ブロック + 分割された長文セクションの複数ブロック
    expect(bodyBlocks.length).toBeGreaterThan(2);
    const totalLength = bodyBlocks
      .slice(1)
      .reduce(
        (sum: number, b: { paragraph: { rich_text: { text: { content: string } }[] } }) =>
          sum + b.paragraph.rich_text[0].text.content.length,
        0
      );
    expect(totalLength).toBe(longBody.length);
  });

  it('分割された各ブロックのcontentは2000文字以下である', () => {
    vi.mocked(UrlFetchApp.fetch).mockReturnValue(mockResponse(200, '{}') as never);
    const longBody = '。'.repeat(2500);
    const result: GeminiResult = {
      ...mockGeminiResult,
      summary: [{ heading: '長文セクション', body: longBody }],
    };

    updateRecord('page-1', result, '完了', 'notion-key');

    const [, options] = vi.mocked(UrlFetchApp.fetch).mock.calls[1];
    const payload = JSON.parse((options as { payload: string }).payload);
    const bodyBlocks = payload.children.filter((b: { type: string }) => b.type === 'paragraph');
    for (const block of bodyBlocks) {
      expect(block.paragraph.rich_text[0].text.content.length).toBeLessThanOrEqual(2000);
    }
  });

  it('改行を境界として優先して分割する', () => {
    vi.mocked(UrlFetchApp.fetch).mockReturnValue(mockResponse(200, '{}') as never);
    const longBody = `${'a'.repeat(1990)}\n${'b'.repeat(500)}`;
    const result: GeminiResult = {
      ...mockGeminiResult,
      summary: [{ heading: '長文セクション', body: longBody }],
    };

    updateRecord('page-1', result, '完了', 'notion-key');

    const [, options] = vi.mocked(UrlFetchApp.fetch).mock.calls[1];
    const payload = JSON.parse((options as { payload: string }).payload);
    const bodyBlocks = payload.children.filter((b: { type: string }) => b.type === 'paragraph');
    const firstSectionBlock = bodyBlocks[1];
    expect(firstSectionBlock.paragraph.rich_text[0].text.content).toBe(`${'a'.repeat(1990)}\n`);
  });

  it('overviewが2000文字を超える場合も複数ブロックへ分割する', () => {
    vi.mocked(UrlFetchApp.fetch).mockReturnValue(mockResponse(200, '{}') as never);
    const longOverview = '。'.repeat(2500);
    const result: GeminiResult = { ...mockGeminiResult, overview: longOverview };

    updateRecord('page-1', result, '完了', 'notion-key');

    const [, options] = vi.mocked(UrlFetchApp.fetch).mock.calls[1];
    const payload = JSON.parse((options as { payload: string }).payload);
    const headingIndex = payload.children.findIndex(
      (b: { type: string }) => b.type === 'heading_2'
    );
    const overviewBlocks = payload.children
      .slice(0, headingIndex)
      .filter((b: { type: string }) => b.type === 'paragraph');
    expect(overviewBlocks.length).toBeGreaterThan(1);
    for (const block of overviewBlocks) {
      expect(block.paragraph.rich_text[0].text.content.length).toBeLessThanOrEqual(2000);
    }
  });

  it('「エラー」時はステータスのみ更新する1回のfetchのみ', () => {
    vi.mocked(UrlFetchApp.fetch).mockReturnValue(mockResponse(200, '{}') as never);

    updateRecord('page-1', null, 'エラー', 'notion-key');

    expect(UrlFetchApp.fetch).toHaveBeenCalledTimes(1);
    const [url, options] = vi.mocked(UrlFetchApp.fetch).mock.calls[0];
    expect(url).toBe('https://api.notion.com/v1/pages/page-1');
    const payload = JSON.parse((options as { payload: string }).payload);
    // biome-ignore lint/complexity/useLiteralKeys: 日本語キーはブラケット記法を維持
    expect(payload.properties['ステータス'].select.name).toBe('エラー');
  });

  it('プロパティ更新で200以外のレスポンスの場合はエラーを投げる', () => {
    vi.mocked(UrlFetchApp.fetch).mockReturnValue(mockResponse(400, 'error') as never);

    expect(() => updateRecord('page-1', mockGeminiResult, '完了', 'notion-key')).toThrow(
      'Notion API error'
    );
  });
});

describe('incrementRetryCount', () => {
  it('PATCH /v1/pages/{id} にリトライ回数+1をペイロードとして送る', () => {
    vi.mocked(UrlFetchApp.fetch).mockReturnValue(mockResponse(200, '{}') as never);

    incrementRetryCount('page-1', 2, 'notion-key');

    const [url, options] = vi.mocked(UrlFetchApp.fetch).mock.calls[0];
    expect(url).toBe('https://api.notion.com/v1/pages/page-1');
    const payload = JSON.parse((options as { payload: string }).payload);
    // biome-ignore lint/complexity/useLiteralKeys: 日本語キーはブラケット記法を維持
    expect(payload.properties['リトライ回数'].number).toBe(3);
  });

  it('currentRetryCount=0の場合はリトライ回数を1にする', () => {
    vi.mocked(UrlFetchApp.fetch).mockReturnValue(mockResponse(200, '{}') as never);

    incrementRetryCount('page-1', 0, 'notion-key');

    const [, options] = vi.mocked(UrlFetchApp.fetch).mock.calls[0];
    const payload = JSON.parse((options as { payload: string }).payload);
    // biome-ignore lint/complexity/useLiteralKeys: 日本語キーはブラケット記法を維持
    expect(payload.properties['リトライ回数'].number).toBe(1);
  });

  it('200以外のレスポンスの場合はエラーを投げる', () => {
    vi.mocked(UrlFetchApp.fetch).mockReturnValue(mockResponse(400, 'error') as never);

    expect(() => incrementRetryCount('page-1', 0, 'notion-key')).toThrow('Notion API error');
  });
});
