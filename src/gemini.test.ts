import { describe, expect, it, vi } from 'vitest';
import type { GeminiResult } from './gemini';
import { callGeminiAPI } from './gemini';

const validResult: GeminiResult = {
  title: 'テスト記事',
  tldr: '要約文',
  summary: '詳細要約',
  category: 'AI/ML',
  tags: ['TypeScript', 'Vitest'],
  confidence: 'high',
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
