import {
  callGeminiAPI,
  type GeminiApiKey,
  type GeminiModel,
  type GeminiResponseSchema,
} from '../../capabilities/gemini';

const SYSTEM_INSTRUCTION = `あなたは、前日に届いた複数のNewsletterを横断的に要約するキュレーターです。指定のJSON形式で出力してください。

# 出力ルール
- すべてのフィールドを必ず埋める。
- Newsletterに書かれている内容だけを使う。推測・憶測や、書かれていない情報の補完はしない。

# フィールド別ルール
- actionItems: 締切・期限、返信・回答の要求、登録・申込の期限、重要な対応が必要なメールだけを挙げる。なければ空配列にする。subjectは該当メールの件名をそのまま使う。reasonは何の対応がいつ必要かを簡潔に書く。対応不要なら無理に作らない。
- categories: その日のNewsletterをトピック/ジャンルで分類し、ラベルと件数を返す。ラベルは内容に応じて自由に生成する。例: AI/ML, 製品アップデート, イベント案内。
- overview: 前日Newsletter全体を1つにまとめた横断要約。数文から短い段落で、固有名詞・要点を残し簡潔に書く。`;

// Gemini の構造化出力（responseSchema）。DigestSummary の形状を API レベルで保証する。
// type は REST API 仕様に従い大文字表記を使う。
const RESPONSE_SCHEMA: GeminiResponseSchema = {
  type: 'OBJECT',
  properties: {
    actionItems: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          subject: { type: 'STRING' },
          reason: { type: 'STRING' },
        },
        required: ['subject', 'reason'],
        propertyOrdering: ['subject', 'reason'],
      },
    },
    categories: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          label: { type: 'STRING' },
          count: { type: 'NUMBER' },
        },
        required: ['label', 'count'],
        propertyOrdering: ['label', 'count'],
      },
    },
    overview: { type: 'STRING' },
  },
  required: ['actionItems', 'categories', 'overview'],
  propertyOrdering: ['actionItems', 'categories', 'overview'],
};

export type NewsletterInput = { subject: string; from: string; body: string };
export type DigestActionItem = { subject: string; reason: string };
export type DigestCategory = { label: string; count: number };
export type DigestSummary = {
  actionItems: DigestActionItem[];
  categories: DigestCategory[];
  overview: string;
};

/**
 * 複数のNewsletterをGeminiで横断要約し、gmail-digest用の構造化結果として返す。
 *
 * @param newsletters - 要約対象のNewsletter配列。
 * @param geminiModel - 使用するGeminiモデル名。
 * @param geminiApiKey - Gemini APIキー。
 * @returns Newsletter横断要約の構造化結果。
 * @throws Geminiの応答が `DigestSummary` として有効なJSONではない場合。
 */
export function summarizeNewsletters(
  newsletters: NewsletterInput[],
  geminiModel: GeminiModel,
  geminiApiKey: GeminiApiKey
): DigestSummary {
  const text = callGeminiAPI({
    geminiModel,
    geminiApiKey,
    systemInstruction: SYSTEM_INSTRUCTION,
    userContent: newsletterContent(newsletters),
    responseSchema: RESPONSE_SCHEMA,
  });

  try {
    return parseDigestSummary(text);
  } catch {
    throw new Error('Gemini returned invalid JSON');
  }
}

/**
 * Geminiの応答テキストを `DigestSummary` としてパースし、必須フィールドを検証する。
 *
 * @param text - Gemini APIから返された応答テキスト。
 * @returns 検証済みの `DigestSummary`。
 * @throws 応答テキストがJSONとして不正、または `DigestSummary` の形状を満たさない場合。
 */
export function parseDigestSummary(text: string): DigestSummary {
  const value: unknown = JSON.parse(text);
  if (!isDigestSummary(value)) {
    throw new Error('Gemini returned invalid JSON');
  }
  return value;
}

function newsletterContent(newsletters: NewsletterInput[]): string {
  const items = newsletters
    .map(
      (newsletter, index) => `## Newsletter ${index + 1}
件名: ${newsletter.subject}
送信者: ${newsletter.from}
本文:
"""
${newsletter.body}
"""`
    )
    .join('\n\n');

  return `# 前日に届いたNewsletter
${items}`;
}

function isDigestSummary(value: unknown): value is DigestSummary {
  if (!isRecord(value)) return false;
  return (
    Array.isArray(value.actionItems) &&
    value.actionItems.every(isDigestActionItem) &&
    Array.isArray(value.categories) &&
    value.categories.every(isDigestCategory) &&
    typeof value.overview === 'string'
  );
}

function isDigestActionItem(value: unknown): value is DigestActionItem {
  return isRecord(value) && typeof value.subject === 'string' && typeof value.reason === 'string';
}

function isDigestCategory(value: unknown): value is DigestCategory {
  return isRecord(value) && typeof value.label === 'string' && typeof value.count === 'number';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
