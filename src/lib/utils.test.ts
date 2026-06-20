import { describe, expect, it } from 'vitest';
import { createResponse, stripQueryString } from './utils';

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

describe('stripQueryString', () => {
  it('クエリパラメーターを除去したURLを返す', () => {
    expect(stripQueryString('https://example.com/article?ref=top&utm_source=feed')).toBe(
      'https://example.com/article'
    );
  });

  it('クエリパラメーターがない場合はそのまま返す', () => {
    expect(stripQueryString('https://example.com/article')).toBe('https://example.com/article');
  });

  it('フラグメント（#）はそのまま残す', () => {
    expect(stripQueryString('https://example.com/article#section')).toBe(
      'https://example.com/article#section'
    );
  });

  it('クエリとフラグメント両方ある場合はクエリのみ除去する', () => {
    expect(stripQueryString('https://example.com/article?ref=top#section')).toBe(
      'https://example.com/article#section'
    );
  });
});
