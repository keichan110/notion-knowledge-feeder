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

  const result = JSON.parse(response.getContentText()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = result.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

  const match = text.match(/{[\s\S]*}/);
  if (!match) throw new Error('Gemini returned invalid JSON');

  return JSON.parse(match[0]) as GeminiResult;
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
    { "heading": "背景", "body": "..." },
    { "heading": "内容", "body": "..." },
    { "heading": "まとめ", "body": "..." }
  ],
  "category": "AI/ML、開発、インフラ、セキュリティ、ビジネス、ツール、マネジメント、自己啓発、その他 のいずれか1つ",
  "tags": ["固有名詞・技術名を優先した3〜5個のキーワード"],
  "confidence": "high/medium/low（本文の情報量の自己評価）"
}`;
