import { beforeEach, describe, expect, it, vi } from 'vitest';
import { notifySlack } from './notify';

vi.mock('../capabilities/slack');
vi.mock('./config');

import type { SlackAttachment } from '../capabilities/slack';
import { postMessage } from '../capabilities/slack';
import { getNotifyConfig, resetConfigCache } from './config';
import { log } from './log';

function getAttachment(): SlackAttachment {
  const [, , params] = vi.mocked(postMessage).mock.calls[0];
  return params.attachments?.[0] as SlackAttachment;
}

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

  it('error severity で赤色 attachment を投稿しフォールバック text に <!channel> を含む', () => {
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

    const att = getAttachment();
    expect(att.color).toBe('#E01E5A');

    const msgBlock = att.blocks?.[0] as { type: string; text: { text: string } };
    expect(msgBlock.type).toBe('section');
    expect(msgBlock.text.text).toBe('fetch failed');
  });

  it('warn severity で黄色 attachment、フォールバック text にメンションなし', () => {
    notifySlack({
      severity: 'warn',
      job: 'article-ingest:pending',
      message: 'duplicate URL skipped',
    });

    expect(postMessage).toHaveBeenCalledOnce();
    const [, , params] = vi.mocked(postMessage).mock.calls[0];

    expect(params.text).not.toContain('<!channel>');
    expect(params.text).toContain('article-ingest:pending');

    const att = getAttachment();
    expect(att.color).toBe('#ECB22E');
  });

  it('Job 名が section fields に含まれる', () => {
    notifySlack({
      severity: 'error',
      job: 'article-ingest:pending',
      message: 'fetch failed',
    });

    const att = getAttachment();
    const section = att.blocks?.[1] as { type: string; fields: { text: string }[] };
    expect(section.type).toBe('section');
    expect(section.fields[0].text).toContain('article-ingest:pending');
  });

  it('context を渡すと Context セクションが追加される', () => {
    notifySlack({
      severity: 'error',
      job: 'article-ingest:pending',
      message: 'fetch failed',
      context: { url: 'https://example.com', pageId: 'page-123' },
    });

    const att = getAttachment();
    const contextBlock = att.blocks?.find(
      (b) =>
        (b as { type: string; text?: { text: string } }).type === 'section' &&
        (b as { text?: { text: string } }).text?.text.includes('Context')
    ) as { text: { text: string } } | undefined;
    expect(contextBlock).toBeDefined();
    expect(contextBlock?.text.text).toContain('https://example.com');
    expect(contextBlock?.text.text).toContain('page-123');
  });

  it('err を渡すと Error セクションにエラーメッセージが含まれる', () => {
    const error = new Error('connection timeout');
    notifySlack({
      severity: 'error',
      job: 'article-ingest:pending',
      message: 'fetch failed',
      err: error,
    });

    const att = getAttachment();
    const errorBlock = att.blocks?.find(
      (b) =>
        (b as { type: string; text?: { text: string } }).type === 'section' &&
        (b as { text?: { text: string } }).text?.text.includes('Error')
    ) as { text: { text: string } } | undefined;
    expect(errorBlock).toBeDefined();
    expect(errorBlock?.text.text).toContain('connection timeout');
  });

  it('err が Error でない場合も文字列化される', () => {
    notifySlack({
      severity: 'error',
      job: 'test-job',
      message: 'something broke',
      err: 'raw string error',
    });

    const att = getAttachment();
    const errorBlock = att.blocks?.find(
      (b) =>
        (b as { type: string; text?: { text: string } }).type === 'section' &&
        (b as { text?: { text: string } }).text?.text.includes('Error')
    ) as { text: { text: string } } | undefined;
    expect(errorBlock).toBeDefined();
    expect(errorBlock?.text.text).toContain('raw string error');
  });

  it('長い message は truncate される', () => {
    const longMessage = 'x'.repeat(3000);
    notifySlack({
      severity: 'error',
      job: 'test-job',
      message: longMessage,
    });

    const att = getAttachment();
    const msgBlock = att.blocks?.[0] as { type: string; text: { text: string } };
    expect(msgBlock.text.text).toContain('…(truncated)');
    expect(msgBlock.text.text.length).toBeLessThan(2600);
  });

  it('長い context は truncate される', () => {
    const longValue = 'x'.repeat(3000);
    notifySlack({
      severity: 'error',
      job: 'test-job',
      message: 'test',
      context: { data: longValue },
    });

    const att = getAttachment();
    const contextBlock = att.blocks?.find(
      (b) =>
        (b as { type: string; text?: { text: string } }).type === 'section' &&
        (b as { text?: { text: string } }).text?.text.includes('Context')
    ) as { text: { text: string } } | undefined;
    expect(contextBlock).toBeDefined();
    expect(contextBlock?.text.text).toContain('…(truncated)');
    expect(contextBlock?.text.text.length).toBeLessThan(2600);
  });

  it('長い err は truncate される', () => {
    const longStack = 'x'.repeat(3000);
    const error = new Error('fail');
    error.stack = longStack;
    notifySlack({
      severity: 'error',
      job: 'test-job',
      message: 'test',
      err: error,
    });

    const att = getAttachment();
    const errorBlock = att.blocks?.find(
      (b) =>
        (b as { type: string; text?: { text: string } }).type === 'section' &&
        (b as { text?: { text: string } }).text?.text.includes('Error')
    ) as { text: { text: string } } | undefined;
    expect(errorBlock).toBeDefined();
    expect(errorBlock?.text.text).toContain('…(truncated)');
    expect(errorBlock?.text.text.length).toBeLessThan(2600);
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

  it('タイムスタンプ（JST）が context ブロックに含まれる', () => {
    notifySlack({
      severity: 'error',
      job: 'test-job',
      message: 'test message',
    });

    const att = getAttachment();
    const ctxBlock = att.blocks?.find((b) => (b as { type: string }).type === 'context') as
      | { elements: { text: string }[] }
      | undefined;
    expect(ctxBlock).toBeDefined();
    expect(ctxBlock?.elements[0].text).toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(ctxBlock?.elements[0].text).toContain('JST');
  });
});
