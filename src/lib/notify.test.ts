import { beforeEach, describe, expect, it, vi } from 'vitest';
import { notifySlack } from './notify';

vi.mock('../capabilities/slack');
vi.mock('./config');

import { postMessage } from '../capabilities/slack';
import { getNotifyConfig, resetConfigCache } from './config';
import { log } from './log';

describe('notifySlack', () => {
  beforeEach(() => {
    resetConfigCache();
    vi.mocked(getNotifyConfig).mockReturnValue({
      slackBotToken: 'xoxb-test' as ReturnType<typeof getNotifyConfig>['slackBotToken'],
      slackErrorChannelId: 'C-error' as ReturnType<typeof getNotifyConfig>['slackErrorChannelId'],
    });
    vi.mocked(postMessage).mockReset().mockReturnValue('1234567890.123456');
    vi.spyOn(log, 'error').mockReset();
  });

  it('error severity で <!channel> メンション付きメッセージを投稿する', () => {
    notifySlack({
      severity: 'error',
      job: 'article-ingest:pending',
      message: 'fetch failed',
    });

    expect(postMessage).toHaveBeenCalledOnce();
    const [token, channel, params] = vi.mocked(postMessage).mock.calls[0];
    expect(token).toBe('xoxb-test');
    expect(channel).toBe('C-error');
    expect(params.text).toContain('<!channel>');
    expect(params.text).toContain('article-ingest:pending');
    expect(params.text).toContain('fetch failed');
  });

  it('warn severity ではメンションを付けない', () => {
    notifySlack({
      severity: 'warn',
      job: 'article-ingest:pending',
      message: 'duplicate URL skipped',
    });

    expect(postMessage).toHaveBeenCalledOnce();
    const [, , params] = vi.mocked(postMessage).mock.calls[0];
    expect(params.text).not.toContain('<!channel>');
    expect(params.text).toContain('article-ingest:pending');
    expect(params.text).toContain('duplicate URL skipped');
  });

  it('context を渡すとメッセージに含まれる', () => {
    notifySlack({
      severity: 'error',
      job: 'article-ingest:pending',
      message: 'fetch failed',
      context: { url: 'https://example.com', pageId: 'page-123' },
    });

    const [, , params] = vi.mocked(postMessage).mock.calls[0];
    expect(params.text).toContain('https://example.com');
    expect(params.text).toContain('page-123');
  });

  it('err を渡すとエラーメッセージとスタックトレースが含まれる', () => {
    const error = new Error('connection timeout');
    notifySlack({
      severity: 'error',
      job: 'article-ingest:pending',
      message: 'fetch failed',
      err: error,
    });

    const [, , params] = vi.mocked(postMessage).mock.calls[0];
    expect(params.text).toContain('connection timeout');
    expect(params.text).toContain('Error:');
  });

  it('err が Error でない場合も文字列化される', () => {
    notifySlack({
      severity: 'error',
      job: 'test-job',
      message: 'something broke',
      err: 'raw string error',
    });

    const [, , params] = vi.mocked(postMessage).mock.calls[0];
    expect(params.text).toContain('raw string error');
  });

  it('Slack投稿が失敗した場合は log.error して握りつぶす', () => {
    vi.mocked(postMessage).mockImplementation(() => {
      throw new Error('slack API down');
    });

    expect(() =>
      notifySlack({
        severity: 'error',
        job: 'test-job',
        message: 'original error',
      })
    ).not.toThrow();

    expect(log.error).toHaveBeenCalledOnce();
  });

  it('タイムスタンプ（JST）がメッセージに含まれる', () => {
    notifySlack({
      severity: 'error',
      job: 'test-job',
      message: 'test message',
    });

    const [, , params] = vi.mocked(postMessage).mock.calls[0];
    expect(params.text).toMatch(/\d{4}-\d{2}-\d{2}/);
  });
});
