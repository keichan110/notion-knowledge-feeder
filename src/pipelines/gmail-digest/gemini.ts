import {
  callGeminiAPI,
  type GeminiApiKey,
  type GeminiModel,
  type GeminiResponseSchema,
} from '../../capabilities/gemini';

const SYSTEM_INSTRUCTION =
  'あなたは、与えられた複数のNewsletter(メールマガジン)を1通ずつ要約するアシスタントです。各メールについて「何の連絡か・要点は何か」が掴める簡潔な要約を1〜2文でsummaryに書いてください。セミナーやイベントの申込期限・締切・開催日などの日付は要約から絶対に省略しないでください。subjectは入力メールの件名をそのまま使ってください。入力と同じ件数のsummariesを入力と同じ順序で返してください。書かれている内容だけ使い推測しないでください。';

const RESPONSE_SCHEMA: GeminiResponseSchema = {
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
};

export type NewsletterInput = { subject: string; from: string; body: string };
export type NewsletterSummary = { subject: string; summary: string };

/**
 * ページ単位のNewsletterをGeminiで1通ずつ要約する。
 * @param newsletters 要約対象のNewsletter配列
 * @param geminiModel 使用するGeminiモデル名
 * @param geminiApiKey Gemini APIキー
 * @returns 入力順に対応するNewsletter要約配列
 */
export function summarizeNewsletterPage(
  newsletters: NewsletterInput[],
  geminiModel: GeminiModel,
  geminiApiKey: GeminiApiKey
): NewsletterSummary[] {
  const text = callGeminiAPI({
    geminiModel,
    geminiApiKey,
    systemInstruction: SYSTEM_INSTRUCTION,
    userContent: newsletterContent(newsletters),
    responseSchema: RESPONSE_SCHEMA,
  });

  try {
    return parseNewsletterSummaries(text);
  } catch {
    throw new Error('Gemini returned invalid JSON');
  }
}

/**
 * Geminiの応答テキストをページ単位のNewsletter要約配列として検証する。
 * @param text Gemini APIから返された応答テキスト
 * @returns 検証済みのNewsletter要約配列
 */
export function parseNewsletterSummaries(text: string): NewsletterSummary[] {
  const value: unknown = JSON.parse(text);
  if (!isRecord(value) || !Array.isArray(value.summaries)) {
    throw new Error('Gemini returned invalid JSON');
  }
  if (!value.summaries.every(isNewsletterSummary)) {
    throw new Error('Gemini returned invalid JSON');
  }
  return value.summaries;
}

function newsletterContent(newsletters: NewsletterInput[]): string {
  return newsletters
    .map(
      (newsletter, index) => `## Newsletter ${index + 1}
件名: ${newsletter.subject}
送信者: ${newsletter.from}
本文:
${newsletter.body}`
    )
    .join('\n\n');
}

function isNewsletterSummary(value: unknown): value is NewsletterSummary {
  return isRecord(value) && typeof value.subject === 'string' && typeof value.summary === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
