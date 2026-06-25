import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetConfigCache } from '../../lib/config';
import { getSummaryWindow, runWeeklyNotionSummary } from '.';

const SLACK_URL = 'https://slack.com/api/chat.postMessage';
const NOTION_QUERY_MATCH = '/databases/';

const mockResponse = (body: object) => ({
  getResponseCode: vi.fn().mockReturnValue(200),
  getContentText: vi.fn().mockReturnValue(JSON.stringify(body)),
});

const notionPage = (title: string, category: string, tags: string[]) => ({
  properties: {
    タイトル: { title: [{ plain_text: title }] },
    カテゴリー: { select: { name: category } },
    タグ: { multi_select: tags.map((name) => ({ name })) },
  },
});

let notionPages: object[][];

beforeEach(() => {
  resetConfigCache();
  notionPages = [];
  vi.mocked(PropertiesService.getScriptProperties().getProperties).mockReset().mockReturnValue({
    NOTION_ACCESS_TOKEN: 'notion-token',
    NOTION_DB_ID: 'db-id',
    SLACK_BOT_TOKEN: 'xoxb-test',
    SLACK_CHANNEL_ID: 'C123456',
  });
  vi.mocked(UrlFetchApp.fetch)
    .mockReset()
    .mockImplementation((url) => {
      if (String(url).includes(NOTION_QUERY_MATCH)) {
        const page = notionPages.shift() ?? [];
        const hasMore = notionPages.length > 0;
        return mockResponse({
          results: page,
          has_more: hasMore,
          next_cursor: hasMore ? 'cursor-next' : null,
        }) as never;
      }
      return mockResponse({ ok: true, ts: '123.456' }) as never;
    });
});

describe('getSummaryWindow', () => {
  it('日曜14:00ちょうどでは先週日14:00〜今週日14:00を返す', () => {
    expect(getSummaryWindow(new Date('2026-06-28T05:00:00Z'))).toEqual({
      onOrAfter: '2026-06-21T05:00:00.000Z',
      before: '2026-06-28T05:00:00.000Z',
      label: '2026/06/21 〜 2026/06/28',
    });
  });

  it('週中（水曜）では直近の日曜14:00を上限とした前週ウィンドウを返す', () => {
    expect(getSummaryWindow(new Date('2026-06-24T01:00:00Z'))).toEqual({
      onOrAfter: '2026-06-14T05:00:00.000Z',
      before: '2026-06-21T05:00:00.000Z',
      label: '2026/06/14 〜 2026/06/21',
    });
  });

  it('日曜14:00より前は前週ウィンドウに属する', () => {
    expect(getSummaryWindow(new Date('2026-06-28T04:00:00Z'))).toEqual({
      onOrAfter: '2026-06-14T05:00:00.000Z',
      before: '2026-06-21T05:00:00.000Z',
      label: '2026/06/14 〜 2026/06/21',
    });
  });

  it('年・月跨ぎでも先週日14:00〜今週日14:00を返す', () => {
    expect(getSummaryWindow(new Date('2026-01-04T05:00:00Z'))).toEqual({
      onOrAfter: '2025-12-28T05:00:00.000Z',
      before: '2026-01-04T05:00:00.000Z',
      label: '2025/12/28 〜 2026/01/04',
    });
  });
});

describe('runWeeklyNotionSummary', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-28T05:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('対象0件のときはGeminiを呼ばず「対象なし」を1メッセージ投稿する', () => {
    notionPages = [[]];

    runWeeklyNotionSummary();

    expect(getGeminiCalls()).toHaveLength(0);
    expect(getSlackCalls()).toHaveLength(1);
    const payload = getSlackPayload(0);
    expect(payload.text).toContain('今週は対象記事がありませんでした');
    expect(JSON.stringify(payload.blocks)).toContain('今週は対象記事がありませんでした');
    expect(payload.thread_ts).toBeUndefined();
  });

  it('対象1件以上のときはヘッダー＋総件数を1メッセージ投稿する', () => {
    notionPages = [
      [notionPage('記事A', 'AI', ['Claude', 'RAG']), notionPage('記事B', 'Web', ['TypeScript'])],
    ];

    runWeeklyNotionSummary();

    expect(getGeminiCalls()).toHaveLength(0);
    expect(getSlackCalls()).toHaveLength(1);
    const payload = getSlackPayload(0);
    expect(payload.text).toContain('2件の記事がまとまりました');
    expect(payload.blocks).toMatchObject([
      {
        type: 'header',
        level: 1,
        text: { type: 'plain_text', text: '📊 週次サマリー 2026/06/21 〜 2026/06/28' },
      },
      {
        type: 'rich_text',
        elements: [
          {
            type: 'rich_text_section',
            elements: [
              { type: 'text', text: '2', style: { bold: true } },
              { type: 'text', text: ' 件の記事がまとまりました' },
            ],
          },
        ],
      },
    ]);
  });

  it('完了レコードをページネーション込みで全件取得し、ステータス=完了で絞り込む', () => {
    notionPages = [
      [notionPage('記事1', 'AI', ['Claude'])],
      [notionPage('記事2', 'Web', ['TypeScript']), notionPage('記事3', 'AI', ['RAG'])],
    ];

    runWeeklyNotionSummary();

    const notionCalls = getNotionCalls();
    expect(notionCalls).toHaveLength(2);

    const firstQuery = getNotionPayload(0);
    expect(firstQuery.filter.and).toContainEqual({
      property: 'ステータス',
      select: { equals: '完了' },
    });
    expect(firstQuery.filter.and).toContainEqual({
      timestamp: 'created_time',
      created_time: { on_or_after: '2026-06-21T05:00:00.000Z' },
    });
    expect(firstQuery.filter.and).toContainEqual({
      timestamp: 'created_time',
      created_time: { before: '2026-06-28T05:00:00.000Z' },
    });
    expect(firstQuery.start_cursor).toBeUndefined();
    expect(getNotionPayload(1).start_cursor).toBe('cursor-next');

    const payload = getSlackPayload(0);
    expect(payload.text).toContain('3件の記事がまとまりました');
  });
});

function getSlackPayload(index: number): {
  text: string;
  blocks?: unknown[];
  thread_ts?: string;
} {
  const [, options] = getSlackCalls()[index];
  return JSON.parse((options as { payload: string }).payload);
}

function getNotionPayload(index: number): {
  filter: { and: unknown[] };
  start_cursor?: string;
} {
  const [, options] = getNotionCalls()[index];
  return JSON.parse((options as { payload: string }).payload);
}

function getSlackCalls() {
  return vi.mocked(UrlFetchApp.fetch).mock.calls.filter(([url]) => String(url) === SLACK_URL);
}

function getNotionCalls() {
  return vi
    .mocked(UrlFetchApp.fetch)
    .mock.calls.filter(([url]) => String(url).includes(NOTION_QUERY_MATCH));
}

function getGeminiCalls() {
  return vi
    .mocked(UrlFetchApp.fetch)
    .mock.calls.filter(([url]) => String(url).includes('generativelanguage'));
}
