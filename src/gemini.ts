const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;
const RETRYABLE_STATUSES = [503];

const PROMPT_TEMPLATE = (
  articleText: string
) => `あなたはITエンジニア向けのナレッジキュレーターです。
以下の記事本文を分析し、JSONのみを返してください。前置きやコードブロック記号は不要です。

記事本文:
${articleText}

以下のJSON形式で返してください:
{
  "title": "記事タイトル（元タイトルが適切なら流用）",
  "overview": "この記事が何についての記事かを1文で説明する。事実のみを記述し、重要性・価値の判断・推測は含めないこと",
  "summary": [
    {
      "heading": "<記事の章立てや話題の流れに沿った見出し>",
      "body": "その節の内容を詳述する。手順がある場合は全ステップを省略せず列挙し、数値・ベンチマーク・具体的な設定値があれば必ず含める。理由や背景が記事に書かれている場合は省略しない。箇条書き（「・」区切り）を使ってもよい。1つのbodyが2000文字を大きく超えそうな場合は、情報を省略せず、話題の区切りでheadingを分けて複数のsummary要素に分割すること"
    }
  ],
  "category": "AI/ML、開発、インフラ、セキュリティ、ビジネス、ツール、マネジメント、自己啓発、その他 のいずれか1つ",
  "tags": ["固有名詞・技術名を優先した3〜5個のキーワード"]
}

summaryのセクション数は記事の内容に応じて自由に決めること。記事の章立て・話題の展開に忠実に従い、重要な情報を省略しないこと。`;

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
  overview: string;
  summary: SummarySection[];
  category: string;
  tags: string[];
};

/**
 * Gemini APIに記事本文を送信し、要約・構造化した結果を返す。
 * 503エラーは指数バックオフで最大3回リトライする。429エラーはリトライせず即座にエラーを投げる。
 * @param articleText 要約対象の記事本文
 * @param geminiModel 使用するGeminiモデル名
 * @param geminiApiKey Gemini APIキー
 * @returns 要約・構造化された `GeminiResult`
 * @throws Gemini APIが有効なJSONを返さない場合、またはリトライ上限を超えた場合
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

  const options = {
    method: 'post' as const,
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  };

  let backoffMs = INITIAL_BACKOFF_MS;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const response = UrlFetchApp.fetch(endpoint, options);
    const status = response.getResponseCode();

    if (status === 200) {
      const result = JSON.parse(response.getContentText()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
      };
      const text = result.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

      const match = text.match(/{[\s\S]*}/);
      if (!match) {
        throw new Error('Gemini returned invalid JSON');
      }

      return JSON.parse(match[0]) as GeminiResult;
    }

    if (RETRYABLE_STATUSES.includes(status) && attempt < MAX_RETRIES) {
      Utilities.sleep(backoffMs);
      backoffMs *= 2;
      continue;
    }

    throw new Error(`Gemini API error: HTTP ${status}`);
  }

  throw new Error('Gemini API error: max retries exceeded');
}
