import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetConfigCache } from '../../lib/config';
import { buildSummaryMessage, getSummaryWindow, rankTopics, runWeeklyNotionSummary } from '.';
import type { TrendCluster } from './gemini';

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

const record = (tags: string[]) => ({ title: '', category: '', tags });
const cluster = (label: string, memberTags: string[]): TrendCluster => ({ label, memberTags });

let notionPages: object[][];
let geminiTrend: { summary: string; topics: TrendCluster[] };

beforeEach(() => {
  resetConfigCache();
  notionPages = [];
  geminiTrend = { summary: '今週の総括', topics: [] };
  vi.mocked(PropertiesService.getScriptProperties().getProperties).mockReset().mockReturnValue({
    NOTION_ACCESS_TOKEN: 'notion-token',
    NOTION_DB_ID: 'db-id',
    SLACK_BOT_TOKEN: 'xoxb-test',
    SLACK_CHANNEL_ID: 'C123456',
    GEMINI_API_KEY: 'gemini-key',
    GEMINI_MODEL: 'gemini-3.1-flash-lite',
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
      if (String(url).includes('generativelanguage')) {
        return mockResponse({
          candidates: [{ content: { parts: [{ text: JSON.stringify(geminiTrend) }] } }],
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

describe('rankTopics', () => {
  it('件数1を除外し、件数2以上を降順・重複カウントで集計する', () => {
    const records = [record(['A', 'B']), record(['A', 'B']), record(['A']), record(['C'])];
    const clusters = [cluster('A', ['A']), cluster('B', ['B']), cluster('C', ['C'])];

    expect(rankTopics(records, clusters)).toEqual([
      { label: 'A', count: 3, memberTags: ['A'] },
      { label: 'B', count: 2, memberTags: ['B'] },
    ]);
  });

  it('表記揺れタグを名寄せして1クラスタで集計する', () => {
    const records = [record(['Claude', 'RAG']), record(['claude', 'Claude Code'])];
    const clusters = [cluster('Claude系', ['Claude', 'claude', 'Claude Code'])];

    expect(rankTopics(records, clusters)).toEqual([
      { label: 'Claude系', count: 2, memberTags: ['Claude', 'claude', 'Claude Code'] },
    ]);
  });

  it('同点は入力順を保つ', () => {
    const records = [record(['A']), record(['A']), record(['B']), record(['B'])];
    const clusters = [cluster('first', ['A']), cluster('second', ['B'])];

    expect(rankTopics(records, clusters).map((topic) => topic.label)).toEqual(['first', 'second']);
  });

  it('件数2以上が9件あっても最大8件に絞る', () => {
    const records: ReturnType<typeof record>[] = [];
    const clusters: TrendCluster[] = [];
    for (let i = 0; i < 9; i++) {
      records.push(record([`T${i}`]), record([`T${i}`]));
      clusters.push(cluster(`T${i}`, [`T${i}`]));
    }

    expect(rankTopics(records, clusters)).toHaveLength(8);
  });
});

describe('buildSummaryMessage', () => {
  const window = {
    onOrAfter: '2026-06-21T05:00:00.000Z',
    before: '2026-06-28T05:00:00.000Z',
    label: '2026/06/21 〜 2026/06/28',
  };

  it('総括と🔥トレンドトピック（代表ラベル・件数・構成タグ）を含む', () => {
    const message = buildSummaryMessage(window, 3, '今週の総括文', [
      { label: 'RAG / 検索拡張生成', count: 2, memberTags: ['RAG', '検索拡張生成'] },
    ]);

    const json = JSON.stringify(message.blocks);
    expect(json).toContain('今週の総括文');
    expect(json).toContain('🔥 今週のトレンドトピック');
    expect(json).toContain('RAG / 検索拡張生成');
    expect(json).toContain('(2件)');
    expect(json).toContain('検索拡張生成');
  });

  it('突出トピックが無いときは専用メッセージと総括を表示する', () => {
    const message = buildSummaryMessage(window, 3, '静かな週でした', []);

    const json = JSON.stringify(message.blocks);
    expect(json).toContain('今週は突出したトピックはありませんでした');
    expect(json).toContain('静かな週でした');
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

  it('通常パスは1回Geminiを呼び、総括＋トレンドトピックを1メッセージ投稿する', () => {
    notionPages = [
      [
        notionPage('記事A', 'AI', ['Claude', 'RAG']),
        notionPage('記事B', 'AI', ['claude', 'Claude Code']),
      ],
    ];
    geminiTrend = {
      summary: '今週はLLM周辺が活発でした',
      topics: [cluster('Claude系', ['Claude', 'claude', 'Claude Code'])],
    };

    runWeeklyNotionSummary();

    expect(getGeminiCalls()).toHaveLength(1);
    expect(getSlackCalls()).toHaveLength(1);
    const payload = getSlackPayload(0);
    expect(payload.text).toContain('2件の記事がまとまりました');
    const json = JSON.stringify(payload.blocks);
    expect(json).toContain('今週はLLM周辺が活発でした');
    expect(json).toContain('🔥 今週のトレンドトピック');
    expect(json).toContain('Claude系');
    expect(json).toContain('(2件)');
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
