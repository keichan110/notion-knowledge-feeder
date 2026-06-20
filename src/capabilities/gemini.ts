const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;
const RETRYABLE_STATUSES = [503];

// Gemini 3 系の thinking レベル。要約精度を優先し medium を指定する（コストはリクエスト数依存のため影響しない）。
const THINKING_LEVEL = 'medium';

export type GeminiModel =
  | 'gemini-3.5-flash'
  | 'gemini-3.1-pro-preview'
  | 'gemini-3.1-flash-lite'
  | 'gemini-2.5-flash'
  | 'gemini-2.5-flash-lite'
  | 'gemini-2.5-pro';
export type GeminiApiKey = string;

export type GeminiResponseSchema = Record<string, unknown>;

export type CallGeminiAPIParams = {
  geminiModel: GeminiModel;
  geminiApiKey: GeminiApiKey;
  systemInstruction: string;
  userContent: string;
  responseSchema?: GeminiResponseSchema;
};

/**
 * Gemini APIにユーザーコンテンツを送信し、応答テキストを返す。
 * 503エラーは指数バックオフで最大3回リトライする。429エラーはリトライせず即座にエラーを投げる。
 * @param params Gemini API呼び出しパラメータ
 * @returns Geminiの応答テキスト
 * @throws Gemini APIが有効なレスポンスを返さない場合、またはリトライ上限を超えた場合
 */
export function callGeminiAPI(params: CallGeminiAPIParams): string {
  const { geminiModel, geminiApiKey, systemInstruction, userContent, responseSchema } = params;
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${geminiApiKey}`;

  const generationConfig: Record<string, unknown> = {
    // Gemini 3 系は temperature 1.0（デフォルト）が推奨。下げるとループや性能劣化を招きうる。
    // 忠実性・憶測抑制は temperature ではなく systemInstruction・responseSchema・thinkingLevel で担保する。
    temperature: 1.0,
    responseMimeType: 'application/json',
  };
  if (responseSchema) generationConfig.responseSchema = responseSchema;
  // thinkingLevel は Gemini 3 系専用。2.5 系は thinkingBudget 方式で非対応のため設定しない。
  if (geminiModel.startsWith('gemini-3')) {
    generationConfig.thinkingConfig = { thinkingLevel: THINKING_LEVEL };
  }

  const payload = {
    systemInstruction: { parts: [{ text: systemInstruction }] },
    contents: [{ parts: [{ text: userContent }] }],
    generationConfig,
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
      const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        throw new Error('Gemini returned invalid response');
      }
      return text;
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
