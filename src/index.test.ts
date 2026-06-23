import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./lib/config');
vi.mock('./capabilities/gemini');
vi.mock('./capabilities/jina');
vi.mock('./pipelines/article-ingest/pending');
vi.mock('./pipelines/article-ingest/sources');

import { callGeminiAPI } from './capabilities/gemini';
import { fetchArticleContent } from './capabilities/jina';
import { doPost } from './index';
import { getGeminiConfig, getNotionConfig, getSecretConfig } from './lib/config';
import {
  processPendingArticles,
  processTrendingQiita,
  processTrendingZenn,
} from './pipelines/article-ingest';
import type { GeminiResult } from './pipelines/article-ingest/gemini';
import {
  clearPendingArticlesFlag,
  DuplicateUrlError,
  hasPendingArticles,
  incrementRetryCount,
  queryPendingRecord,
  registerPendingRecord,
  updateRecord,
} from './pipelines/article-ingest/pending';
import { fetchQiitaTrendUrls, fetchZennTrendUrls } from './pipelines/article-ingest/sources';

const mockGeminiResult: GeminiResult = {
  title: 'テスト記事',
  overview: 'TypeScriptを使った開発手法の紹介記事',
  summary: [{ heading: '背景', body: '詳細' }],
  category: '開発',
  tags: ['TypeScript'],
};

const mockEvent = (body: object): GoogleAppsScript.Events.DoPost =>
  ({ postData: { contents: JSON.stringify(body) } }) as unknown as GoogleAppsScript.Events.DoPost;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSecretConfig).mockReturnValue({
    secretToken: 'valid-token',
  });
  vi.mocked(getGeminiConfig).mockReturnValue({
    geminiApiKey: 'gemini-key',
    geminiModel: 'gemini-2.5-flash',
  });
  vi.mocked(getNotionConfig).mockReturnValue({
    notionAccessToken: 'notion-key',
    notionDbId: 'db-id',
  });
  vi.mocked(registerPendingRecord).mockReturnValue('page-id');
  vi.mocked(queryPendingRecord).mockReturnValue(null);
  vi.mocked(fetchArticleContent).mockReturnValue('article text');
  vi.mocked(callGeminiAPI).mockReturnValue(JSON.stringify(mockGeminiResult));
  vi.mocked(hasPendingArticles).mockReturnValue(false);
  vi.mocked(fetchQiitaTrendUrls).mockReturnValue([]);
  vi.mocked(fetchZennTrendUrls).mockReturnValue([]);
});

describe('doPost', () => {
  it('不正なJSONの場合はエラーレスポンスを返す', () => {
    const event = {
      postData: { contents: 'invalid json' },
    } as unknown as GoogleAppsScript.Events.DoPost;

    doPost(event);

    expect(ContentService.createTextOutput).toHaveBeenCalledWith(
      JSON.stringify({ success: false, message: 'Invalid JSON' })
    );
  });

  it('トークン不一致の場合はUnauthorizedを返す', () => {
    doPost(mockEvent({ token: 'wrong-token', url: 'https://example.com' }));

    expect(ContentService.createTextOutput).toHaveBeenCalledWith(
      JSON.stringify({ success: false, message: 'Unauthorized' })
    );
  });

  it('URLがない場合はエラーを返す', () => {
    doPost(mockEvent({ token: 'valid-token' }));

    expect(ContentService.createTextOutput).toHaveBeenCalledWith(
      JSON.stringify({ success: false, message: 'URL is required' })
    );
  });

  it('正常なリクエストはNotionに仮登録してacceptedを返す', () => {
    doPost(mockEvent({ token: 'valid-token', url: 'https://example.com' }));

    expect(registerPendingRecord).toHaveBeenCalledWith(
      'https://example.com',
      'db-id',
      'notion-key'
    );
    expect(ContentService.createTextOutput).toHaveBeenCalledWith(
      JSON.stringify({ success: true, message: 'accepted' })
    );
  });

  it('クエリパラメーター付きURLはクエリを除去してNotionに登録する', () => {
    doPost(
      mockEvent({
        token: 'valid-token',
        url: 'https://example.com/article?ref=top&utm_source=feed',
      })
    );

    expect(registerPendingRecord).toHaveBeenCalledWith(
      'https://example.com/article',
      'db-id',
      'notion-key'
    );
  });

  it('登録済みURLの場合はHAS_PENDINGをセットせずduplicateを返す', () => {
    vi.mocked(registerPendingRecord).mockImplementation(() => {
      throw new DuplicateUrlError('https://example.com');
    });

    doPost(mockEvent({ token: 'valid-token', url: 'https://example.com' }));

    expect(ContentService.createTextOutput).toHaveBeenCalledWith(
      JSON.stringify({ success: false, message: 'This URL has already been registered' })
    );
  });

  it('Notionへの書き込みが失敗した場合はエラーを返す', () => {
    vi.mocked(registerPendingRecord).mockImplementation(() => {
      throw new Error('API error');
    });

    doPost(mockEvent({ token: 'valid-token', url: 'https://example.com' }));

    expect(ContentService.createTextOutput).toHaveBeenCalledWith(
      expect.stringContaining('"success":false')
    );
  });
});

