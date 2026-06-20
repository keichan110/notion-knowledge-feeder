import { describe, expect, it, vi } from 'vitest';
import { callGeminiAPI, type GeminiResponseSchema } from './gemini';

const responseSchema: GeminiResponseSchema = {
  type: 'OBJECT',
  properties: { title: { type: 'STRING' } },
};

const callParams = {
  geminiModel: 'gemini-2.5-flash' as const,
  geminiApiKey: 'api-key',
  systemInstruction: 'system instruction',
  userContent: 'user content',
  responseSchema,
};

const mockResponse = (code: number, text: string) => ({
  getResponseCode: vi.fn().mockReturnValue(code),
  getContentText: vi.fn().mockReturnValue(text),
});

const geminiResponseText = (text: string) =>
  JSON.stringify({
    candidates: [{ content: { parts: [{ text }] } }],
  });

describe('callGeminiAPI', () => {
  it('Geminiのレスポンスからtextを取り出して返す', () => {
    vi.mocked(UrlFetchApp.fetch).mockReturnValue(
      mockResponse(200, geminiResponseText('response text')) as never
    );

    const result = callGeminiAPI(callParams);

    expect(result).toBe('response text');
  });

  it('正しいエンドポイントとペイロードでfetchする', () => {
    vi.mocked(UrlFetchApp.fetch).mockReturnValue(
      mockResponse(200, geminiResponseText('response text')) as never
    );

    callGeminiAPI({ ...callParams, geminiApiKey: 'my-api-key' });

    expect(UrlFetchApp.fetch).toHaveBeenCalledWith(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=my-api-key',
      expect.objectContaining({ method: 'post', contentType: 'application/json' })
    );
  });

  it('systemInstructionとユーザーコンテンツをpayloadに含める', () => {
    vi.mocked(UrlFetchApp.fetch).mockReturnValue(
      mockResponse(200, geminiResponseText('response text')) as never
    );

    callGeminiAPI(callParams);

    const [, options] = vi.mocked(UrlFetchApp.fetch).mock.calls[0];
    const payload = JSON.parse((options as { payload: string }).payload);
    expect(payload.systemInstruction.parts[0].text).toBe('system instruction');
    expect(payload.contents[0].parts[0].text).toBe('user content');
  });

  it('responseSchemaが指定されている場合はgenerationConfigに含める', () => {
    vi.mocked(UrlFetchApp.fetch).mockReturnValue(
      mockResponse(200, geminiResponseText('response text')) as never
    );

    callGeminiAPI(callParams);

    const [, options] = vi.mocked(UrlFetchApp.fetch).mock.calls[0];
    const payload = JSON.parse((options as { payload: string }).payload);
    expect(payload.generationConfig.responseMimeType).toBe('application/json');
    expect(payload.generationConfig.responseSchema).toEqual(responseSchema);
  });

  it('responseSchemaが指定されていない場合はgenerationConfigに含めない', () => {
    vi.mocked(UrlFetchApp.fetch).mockReturnValue(
      mockResponse(200, geminiResponseText('response text')) as never
    );

    callGeminiAPI({ ...callParams, responseSchema: undefined });

    const [, options] = vi.mocked(UrlFetchApp.fetch).mock.calls[0];
    const payload = JSON.parse((options as { payload: string }).payload);
    expect(payload.generationConfig.responseSchema).toBeUndefined();
  });

  it('candidatesが空の場合はエラーを投げる', () => {
    vi.mocked(UrlFetchApp.fetch).mockReturnValue(
      mockResponse(200, JSON.stringify({ candidates: [] })) as never
    );

    expect(() => callGeminiAPI(callParams)).toThrow('Gemini returned invalid response');
  });

  it('503エラー時にリトライして成功する', () => {
    vi.mocked(UrlFetchApp.fetch)
      .mockReturnValueOnce(mockResponse(503, '') as never)
      .mockReturnValueOnce(mockResponse(200, geminiResponseText('response text')) as never);

    const result = callGeminiAPI(callParams);

    expect(result).toBe('response text');
    expect(UrlFetchApp.fetch).toHaveBeenCalledTimes(2);
    expect(Utilities.sleep).toHaveBeenCalledTimes(1);
    expect(Utilities.sleep).toHaveBeenCalledWith(1000);
  });

  it('503エラーが最大リトライ回数を超えた場合はエラーを投げる', () => {
    vi.mocked(UrlFetchApp.fetch).mockReturnValue(mockResponse(503, '') as never);

    expect(() => callGeminiAPI(callParams)).toThrow('Gemini API error: HTTP 503');
    expect(UrlFetchApp.fetch).toHaveBeenCalledTimes(4);
  });

  it('503リトライの待機時間が指数バックオフになっている', () => {
    vi.mocked(UrlFetchApp.fetch).mockReturnValue(mockResponse(503, '') as never);

    expect(() => callGeminiAPI(callParams)).toThrow();
    expect(Utilities.sleep).toHaveBeenCalledTimes(3);
    expect(Utilities.sleep).toHaveBeenNthCalledWith(1, 1000);
    expect(Utilities.sleep).toHaveBeenNthCalledWith(2, 2000);
    expect(Utilities.sleep).toHaveBeenNthCalledWith(3, 4000);
  });

  it('429エラー時はリトライせず即座にエラーを投げる', () => {
    vi.mocked(UrlFetchApp.fetch).mockReturnValue(mockResponse(429, '') as never);

    expect(() => callGeminiAPI(callParams)).toThrow('Gemini API error: HTTP 429');
    expect(UrlFetchApp.fetch).toHaveBeenCalledTimes(1);
    expect(Utilities.sleep).not.toHaveBeenCalled();
  });

  it('400エラー時はリトライせず即座にエラーを投げる', () => {
    vi.mocked(UrlFetchApp.fetch).mockReturnValue(mockResponse(400, '') as never);

    expect(() => callGeminiAPI(callParams)).toThrow('Gemini API error: HTTP 400');
    expect(UrlFetchApp.fetch).toHaveBeenCalledTimes(1);
    expect(Utilities.sleep).not.toHaveBeenCalled();
  });

  it('Gemini 3系モデルではthinkingLevelをmediumに指定する', () => {
    vi.mocked(UrlFetchApp.fetch).mockReturnValue(
      mockResponse(200, geminiResponseText('response text')) as never
    );

    callGeminiAPI({ ...callParams, geminiModel: 'gemini-3.1-flash-lite' });

    const [, options] = vi.mocked(UrlFetchApp.fetch).mock.calls[0];
    const payload = JSON.parse((options as { payload: string }).payload);
    expect(payload.generationConfig.thinkingConfig.thinkingLevel).toBe('medium');
  });

  it('Gemini 2.5系モデルではthinkingConfigを設定しない', () => {
    vi.mocked(UrlFetchApp.fetch).mockReturnValue(
      mockResponse(200, geminiResponseText('response text')) as never
    );

    callGeminiAPI(callParams);

    const [, options] = vi.mocked(UrlFetchApp.fetch).mock.calls[0];
    const payload = JSON.parse((options as { payload: string }).payload);
    expect(payload.generationConfig.thinkingConfig).toBeUndefined();
  });
});
