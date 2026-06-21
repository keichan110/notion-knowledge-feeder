import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetConfigCache } from '../../lib/config';
import { getDigestWindow, parseFrom, runGmailDigest } from '.';

const SLACK_URL = 'https://slack.com/api/chat.postMessage';

const digestSummaryFixture = {
  actionItems: [{ subject: 'Subject 1', reason: '明日までに回答が必要' }],
  categories: [
    { label: 'AI/ML', count: 1 },
    { label: 'イベント案内', count: 1 },
  ],
  overview: '前日のNewsletterはAI関連とイベント案内が中心でした。',
};

const mockResponse = (body: object) => ({
  getResponseCode: vi.fn().mockReturnValue(200),
  getContentText: vi.fn().mockReturnValue(JSON.stringify(body)),
});

beforeEach(() => {
  resetConfigCache();
  vi.mocked(PropertiesService.getScriptProperties().getProperties).mockReset().mockReturnValue({
    SLACK_BOT_TOKEN: 'xoxb-test',
    SLACK_CHANNEL_ID: 'C123456',
    GEMINI_API_KEY: 'gemini-key',
    GEMINI_MODEL: 'gemini-3.1-flash-lite',
  });
  vi.mocked(UrlFetchApp.fetch)
    .mockReset()
    .mockImplementation((url) => {
      if (String(url).includes('generativelanguage')) {
        return mockResponse({
          candidates: [{ content: { parts: [{ text: JSON.stringify(digestSummaryFixture) }] } }],
        }) as never;
      }
      return mockResponse({ ok: true, ts: '123.456' }) as never;
    });
  vi.mocked(GmailApp.search).mockReset().mockReturnValue([]);
});

describe('getDigestWindow', () => {
  it('UTC 2026-01-02T05:00:00ZではJST前日7時から当日7時の範囲を返す', () => {
    expect(getDigestWindow(new Date('2026-01-02T05:00:00Z'))).toEqual({
      after: 1767218400,
      before: 1767304800,
      dateLabel: '2026/01/01',
    });
  });

  it('JST 23:59:59では同じJST日の前日7時から当日7時の範囲を返す', () => {
    expect(getDigestWindow(new Date('2026-01-02T14:59:59Z'))).toEqual({
      after: 1767218400,
      before: 1767304800,
      dateLabel: '2026/01/01',
    });
  });

  it('JST 翌0:00では翌日の前日7時から当日7時の範囲を返す', () => {
    expect(getDigestWindow(new Date('2026-01-02T15:00:00Z'))).toEqual({
      after: 1767304800,
      before: 1767391200,
      dateLabel: '2026/01/02',
    });
  });
});

describe('parseFrom', () => {
  it('表示名とメールアドレスを分離する', () => {
    expect(parseFrom('Sender Name <sender@example.com>')).toEqual({
      name: 'Sender Name',
      email: 'sender@example.com',
    });
  });

  it('山括弧がない場合は全体をメールアドレスとして返す', () => {
    expect(parseFrom('sender@example.com')).toEqual({
      name: '',
      email: 'sender@example.com',
    });
  });

  it('表示名前後のダブルクォートを除去する', () => {
    expect(parseFrom('"Sender Name" <sender@example.com>')).toEqual({
      name: 'Sender Name',
      email: 'sender@example.com',
    });
  });
});