describe('processPendingArticles', () => {
  it('HAS_PENDINGがない場合は何もしない', () => {
    vi.mocked(hasPendingArticles).mockReturnValue(false);

    processPendingArticles();

    expect(queryPendingRecord).not.toHaveBeenCalled();
  });

  it('HAS_PENDINGがあるが処理待ちレコードがない場合はフラグを削除する', () => {
    vi.mocked(hasPendingArticles).mockReturnValue(true);
    vi.mocked(queryPendingRecord).mockReturnValue(null);

    processPendingArticles();

    expect(clearPendingArticlesFlag).toHaveBeenCalled();
    expect(fetchArticleContent).not.toHaveBeenCalled();
  });

  it('処理待ちレコードを取得して要約して完了に更新する', () => {
    vi.mocked(hasPendingArticles).mockReturnValue(true);
    vi.mocked(queryPendingRecord)
      .mockReturnValueOnce({ id: 'page-1', url: 'https://example.com', retryCount: 0 })
      .mockReturnValueOnce(null);

    processPendingArticles();

    expect(fetchArticleContent).toHaveBeenCalledWith('https://example.com');
    expect(callGeminiAPI).toHaveBeenCalledWith(
      expect.objectContaining({
        geminiModel: 'gemini-2.5-flash',
        geminiApiKey: 'gemini-key',
        userContent: expect.stringContaining('article text'),
      })
    );
    expect(updateRecord).toHaveBeenCalledWith('page-1', mockGeminiResult, '完了', 'notion-key');
    expect(clearPendingArticlesFlag).toHaveBeenCalled();
  });

  it('処理後に残レコードがある場合はフラグを維持する', () => {
    vi.mocked(hasPendingArticles).mockReturnValue(true);
    vi.mocked(queryPendingRecord)
      .mockReturnValueOnce({ id: 'page-1', url: 'https://example.com', retryCount: 0 })
      .mockReturnValueOnce({ id: 'page-2', url: 'https://example2.com', retryCount: 0 });

    processPendingArticles();

    expect(clearPendingArticlesFlag).not.toHaveBeenCalled();
  });

  it('エラー発生時にリトライ回数がMAX未満ならインクリメントした上で例外を投げる', () => {
    vi.mocked(hasPendingArticles).mockReturnValue(true);
    vi.mocked(queryPendingRecord).mockReturnValue({
      id: 'page-1',
      url: 'https://example.com',
      retryCount: 3,
    });
    vi.mocked(fetchArticleContent).mockImplementation(() => {
      throw new Error('fetch failed');
    });

    expect(() => processPendingArticles()).toThrow('fetch failed');

    expect(incrementRetryCount).toHaveBeenCalledWith('page-1', 3, 'notion-key');
    expect(updateRecord).not.toHaveBeenCalled();
    expect(clearPendingArticlesFlag).not.toHaveBeenCalled();
  });

  it('エラー発生時にリトライ回数が4ならインクリメントした上で例外を投げる', () => {
    vi.mocked(hasPendingArticles).mockReturnValue(true);
    vi.mocked(queryPendingRecord).mockReturnValue({
      id: 'page-1',
      url: 'https://example.com',
      retryCount: 4,
    });
    vi.mocked(fetchArticleContent).mockImplementation(() => {
      throw new Error('fetch failed');
    });

    expect(() => processPendingArticles()).toThrow('fetch failed');

    expect(incrementRetryCount).toHaveBeenCalledWith('page-1', 4, 'notion-key');
    expect(updateRecord).not.toHaveBeenCalled();
  });

  it('エラー発生時にリトライ回数がMAX(5)ならエラーステータスに確定した上で例外を投げる', () => {
    vi.mocked(hasPendingArticles).mockReturnValue(true);
    vi.mocked(queryPendingRecord).mockReturnValue({
      id: 'page-1',
      url: 'https://example.com',
      retryCount: 5,
    });
    vi.mocked(fetchArticleContent).mockImplementation(() => {
      throw new Error('fetch failed');
    });

    expect(() => processPendingArticles()).toThrow('fetch failed');

    expect(updateRecord).toHaveBeenCalledWith('page-1', null, 'エラー', 'notion-key');
    expect(incrementRetryCount).not.toHaveBeenCalled();
  });

  it('Gemini APIが失敗した場合もリトライ回数に基づいてエラー制御した上で例外を投げる', () => {
    vi.mocked(hasPendingArticles).mockReturnValue(true);
    vi.mocked(queryPendingRecord).mockReturnValue({
      id: 'page-1',
      url: 'https://example.com',
      retryCount: 5,
    });
    vi.mocked(callGeminiAPI).mockImplementation(() => {
      throw new Error('Gemini error');
    });

    expect(() => processPendingArticles()).toThrow('Gemini error');

    expect(updateRecord).toHaveBeenCalledWith('page-1', null, 'エラー', 'notion-key');
  });

  it('エラーステータス更新が失敗しても元のエラーを投げる', () => {
    vi.mocked(hasPendingArticles).mockReturnValue(true);
    vi.mocked(queryPendingRecord).mockReturnValue({
      id: 'page-1',
      url: 'https://example.com',
      retryCount: 5,
    });
    vi.mocked(fetchArticleContent).mockImplementation(() => {
      throw new Error('fetch failed');
    });
    vi.mocked(updateRecord).mockImplementation(() => {
      throw new Error('notion update failed');
    });

    expect(() => processPendingArticles()).toThrow('fetch failed');
  });

  it('リトライ回数インクリメントが失敗しても元のエラーを投げる', () => {
    vi.mocked(hasPendingArticles).mockReturnValue(true);
    vi.mocked(queryPendingRecord).mockReturnValue({
      id: 'page-1',
      url: 'https://example.com',
      retryCount: 0,
    });
    vi.mocked(fetchArticleContent).mockImplementation(() => {
      throw new Error('fetch failed');
    });
    vi.mocked(incrementRetryCount).mockImplementation(() => {
      throw new Error('notion update failed');
    });

    expect(() => processPendingArticles()).toThrow('fetch failed');
  });
});

