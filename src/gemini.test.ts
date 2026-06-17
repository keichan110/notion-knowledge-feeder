import { describe, expect, it, vi } from 'vitest';
import type { GeminiResult } from './gemini';
import { callGeminiAPI } from './gemini';

const validResult: GeminiResult = {
  title: 'テスト記事',
  overview: 'TypeScriptとVitestを使ったテスト手法の紹介記事',
  summary: [
    { heading: '背景', body: '背景の詳細' },
    { heading: '内容', body: '内容の詳細' },
  ],
  category: 'AI/ML',
  tags: ['TypeScript', 'Vitest'],
};

const mockResponse = (code: number, text: string) => ({
  getResponseCode: vi.fn().mockReturnValue(code),
  getContentText: vi.fn().mockReturnValue(text),
});

describe('callGeminiAPI', () => {
  it('Geminiのレスポンスをパースして返す', () => {
    const responseText = JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify(validResult) }] } }],
    });
    vi.mocked(UrlFetchApp.fetch).mockReturnValue(mockResponse(200, responseText) as never);

    const result = callGeminiAPI('記事本文', 'gemini-2.5-flash', 'api-key');

    expect(result).toEqual(validResult);
  });

  it('正しいエンドポイントとペイロードでfetchする', () => {
    const responseText = JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify(validResult) }] } }],
    });
    vi.mocked(UrlFetchApp.fetch).mockReturnValue(mockResponse(200, responseText) as never);

    callGeminiAPI('記事本文', 'gemini-2.5-flash', 'my-api-key');

    expect(UrlFetchApp.fetch).toHaveBeenCalledWith(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=my-api-key',
      expect.objectContaining({ method: 'post', contentType: 'application/json' })
    );
  });

  it('レスポンスのtextにJSONが含まれない場合はエラーを投げる', () => {
    const responseText = JSON.stringify({
      candidates: [{ content: { parts: [{ text: 'invalid response' }] } }],
    });
    vi.mocked(UrlFetchApp.fetch).mockReturnValue(mockResponse(200, responseText) as never);

    expect(() => callGeminiAPI('記事本文', 'gemini-2.5-flash', 'api-key')).toThrow(
      'Gemini returned invalid JSON'
    );
  });

  it('candidatesが空の場合はエラーを投げる', () => {
    const responseText = JSON.stringify({ candidates: [] });
    vi.mocked(UrlFetchApp.fetch).mockReturnValue(mockResponse(200, responseText) as never);

    expect(() => callGeminiAPI('記事本文', 'gemini-2.5-flash', 'api-key')).toThrow(
      'Gemini returned invalid JSON'
    );
  });

  it('プロンプトにセクション分割の指示が含まれる', () => {
    const responseText = JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify(validResult) }] } }],
    });
    vi.mocked(UrlFetchApp.fetch).mockReturnValue(mockResponse(200, responseText) as never);

    callGeminiAPI('記事本文', 'gemini-2.5-flash', 'api-key');

    const [, options] = vi.mocked(UrlFetchApp.fetch).mock.calls[0];
    const payload = JSON.parse((options as { payload: string }).payload);
    const promptText = payload.contents[0].parts[0].text as string;
    expect(promptText).toContain('分割');
  });

  it('503エラー時にリトライして成功する', () => {
    const responseText = JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify(validResult) }] } }],
    });
    vi.mocked(UrlFetchApp.fetch)
      .mockReturnValueOnce(mockResponse(503, '') as never)
      .mockReturnValueOnce(mockResponse(200, responseText) as never);

    const result = callGeminiAPI('記事本文', 'gemini-2.5-flash', 'api-key');

    expect(result).toEqual(validResult);
    expect(UrlFetchApp.fetch).toHaveBeenCalledTimes(2);
    expect(Utilities.sleep).toHaveBeenCalledTimes(1);
    expect(Utilities.sleep).toHaveBeenCalledWith(1000);
  });

  it('503エラーが最大リトライ回数を超えた場合はエラーを投げる', () => {
    vi.mocked(UrlFetchApp.fetch).mockReturnValue(mockResponse(503, '') as never);

    expect(() => callGeminiAPI('記事本文', 'gemini-2.5-flash', 'api-key')).toThrow(
      'Gemini API error: HTTP 503'
    );
    expect(UrlFetchApp.fetch).toHaveBeenCalledTimes(4);
  });

  it('503リトライの待機時間が指数バックオフになっている', () => {
    vi.mocked(UrlFetchApp.fetch).mockReturnValue(mockResponse(503, '') as never);

    expect(() => callGeminiAPI('記事本文', 'gemini-2.5-flash', 'api-key')).toThrow();
    expect(Utilities.sleep).toHaveBeenCalledTimes(3);
    expect(Utilities.sleep).toHaveBeenNthCalledWith(1, 1000);
    expect(Utilities.sleep).toHaveBeenNthCalledWith(2, 2000);
    expect(Utilities.sleep).toHaveBeenNthCalledWith(3, 4000);
  });

  it('429エラー時にリトライして成功する', () => {
    const responseText = JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify(validResult) }] } }],
    });
    vi.mocked(UrlFetchApp.fetch)
      .mockReturnValueOnce(mockResponse(429, '') as never)
      .mockReturnValueOnce(mockResponse(200, responseText) as never);

    const result = callGeminiAPI('記事本文', 'gemini-2.5-flash', 'api-key');

    expect(result).toEqual(validResult);
    expect(UrlFetchApp.fetch).toHaveBeenCalledTimes(2);
  });

  it('400エラー時はリトライせず即座にエラーを投げる', () => {
    vi.mocked(UrlFetchApp.fetch).mockReturnValue(mockResponse(400, '') as never);

    expect(() => callGeminiAPI('記事本文', 'gemini-2.5-flash', 'api-key')).toThrow(
      'Gemini API error: HTTP 400'
    );
    expect(UrlFetchApp.fetch).toHaveBeenCalledTimes(1);
    expect(Utilities.sleep).not.toHaveBeenCalled();
  });

  it('レスポンスJSONの中にJSONブロックが埋め込まれていても抽出できる', () => {
    const embeddedText = `以下の結果です：\n${JSON.stringify(validResult)}\n以上です。`;
    const responseText = JSON.stringify({
      candidates: [{ content: { parts: [{ text: embeddedText }] } }],
    });
    vi.mocked(UrlFetchApp.fetch).mockReturnValue(mockResponse(200, responseText) as never);

    const result = callGeminiAPI('記事本文', 'gemini-2.5-flash', 'api-key');

    expect(result).toEqual(validResult);
  });
});
