import { beforeEach, describe, expect, it, vi } from 'vitest';
import { postMessage, type SlackBotToken, type SlackChannelId } from './slack';

const mockResponse = (body: object) => ({
  getContentText: vi.fn().mockReturnValue(JSON.stringify(body)),
});

beforeEach(() => {
  vi.mocked(UrlFetchApp.fetch).mockReset();
});

describe('postMessage', () => {
  it('Slack APIがok:trueの場合はchat.postMessageに認証ヘッダーとpayloadを送りtsを返す', () => {
    vi.mocked(UrlFetchApp.fetch).mockReturnValue(
      mockResponse({ ok: true, ts: '123.456' }) as never
    );

    const ts = postMessage('xoxb-test' as SlackBotToken, 'C123456' as SlackChannelId, {
      text: 'hello',
    });

    expect(UrlFetchApp.fetch).toHaveBeenCalledWith(
      'https://slack.com/api/chat.postMessage',
      expect.objectContaining({
        method: 'post',
        contentType: 'application/json',
        headers: { Authorization: 'Bearer xoxb-test' },
        payload: JSON.stringify({ channel: 'C123456', text: 'hello' }),
      })
    );
    expect(ts).toBe('123.456');
  });

  it('blocksとthreadTsがある場合はpayloadにblocksとthread_tsを含める', () => {
    vi.mocked(UrlFetchApp.fetch).mockReturnValue(
      mockResponse({ ok: true, ts: '234.567' }) as never
    );
    const blocks = [{ type: 'section', text: { type: 'mrkdwn', text: '*hello*' } }];

    postMessage('xoxb-test' as SlackBotToken, 'C123456' as SlackChannelId, {
      text: 'fallback',
      blocks,
      threadTs: '123.456',
    });

    const [, options] = vi.mocked(UrlFetchApp.fetch).mock.calls[0];
    const payload = JSON.parse((options as { payload: string }).payload);
    expect(payload).toEqual({
      channel: 'C123456',
      text: 'fallback',
      blocks,
      thread_ts: '123.456',
    });
  });

  it('Slack APIがok:falseの場合はエラーを投げる', () => {
    vi.mocked(UrlFetchApp.fetch).mockReturnValue(
      mockResponse({ ok: false, error: 'channel_not_found' }) as never
    );

    expect(() =>
      postMessage('xoxb-test' as SlackBotToken, 'C123456' as SlackChannelId, { text: 'hello' })
    ).toThrow('slack postMessage failed: channel_not_found');
  });
});
