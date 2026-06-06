import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./config');
vi.mock('./gemini');
vi.mock('./jina');
vi.mock('./notion');
vi.mock('./trend');

import { clearHasPending, getConfig, hasPending, setHasPending } from './config';
import type { GeminiResult } from './gemini';
import { callGeminiAPI } from './gemini';
import { doPost, processPendingArticles, processTrendingQiita, processTrendingZenn } from './index';
import { fetchArticleContent } from './jina';
import { createPendingRecord, DuplicateUrlError, queryPendingRecord, updateRecord } from './notion';
import { fetchQiitaTrendUrls, fetchZennTrendUrls } from './trend';

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
  vi.mocked(getConfig).mockReturnValue({
    secretToken: 'valid-token',
    geminiApiKey: 'gemini-key',
    geminiModel: 'gemini-2.5-flash',
    notionAccessToken: 'notion-key',
    notionDbId: 'db-id',
  });
  vi.mocked(createPendingRecord).mockReturnValue('page-id');
  vi.mocked(queryPendingRecord).mockReturnValue(null);
  vi.mocked(fetchArticleContent).mockReturnValue('article text');
  vi.mocked(callGeminiAPI).mockReturnValue(mockGeminiResult);
  vi.mocked(hasPending).mockReturnValue(false);
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

    expect(createPendingRecord).toHaveBeenCalledWith('https://example.com', 'db-id', 'notion-key');
    expect(setHasPending).toHaveBeenCalled();
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

    expect(createPendingRecord).toHaveBeenCalledWith(
      'https://example.com/article',
      'db-id',
      'notion-key'
    );
  });

  it('登録済みURLの場合はHAS_PENDINGをセットせずduplicateを返す', () => {
    vi.mocked(createPendingRecord).mockImplementation(() => {
      throw new DuplicateUrlError('https://example.com');
    });

    doPost(mockEvent({ token: 'valid-token', url: 'https://example.com' }));

    expect(setHasPending).not.toHaveBeenCalled();
    expect(ContentService.createTextOutput).toHaveBeenCalledWith(
      JSON.stringify({ success: false, message: 'This URL has already been registered' })
    );
  });

  it('Notionへの書き込みが失敗した場合はエラーを返す', () => {
    vi.mocked(createPendingRecord).mockImplementation(() => {
      throw new Error('API error');
    });

    doPost(mockEvent({ token: 'valid-token', url: 'https://example.com' }));

    expect(ContentService.createTextOutput).toHaveBeenCalledWith(
      expect.stringContaining('"success":false')
    );
    expect(setHasPending).not.toHaveBeenCalled();
  });
});

describe('processPendingArticles', () => {
  it('HAS_PENDINGがない場合は何もしない', () => {
    vi.mocked(hasPending).mockReturnValue(false);

    processPendingArticles();

    expect(queryPendingRecord).not.toHaveBeenCalled();
  });

  it('HAS_PENDINGがあるが処理中レコードがない場合はフラグを削除する', () => {
    vi.mocked(hasPending).mockReturnValue(true);
    vi.mocked(queryPendingRecord).mockReturnValue(null);

    processPendingArticles();

    expect(clearHasPending).toHaveBeenCalled();
    expect(fetchArticleContent).not.toHaveBeenCalled();
  });

  it('処理中レコードを取得して要約して完了に更新する', () => {
    vi.mocked(hasPending).mockReturnValue(true);
    vi.mocked(queryPendingRecord)
      .mockReturnValueOnce({ id: 'page-1', url: 'https://example.com' })
      .mockReturnValueOnce(null);

    processPendingArticles();

    expect(fetchArticleContent).toHaveBeenCalledWith('https://example.com');
    expect(callGeminiAPI).toHaveBeenCalledWith('article text', 'gemini-2.5-flash', 'gemini-key');
    expect(updateRecord).toHaveBeenCalledWith('page-1', mockGeminiResult, '完了', 'notion-key');
    expect(clearHasPending).toHaveBeenCalled();
  });

  it('処理後に残レコードがある場合はフラグを維持する', () => {
    vi.mocked(hasPending).mockReturnValue(true);
    vi.mocked(queryPendingRecord)
      .mockReturnValueOnce({ id: 'page-1', url: 'https://example.com' })
      .mockReturnValueOnce({ id: 'page-2', url: 'https://example2.com' });

    processPendingArticles();

    expect(clearHasPending).not.toHaveBeenCalled();
  });

  it('記事取得に失敗した場合はエラーステータスに更新する', () => {
    vi.mocked(hasPending).mockReturnValue(true);
    vi.mocked(queryPendingRecord).mockReturnValue({ id: 'page-1', url: 'https://example.com' });
    vi.mocked(fetchArticleContent).mockImplementation(() => {
      throw new Error('fetch failed');
    });

    processPendingArticles();

    expect(updateRecord).toHaveBeenCalledWith('page-1', null, 'エラー', 'notion-key');
    expect(clearHasPending).not.toHaveBeenCalled();
  });

  it('Gemini APIが失敗した場合はエラーステータスに更新する', () => {
    vi.mocked(hasPending).mockReturnValue(true);
    vi.mocked(queryPendingRecord).mockReturnValue({ id: 'page-1', url: 'https://example.com' });
    vi.mocked(callGeminiAPI).mockImplementation(() => {
      throw new Error('Gemini error');
    });

    processPendingArticles();

    expect(updateRecord).toHaveBeenCalledWith('page-1', null, 'エラー', 'notion-key');
  });
});

