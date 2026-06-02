import { log } from './log';

export type GeminiModel =
  | 'gemini-3.5-flash'
  | 'gemini-3.1-pro-preview'
  | 'gemini-3.1-flash-lite'
  | 'gemini-2.5-flash'
  | 'gemini-2.5-flash-lite'
  | 'gemini-2.5-pro';
export type GeminiApiKey = string;

export type SummarySection = {
  heading: string;
  body: string;
};

export type GeminiResult = {
  title: string;
  tldr: string[];
  summary: SummarySection[];
  category: string;
  tags: string[];
  confidence: 'high' | 'medium' | 'low';
};

/**
 * Gemini APIに記事本文を送信し、要約・構造化した結果を返す。
 * @param articleText 要約対象の記事本文
 * @param geminiModel 使用するGeminiモデル名
 * @param geminiApiKey Gemini APIキー
 * @returns 要約・構造化された `GeminiResult`
 * @throws Gemini APIが有効なJSONを返さない場合
 */
export function callGeminiAPI(
  articleText: string,
  geminiModel: GeminiModel,
  geminiApiKey: GeminiApiKey
): GeminiResult {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${geminiApiKey}`;

  const payload = {
    contents: [{ parts: [{ text: PROMPT_TEMPLATE(articleText) }] }],
    generationConfig: { temperature: 0.3 },
  };

  const response = UrlFetchApp.fetch(endpoint, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });

  const status = response.getResponseCode();
  if (status !== 200) {
    log.error('callGeminiAPI', 'non-200 response', undefined, { status, model: geminiModel });
    throw new Error(`Gemini API error: HTTP ${status}`);
  }

  const result = JSON.parse(response.getContentText()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = result.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

  const match = text.match(/{[\s\S]*}/);
  if (!match) {
    log.error('callGeminiAPI', 'invalid JSON from Gemini', undefined, {
      preview: text.slice(0, 200),
    });
    throw new Error('Gemini returned invalid JSON');
  }

  const parsed = JSON.parse(match[0]) as GeminiResult;
  // TODO(dev-log): 本番運用時に削除
  log.info('callGeminiAPI', 'success', {
    model: geminiModel,
    title: parsed.title,
    confidence: parsed.confidence,
  });
  return parsed;
}

const PROMPT_TEMPLATE = (
  articleText: string
) => `あなたはITエンジニア向けのナレッジキュレーターです。
以下の記事本文を分析し、JSONのみを返してください。前置きやコードブロック記号は不要です。

記事本文:
${articleText}

以下のJSON形式で返してください:
{
  "title": "記事タイトル（元タイトルが適切なら流用）",
  "tldr": ["何の記事かを1文で", "なぜ重要か・読む価値を1文で", "（任意）補足や対象読者を1文で"],
  "summary": [
    { "heading": "背景", "body": "記事の背景・問題意識を2〜3文で。技術的な文脈や動機を具体的に記述すること" },
    { "heading": "内容", "body": "主要な内容・手法・知見を4〜6文で詳述する。具体的な技術名・プロダクト名・手順・数値・コード上の要点を漏らさず含めること。箇条書き（「・」区切り）を使ってもよい" },
    { "heading": "まとめ", "body": "読者が得られる具体的な知見・学び・次のアクションを2〜3文で。抽象的な表現を避け、実践的な示唆を記述すること" }
  ],
  "category": "AI/ML、開発、インフラ、セキュリティ、ビジネス、ツール、マネジメント、自己啓発、その他 のいずれか1つ",
  "tags": ["固有名詞・技術名を優先した3〜5個のキーワード"],
  "confidence": "high/medium/low（本文の情報量の自己評価）"
}`;
