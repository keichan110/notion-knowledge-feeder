import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetConfigCache } from '../../lib/config';
import { getDigestWindow, parseFrom, runGmailDigest, truncateBody } from '.';

const SLACK_URL = 'https://slack.com/api/chat.postMessage';
const PAGE_SIZE = 5;
const MAX_SUMMARY_NEWSLETTERS = 70;

const geminiSummariesFixture = {
  summaries: Array.from({ length: PAGE_SIZE }, () => ({
    headline: 'AIが生成したタイトル',
    points: ['ポイント1', 'ポイント2'],
  })),
};

const mockResponse = (body: object) => ({
  getResponseCode: vi.fn().mockReturnValue(200),
  getContentText: vi.fn().mockReturnValue(JSON.stringify(body)),
});

beforeEach(() => {
  resetConfigCache();
  vi.mocked(PropertiesService.getScriptProperties().getProperties).mockReset().mockReturnValue({
    SLACK_BOT_TOKEN: 'xoxb-test',
    SLACK_NOTIFY_CHANNEL_ID: 'C123456',
    GEMINI_API_KEY: 'gemini-key',
    GEMINI_MODEL: 'gemini-3.1-flash-lite',
    DLP_PROJECT_ID: 'dlp-project',
  });
  vi.mocked(UrlFetchApp.fetch)
    .mockReset()
    .mockImplementation((url, options) => {
      if (String(url).includes('dlp.googleapis.com')) {
        const payload = JSON.parse(String((options as { payload: string }).payload));
        return mockResponse({ item: { value: `[DLP]${payload.item.value}` } }) as never;
      }
      if (String(url).includes('generativelanguage')) {
        return mockResponse({
          candidates: [{ content: { parts: [{ text: JSON.stringify(geminiSummariesFixture) }] } }],
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

describe('truncateBody', () => {
  it('200字以下の本文はそのまま返す', () => {
    expect(truncateBody('短い本文')).toBe('短い本文');
  });

  it('最大文字数を超える本文は省略記号付きで切り詰める', () => {
    expect(truncateBody('あ'.repeat(201))).toBe(`${'あ'.repeat(200)}…`);
  });

  it('ホワイトスペースを正規化する', () => {
    expect(truncateBody('  A\n\nB\t C  ')).toBe('A B C');
  });

  it('maxLen指定で切り詰める', () => {
    expect(truncateBody('abcdef', 3)).toBe('abc…');
  });
});

describe('runGmailDigest', () => {
  it('2件のNewsletterスレッドをGemini 1回と親1回とページ返信1回でSlackに投稿する', () => {
    vi.mocked(GmailApp.search).mockReturnValue([
      createThread(
        'Subject 1',
        '"Sender One" <sender1@example.com>',
        '本文1 https://example.com/?token=secret user@example.com',
        'https://mail/1'
      ),
      createThread('Subject 2', 'sender2@example.com', '本文2', 'https://mail/2'),
    ]);

    runGmailDigest();

    expect(GmailApp.search).toHaveBeenCalledWith(
      expect.stringMatching(/^label:newsletter after:\d+ before:\d+$/)
    );
    expect(getGeminiCalls()).toHaveLength(1);
    expect(getDlpCalls()).toHaveLength(2);
    expect(getSlackCalls()).toHaveLength(2);

    const firstDlpPayload = getDlpPayload(0);
    expect(firstDlpPayload.item.value).toContain('[リンク]');
    expect(firstDlpPayload.item.value).not.toContain('https://example.com');
    expect(firstDlpPayload.inspectConfig.infoTypes).toContainEqual({ name: 'JAPAN_PASSPORT' });
    expect(firstDlpPayload.inspectConfig.infoTypes).not.toContainEqual({ name: 'DATE' });
    expect(firstDlpPayload.inspectConfig.minLikelihood).toBe('POSSIBLE');

    const geminiUserContent = getGeminiUserContent(0);
    expect(geminiUserContent).toContain('件名: Subject 1');
    expect(geminiUserContent).toContain('送信者: "Sender One" <sender1@example.com>');
    expect(geminiUserContent).toContain('[DLP]本文1');
    expect(geminiUserContent).not.toContain('https://example.com');
    expect(geminiUserContent).not.toContain('user@example.com');

    const parentPayload = getSlackPayload(0);
    expect(parentPayload.text).toMatch(/^📬 \d{4}\/\d{2}\/\d{2}\n2件のメールが届いています$/);
    expect(parentPayload.blocks).toMatchObject([
      {
        type: 'header',
        level: 1,
        text: {
          type: 'plain_text',
          text: expect.stringMatching(/^📬 \d{4}\/\d{2}\/\d{2}$/),
        },
      },
      {
        type: 'rich_text',
        elements: [
          {
            type: 'rich_text_section',
            elements: [
              { type: 'text', text: '2', style: { bold: true } },
              { type: 'text', text: ' 件のメールが届いています' },
            ],
          },
        ],
      },
    ]);
    expect(JSON.stringify(parentPayload.blocks)).not.toContain('対応が必要');
    expect(JSON.stringify(parentPayload.blocks)).not.toContain('種類別');
    expect(JSON.stringify(parentPayload.blocks)).not.toContain('まとめ');

    const replyPayload = getSlackPayload(1);
    expect(replyPayload.thread_ts).toBe('123.456');
    expect(replyPayload.text).toMatch(
      /^📬 \d{4}\/\d{2}\/\d{2} のメールダイジェスト 詳細: Subject 1, Subject 2$/
    );
    expect(JSON.stringify(replyPayload.blocks)).toContain('AIが生成したタイトル');
    expect(JSON.stringify(replyPayload.blocks)).toContain('ポイント1');
    expect(JSON.stringify(replyPayload.blocks)).toContain('Subject 1');
    expect(JSON.stringify(replyPayload.blocks)).toContain('Sender One');
    expect(JSON.stringify(replyPayload.blocks)).toContain('sender1@example.com');
    expect(JSON.stringify(replyPayload.blocks)).toContain('https://mail/1');
    expect(JSON.stringify(replyPayload.blocks)).toContain('メールを開く');
    expect(JSON.stringify(replyPayload.blocks)).not.toContain('本文1');
  });

  it('6件のNewsletterスレッドを2ページに分けてGeminiとSlackに投稿する', () => {
    vi.mocked(GmailApp.search).mockReturnValue(createThreads(6));

    runGmailDigest();

    expect(getGeminiCalls()).toHaveLength(2);
    expect(getSlackCalls()).toHaveLength(3);
    expect(getSlackPayload(1).thread_ts).toBe('123.456');
    expect(getSlackPayload(2).thread_ts).toBe('123.456');
    expect(getSlackPayload(1).blocks).toHaveLength(PAGE_SIZE * 4);
    expect(getSlackPayload(2).blocks).toHaveLength(4);
  });

  it('Newsletterスレッドが0件の場合はGeminiを呼ばず親のみ投稿する', () => {
    vi.mocked(GmailApp.search).mockReturnValue([]);

    runGmailDigest();

    expect(getGeminiCalls()).toHaveLength(0);
    expect(getDlpCalls()).toHaveLength(0);
    expect(getSlackCalls()).toHaveLength(1);
    const payload = getSlackPayload(0);
    expect(payload.text).toMatch(/^📭 \d{4}\/\d{2}\/\d{2}\n新着メールはありませんでした$/);
    expect(payload.blocks).toMatchObject([
      {
        type: 'header',
        level: 1,
        text: {
          type: 'plain_text',
          text: expect.stringMatching(/^📭 \d{4}\/\d{2}\/\d{2}$/),
        },
      },
      {
        type: 'rich_text',
        elements: [
          {
            type: 'rich_text_section',
            elements: [
              {
                type: 'text',
                text: '新着メールはありませんでした',
                style: { italic: true },
              },
            ],
          },
        ],
      },
    ]);
    expect(JSON.stringify(payload.blocks)).toContain('新着メールはありませんでした');
    expect(payload.thread_ts).toBeUndefined();
  });

  it('上限超過時はGeminiを呼ばず件名と送信者のみをページ返信する', () => {
    vi.mocked(GmailApp.search).mockReturnValue(
      createThreads(MAX_SUMMARY_NEWSLETTERS + 1, '長い本文 '.repeat(50))
    );

    runGmailDigest();

    expect(getGeminiCalls()).toHaveLength(0);
    expect(getDlpCalls()).toHaveLength(0);
    expect(getSlackCalls()).toHaveLength(16);

    const parentPayload = getSlackPayload(0);
    expect(parentPayload.blocks).toMatchObject([
      {
        type: 'header',
        level: 1,
        text: {
          type: 'plain_text',
          text: expect.stringMatching(/^📬 \d{4}\/\d{2}\/\d{2}$/),
        },
      },
      {
        type: 'rich_text',
        elements: [
          {
            type: 'rich_text_section',
            elements: [
              {
                type: 'text',
                text: `${MAX_SUMMARY_NEWSLETTERS + 1}`,
                style: { bold: true },
              },
              { type: 'text', text: ' 件のメールが届いています' },
            ],
          },
          {
            type: 'rich_text_section',
            elements: [
              { type: 'emoji', name: 'warning' },
              {
                type: 'text',
                text: ' 件数が多いため要約は省略し、件名と送信者のみ表示します',
              },
            ],
          },
        ],
      },
    ]);

    const firstReplyPayload = getSlackPayload(1);
    expect(firstReplyPayload.thread_ts).toBe('123.456');
    expect(JSON.stringify(firstReplyPayload.blocks)).toContain('Subject 1');
    expect(JSON.stringify(firstReplyPayload.blocks)).toContain('Sender One');
    expect(JSON.stringify(firstReplyPayload.blocks)).toContain('メールを開く');
  });

  it('DLPマスク失敗時は本文を除外した入力でGemini要約を継続する', () => {
    vi.mocked(GmailApp.search).mockReturnValue([
      createThread('Subject 1', 'sender1@example.com', '本文1', 'https://mail/1'),
    ]);
    vi.mocked(UrlFetchApp.fetch).mockImplementation((url) => {
      if (String(url).includes('dlp.googleapis.com')) {
        return {
          getResponseCode: vi.fn().mockReturnValue(500),
          getContentText: vi.fn().mockReturnValue(''),
        } as never;
      }
      if (String(url).includes('generativelanguage')) {
        return mockResponse({
          candidates: [{ content: { parts: [{ text: JSON.stringify(geminiSummariesFixture) }] } }],
        }) as never;
      }
      return mockResponse({ ok: true, ts: '123.456' }) as never;
    });

    runGmailDigest();

    expect(getDlpCalls()).toHaveLength(1);
    expect(getGeminiCalls()).toHaveLength(1);
    expect(getGeminiUserContent(0)).toContain('[本文のマスクに失敗したため除外しました]');
  });
});

function createThreads(
  count: number,
  bodyFactory: string | ((index: number) => string) = (index) => `本文${index}`
): GoogleAppsScript.Gmail.GmailThread[] {
  return Array.from({ length: count }, (_, i) => {
    const index = i + 1;
    return createThread(
      `Subject ${index}`,
      index === 1 ? '"Sender One" <sender1@example.com>' : `sender${index}@example.com`,
      typeof bodyFactory === 'string' ? bodyFactory : bodyFactory(index),
      `https://mail/${index}`
    );
  });
}

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

function getDlpCalls() {
  return vi
    .mocked(UrlFetchApp.fetch)
    .mock.calls.filter(([url]) => String(url).includes('dlp.googleapis.com'));
}

function getDlpPayload(index: number): {
  item: { value: string };
  inspectConfig: { infoTypes: { name: string }[]; minLikelihood: string };
} {
  const [, options] = getDlpCalls()[index];
  return JSON.parse((options as { payload: string }).payload);
}

function getGeminiUserContent(index: number): string {
  const [, options] = getGeminiCalls()[index];
  const payload = JSON.parse((options as { payload: string }).payload);
  return payload.contents[0].parts[0].text;
}