describe('processTrendingQiita', () => {
  it('フィード取得に失敗した場合は何もしない', () => {
    vi.mocked(fetchQiitaTrendUrls).mockImplementation(() => {
      throw new Error('fetch failed');
    });

    processTrendingQiita();

    expect(createPendingRecord).not.toHaveBeenCalled();
  });

  it('取得したURLをそれぞれNotionに仮登録する', () => {
    vi.mocked(fetchQiitaTrendUrls).mockReturnValue([
      'https://qiita.com/article1',
      'https://qiita.com/article2',
    ]);

    processTrendingQiita();

    expect(createPendingRecord).toHaveBeenCalledWith(
      'https://qiita.com/article1',
      'db-id',
      'notion-key'
    );
    expect(createPendingRecord).toHaveBeenCalledWith(
      'https://qiita.com/article2',
      'db-id',
      'notion-key'
    );
    expect(setHasPending).toHaveBeenCalled();
  });

  it('URLが0件の場合はNotionに書き込まずHAS_PENDINGもセットしない', () => {
    vi.mocked(fetchQiitaTrendUrls).mockReturnValue([]);

    processTrendingQiita();

    expect(createPendingRecord).not.toHaveBeenCalled();
    expect(setHasPending).not.toHaveBeenCalled();
  });

  it('1件の登録が失敗しても残りのURLは処理する', () => {
    vi.mocked(fetchQiitaTrendUrls).mockReturnValue([
      'https://qiita.com/article1',
      'https://qiita.com/article2',
    ]);
    vi.mocked(createPendingRecord)
      .mockImplementationOnce(() => {
        throw new Error('notion error');
      })
      .mockReturnValueOnce('page-id');

    processTrendingQiita();

    expect(createPendingRecord).toHaveBeenCalledTimes(2);
    expect(setHasPending).toHaveBeenCalled();
  });

  it('登録済みURLはスキップして未登録URLのみ登録する', () => {
    vi.mocked(fetchQiitaTrendUrls).mockReturnValue([
      'https://qiita.com/article1',
      'https://qiita.com/article2',
    ]);
    vi.mocked(createPendingRecord)
      .mockImplementationOnce(() => {
        throw new DuplicateUrlError('https://qiita.com/article1');
      })
      .mockReturnValueOnce('page-id');

    processTrendingQiita();

    expect(createPendingRecord).toHaveBeenCalledTimes(2);
    expect(setHasPending).toHaveBeenCalled();
  });
});

describe('processTrendingZenn', () => {
  it('フィード取得に失敗した場合は何もしない', () => {
    vi.mocked(fetchZennTrendUrls).mockImplementation(() => {
      throw new Error('fetch failed');
    });

    processTrendingZenn();

    expect(createPendingRecord).not.toHaveBeenCalled();
  });

  it('取得したURLをそれぞれNotionに仮登録する', () => {
    vi.mocked(fetchZennTrendUrls).mockReturnValue([
      'https://zenn.dev/article1',
      'https://zenn.dev/article2',
    ]);

    processTrendingZenn();

    expect(createPendingRecord).toHaveBeenCalledWith(
      'https://zenn.dev/article1',
      'db-id',
      'notion-key'
    );
    expect(createPendingRecord).toHaveBeenCalledWith(
      'https://zenn.dev/article2',
      'db-id',
      'notion-key'
    );
    expect(setHasPending).toHaveBeenCalled();
  });

  it('URLが0件の場合はNotionに書き込まずHAS_PENDINGもセットしない', () => {
    vi.mocked(fetchZennTrendUrls).mockReturnValue([]);

    processTrendingZenn();

    expect(createPendingRecord).not.toHaveBeenCalled();
    expect(setHasPending).not.toHaveBeenCalled();
  });

  it('1件の登録が失敗しても残りのURLは処理する', () => {
    vi.mocked(fetchZennTrendUrls).mockReturnValue([
      'https://zenn.dev/article1',
      'https://zenn.dev/article2',
    ]);
    vi.mocked(createPendingRecord)
      .mockImplementationOnce(() => {
        throw new Error('notion error');
      })
      .mockReturnValueOnce('page-id');

    processTrendingZenn();

    expect(createPendingRecord).toHaveBeenCalledTimes(2);
    expect(setHasPending).toHaveBeenCalled();
  });
});
