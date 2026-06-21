import { describe, expect, it, vi } from 'vitest';

vi.mock('../../capabilities/gemini');

import { callGeminiAPI } from '../../capabilities/gemini';
import { type NewsletterInput, parseNewsletterSummaries, summarizeNewsletterPage } from './gemini';

const newsletters: NewsletterInput[] = [
  { subject: 'Newsletter 1', from: 'sender1@example.com', body: '本文1' },
  { subject: 'Newsletter 2', from: 'sender2@example.com', body: '本文2' },
];

const validResponse = {
  summaries: [
    { subject: 'Newsletter 1', summary: '要約1。6月30日の締切を含む。' },
    { subject: 'Newsletter 2', summary: '要約2。' },
  ],
};

describe('summarizeNewsletterPage', () => {
  it('ページ用のsystemInstructionと全NewsletterをGeminiに渡す', () => {
    vi.mocked(callGeminiAPI).mockReturnValue(JSON.stringify(validResponse));

    summarizeNewsletterPage(newsletters, 'gemini-3.1-flash-lite', 'api-key');

    expect(callGeminiAPI).toHaveBeenCalledWith(
      expect.objectContaining({
        geminiModel: 'gemini-3.1-flash-lite',
        geminiApiKey: 'api-key',
        systemInstruction: expect.stringContaining('1通ずつ要約'),
        userContent: expect.stringContaining('## Newsletter 1'),
        responseSchema: expect.objectContaining({ type: 'OBJECT' }),
      })
    );
    const params = vi.mocked(callGeminiAPI).mock.calls[0][0];
    expect(params.systemInstruction).toContain('日付は要約から絶対に省略しない');
    expect(params.userContent).toContain('Newsletter 1');
    expect(params.userContent).toContain('sender1@example.com');
    expect(params.userContent).toContain('本文1');
    expect(params.userContent).toContain('Newsletter 2');
    expect(params.userContent).toContain('本文2');
  });

  it('ページ要約用のresponseSchemaをGeminiに渡す', () => {
    vi.mocked(callGeminiAPI).mockReturnValue(JSON.stringify(validResponse));

    summarizeNewsletterPage(newsletters, 'gemini-3.1-flash-lite', 'api-key');

    const params = vi.mocked(callGeminiAPI).mock.calls[0][0];
    expect(params.responseSchema).toEqual({
      type: 'OBJECT',
      properties: {
        summaries: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              subject: { type: 'STRING' },
              summary: { type: 'STRING' },
            },
            required: ['subject', 'summary'],
            propertyOrdering: ['subject', 'summary'],
          },
        },
      },
      required: ['summaries'],
    });
  });

  it('Geminiの応答テキストをパースして返す', () => {
    vi.mocked(callGeminiAPI).mockReturnValue(JSON.stringify(validResponse));

    const result = summarizeNewsletterPage(newsletters, 'gemini-3.1-flash-lite', 'api-key');

    expect(result).toEqual(validResponse.summaries);
  });

  it('Geminiの応答テキストがJSONではない場合はエラーを投げる', () => {
    vi.mocked(callGeminiAPI).mockReturnValue('invalid response');

    expect(() => summarizeNewsletterPage(newsletters, 'gemini-3.1-flash-lite', 'api-key')).toThrow(
      'Gemini returned invalid JSON'
    );
  });
});

describe('parseNewsletterSummaries', () => {
  it('summaries要素の型が不正な場合はエラーを投げる', () => {
    expect(() =>
      parseNewsletterSummaries(
        JSON.stringify({ summaries: [{ subject: 'Newsletter 1', summary: 123 }] })
      )
    ).toThrow('Gemini returned invalid JSON');
  });

  it('正常なsummaries配列を返す', () => {
    expect(parseNewsletterSummaries(JSON.stringify(validResponse))).toEqual(
      validResponse.summaries
    );
  });
});
