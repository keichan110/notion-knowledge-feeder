import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getMessagePlainBody,
  getThreadPermalink,
  removeLabelFromThread,
  searchThreads,
} from './gmail';

beforeEach(() => {
  vi.mocked(GmailApp.search).mockReset().mockReturnValue([]);
  vi.mocked(GmailApp.getUserLabelByName)
    .mockReset()
    .mockReturnValue(null as never);
});

describe('searchThreads', () => {
  it('GmailApp.search にクエリ文字列を渡して検索結果を返す', () => {
    const threads = [{}] as GoogleAppsScript.Gmail.GmailThread[];
    vi.mocked(GmailApp.search).mockReturnValue(threads);

    const result = searchThreads('label:action -in:inbox');

    expect(result).toBe(threads);
    expect(GmailApp.search).toHaveBeenCalledWith('label:action -in:inbox');
  });
});

describe('removeLabelFromThread', () => {
  it('ラベルが存在する場合は thread.removeLabel を呼ぶ', () => {
    const label = {} as GoogleAppsScript.Gmail.GmailLabel;
    const thread = {
      removeLabel: vi.fn(),
    } as unknown as GoogleAppsScript.Gmail.GmailThread;
    vi.mocked(GmailApp.getUserLabelByName).mockReturnValue(label);

    removeLabelFromThread(thread, 'action');

    expect(GmailApp.getUserLabelByName).toHaveBeenCalledWith('action');
    expect(thread.removeLabel).toHaveBeenCalledWith(label);
  });

  it('ラベルが存在しない場合は thread.removeLabel を呼ばない', () => {
    const thread = {
      removeLabel: vi.fn(),
    } as unknown as GoogleAppsScript.Gmail.GmailThread;
    vi.mocked(GmailApp.getUserLabelByName).mockReturnValue(null as never);

    removeLabelFromThread(thread, 'action');

    expect(thread.removeLabel).not.toHaveBeenCalled();
  });
});

describe('getMessagePlainBody', () => {
  it('GmailMessage.getPlainBody の戻り値をそのまま返す', () => {
    const message = {
      getPlainBody: vi.fn().mockReturnValue('本文テキスト'),
    } as unknown as GoogleAppsScript.Gmail.GmailMessage;
    expect(getMessagePlainBody(message)).toBe('本文テキスト');
  });

  it('getPlainBody が空文字列を返す場合は空文字列を返す', () => {
    const message = {
      getPlainBody: vi.fn().mockReturnValue(''),
    } as unknown as GoogleAppsScript.Gmail.GmailMessage;
    expect(getMessagePlainBody(message)).toBe('');
  });
});

describe('getThreadPermalink', () => {
  it('GmailThread.getPermalink の戻り値をそのまま返す', () => {
    const thread = {
      getPermalink: vi.fn().mockReturnValue('https://mail.google.com/mail/u/0/#inbox/thread-id'),
    } as unknown as GoogleAppsScript.Gmail.GmailThread;

    expect(getThreadPermalink(thread)).toBe('https://mail.google.com/mail/u/0/#inbox/thread-id');
  });
});
