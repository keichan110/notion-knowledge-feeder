import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createResponse, getTodayString, getWeekString } from './utils';

describe('getTodayString', () => {
  it('UtilitiesのformatDateの結果を返す', () => {
    vi.mocked(Utilities.formatDate).mockReturnValue('2026-05-30');

    expect(getTodayString()).toBe('2026-05-30');
    expect(Utilities.formatDate).toHaveBeenCalledWith(
      expect.any(Date),
      expect.any(String),
      'yyyy-MM-dd'
    );
  });
});

describe('getWeekString', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('年と週番号をフォーマットして返す', () => {
    vi.setSystemTime(new Date('2026-01-05'));
    expect(getWeekString()).toBe('2026-W02');
  });

  it('年始は第1週になる', () => {
    vi.setSystemTime(new Date('2026-01-01'));
    expect(getWeekString()).toBe('2026-W01');
  });

  it('週番号が一桁のとき0埋めされる', () => {
    vi.setSystemTime(new Date('2026-02-01'));
    expect(getWeekString()).toBe('2026-W06');
  });
});

describe('createResponse', () => {
  it('successとmessageをJSON文字列にしてTextOutputを返す', () => {
    const result = createResponse(true, 'OK');

    expect(ContentService.createTextOutput).toHaveBeenCalledWith(
      JSON.stringify({ success: true, message: 'OK' })
    );
    expect(result.setMimeType).toHaveBeenCalledWith(ContentService.MimeType.JSON);
  });

  it('failure時もJSON文字列として渡す', () => {
    createResponse(false, 'error occurred');

    expect(ContentService.createTextOutput).toHaveBeenCalledWith(
      JSON.stringify({ success: false, message: 'error occurred' })
    );
  });
});