describe('runGmailDigest', () => {
  it('2件のNewsletterスレッドを親1回とスレッド返信1回でSlackに投稿する', () => {
    vi.mocked(GmailApp.search).mockReturnValue([
      createThread('Subject 1', '"Sender One" <sender1@example.com>', '本文1', 'https://mail/1'),
      createThread('Subject 2', 'sender2@example.com', '本文2', 'https://mail/2'),
    ]);

    runGmailDigest();

    expect(GmailApp.search).toHaveBeenCalledWith(
      expect.stringMatching(/^label:newsletter after:\d+ before:\d+$/)
    );
    expect(getGeminiCalls()).toHaveLength(1);
    expect(getSlackCalls()).toHaveLength(2);

    const parentPayload = getSlackPayload(0);
    expect(parentPayload.text).toMatch(/^📬 \d{4}\/\d{2}\/\d{2} のメールダイジェスト\n2件$/);
    expect(parentPayload.text).toContain('2件');
    expect(JSON.stringify(parentPayload.blocks)).toContain('⚠️ 対応が必要');
    expect(JSON.stringify(parentPayload.blocks)).toContain('📊 種類別');
    expect(JSON.stringify(parentPayload.blocks)).toContain('📝 まとめ');
    expect(JSON.stringify(parentPayload.blocks)).toContain(digestSummaryFixture.overview);

    const replyPayload = getSlackPayload(1);
    expect(replyPayload.thread_ts).toBe('123.456');
    expect(replyPayload.text).toMatch(
      /^📬 \d{4}\/\d{2}\/\d{2} のメールダイジェスト 詳細: Subject 1, Subject 2$/
    );
    expect(replyPayload.blocks?.slice(0, 3)).toEqual([
      {
        type: 'context',
        elements: [{ type: 'mrkdwn', text: '*Sender One* &lt;sender1@example.com&gt;' }],
      },
      expect.objectContaining({ type: 'section' }),
      { type: 'divider' },
    ]);
    expect(JSON.stringify(replyPayload.blocks)).toContain('Subject 1');
    expect(JSON.stringify(replyPayload.blocks)).toContain('Sender One');
    expect(JSON.stringify(replyPayload.blocks)).toContain('sender1@example.com');
    expect(JSON.stringify(replyPayload.blocks)).toContain('https://mail/1');
    expect(JSON.stringify(replyPayload.blocks)).toContain('メールを開く');
    expect(JSON.stringify(replyPayload.blocks)).not.toContain('本文1');
  });

  it('11件のNewsletterスレッドを親1回とスレッド返信2回にチャンク分割する', () => {
    vi.mocked(GmailApp.search).mockReturnValue(
      Array.from({ length: 11 }, (_, i) =>
        createThread(
          `Subject ${i + 1}`,
          `sender${i + 1}@example.com`,
          `本文${i + 1}`,
          `https://mail/${i + 1}`
        )
      )
    );

    runGmailDigest();

    expect(getGeminiCalls()).toHaveLength(1);
    expect(getSlackCalls()).toHaveLength(3);
    expect(getSlackPayload(1).thread_ts).toBe('123.456');
    expect(getSlackPayload(2).thread_ts).toBe('123.456');
    expect(getSlackPayload(1).blocks).toHaveLength(30);
    expect(getSlackPayload(2).blocks).toHaveLength(3);
  });

  it('Newsletterスレッドが0件の場合は親のみ投稿してスレッド返信しない', () => {
    vi.mocked(GmailApp.search).mockReturnValue([]);

    runGmailDigest();

    expect(getGeminiCalls()).toHaveLength(0);
    expect(getSlackCalls()).toHaveLength(1);
    const payload = getSlackPayload(0);
    expect(payload.text).toMatch(
      /^📬 \d{4}\/\d{2}\/\d{2} のメールダイジェスト\nメールは届きませんでした$/
    );
    expect(payload.thread_ts).toBeUndefined();
  });
});

function createThread(
  subject: string,
  from: string,
  body = '',
  permalink = 'https://mail/default'
): GoogleAppsScript.Gmail.GmailThread {
  return {
    getPermalink: vi.fn().mockReturnValue(permalink),
    getMessages: vi.fn().mockReturnValue([
      {
        getSubject: vi.fn().mockReturnValue(subject),
        getFrom: vi.fn().mockReturnValue(from),
        getPlainBody: vi.fn().mockReturnValue(body),
      },
    ]),
  } as unknown as GoogleAppsScript.Gmail.GmailThread;
}

function getSlackPayload(index: number): {
  text: string;
  blocks?: unknown[];
  thread_ts?: string;
} {
  const [, options] = getSlackCalls()[index];
  return JSON.parse((options as { payload: string }).payload);
}

function getSlackCalls() {
  return vi.mocked(UrlFetchApp.fetch).mock.calls.filter(([url]) => String(url) === SLACK_URL);
}

function getGeminiCalls() {
  return vi
    .mocked(UrlFetchApp.fetch)
    .mock.calls.filter(([url]) => String(url).includes('generativelanguage'));
}