describe('processTrendingQiita', () => {
  it('フィード取得に失敗した場合は例外を投げる', () => {
    vi.mocked(fetchQiitaTrendUrls).mockImplementation(() => {
      throw new Error('fetch failed');
    });

    expect(() => processTrendingQiita()).toThrow('fetch failed');

    expect(registerPendingRecord).not.toHaveBeenCalled();
  });

  it('取得したURLをそれぞれNotionに仮登録する', () => {
    vi.mocked(fetchQiitaTrendUrls).mockReturnValue([
      'https://qiita.com/article1',
      'https://qiita.com/article2',
    ]);

    processTrendingQiita();

    expect(registerPendingRecord).toHaveBeenCalledWith(
      'https://qiita.com/article1',
      'db-id',
      'notion-key'
    );
    expect(registerPendingRecord).toHaveBeenCalledWith(
      'https://qiita.com/article2',
      'db-id',
      'notion-key'
    );
  });

  it('URLが0件の場合はNotionに書き込まずHAS_PENDINGもセットしない', () => {
    vi.mocked(fetchQiitaTrendUrls).mockReturnValue([]);

    processTrendingQiita();

    expect(registerPendingRecord).not.toHaveBeenCalled();
  });

  it('1件の登録が失敗しても残りのURLは処理した上で例外を投げる', () => {
    vi.mocked(fetchQiitaTrendUrls).mockReturnValue([
      'https://qiita.com/article1',
      'https://qiita.com/article2',
    ]);
    vi.mocked(registerPendingRecord)
      .mockImplementationOnce(() => {
        throw new Error('notion error');
      })
      .mockReturnValueOnce('page-id');

    expect(() => processTrendingQiita()).toThrow();

    expect(registerPendingRecord).toHaveBeenCalledTimes(2);
  });

  it('登録済みURLはスキップして未登録URLのみ登録する', () => {
    vi.mocked(fetchQiitaTrendUrls).mockReturnValue([
      'https://qiita.com/article1',
      'https://qiita.com/article2',
    ]);
    vi.mocked(registerPendingRecord)
      .mockImplementationOnce(() => {
        throw new DuplicateUrlError('https://qiita.com/article1');
      })
      .mockReturnValueOnce('page-id');

    processTrendingQiita();

    expect(registerPendingRecord).toHaveBeenCalledTimes(2);
  });
});

describe('processTrendingZenn', () => {
  it('フィード取得に失敗した場合は例外を投げる', () => {
    vi.mocked(fetchZennTrendUrls).mockImplementation(() => {
      throw new Error('fetch failed');
    });

    expect(() => processTrendingZenn()).toThrow('fetch failed');

    expect(registerPendingRecord).not.toHaveBeenCalled();
  });

  it('取得したURLをそれぞれNotionに仮登録する', () => {
    vi.mocked(fetchZennTrendUrls).mockReturnValue([
      'https://zenn.dev/article1',
      'https://zenn.dev/article2',
    ]);

    processTrendingZenn();

    expect(registerPendingRecord).toHaveBeenCalledWith(
      'https://zenn.dev/article1',
      'db-id',
      'notion-key'
    );
    expect(registerPendingRecord).toHaveBeenCalledWith(
      'https://zenn.dev/article2',
      'db-id',
      'notion-key'
    );
  });

  it('URLが0件の場合はNotionに書き込まずHAS_PENDINGもセットしない', () => {
    vi.mocked(fetchZennTrendUrls).mockReturnValue([]);

    processTrendingZenn();

    expect(registerPendingRecord).not.toHaveBeenCalled();
  });

  it('1件の登録が失敗しても残りのURLは処理した上で例外を投げる', () => {
    vi.mocked(fetchZennTrendUrls).mockReturnValue([
      'https://zenn.dev/article1',
      'https://zenn.dev/article2',
    ]);
    vi.mocked(registerPendingRecord)
      .mockImplementationOnce(() => {
        throw new Error('notion error');
      })
      .mockReturnValueOnce('page-id');

    expect(() => processTrendingZenn()).toThrow();

    expect(registerPendingRecord).toHaveBeenCalledTimes(2);
  });
});
