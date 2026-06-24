import { getSecretConfig } from './config';
import { createResponse } from './utils';

const INVALID_JSON_MESSAGE = 'Invalid JSON';
const UNAUTHORIZED_MESSAGE = 'Unauthorized';

/**
 * POSTリクエストの認証結果。
 */
export type PostAuthResult =
  | { success: true; body: Record<string, unknown> }
  | { success: false; response: GoogleAppsScript.Content.TextOutput };

/**
 * POSTリクエストのJSONパースと共有シークレットのトークン検証を行う。
 * @param e GASのDoPostイベントオブジェクト
 * @returns 認証成功時はパース済みボディ、失敗時はそのまま返せるレスポンス
 */
export function authenticatePostRequest(e: GoogleAppsScript.Events.DoPost): PostAuthResult {
  const body = parsePostBody(e);
  if (!body) {
    return { success: false, response: createResponse(false, INVALID_JSON_MESSAGE) };
  }

  const { secretToken } = getSecretConfig();
  if (body.token !== secretToken) {
    return { success: false, response: createResponse(false, UNAUTHORIZED_MESSAGE) };
  }

  return { success: true, body };
}

/**
 * POSTデータのcontentsをJSONオブジェクトとしてパースする。
 * @param e GASのDoPostイベントオブジェクト
 * @returns パース済みJSONオブジェクト。JSON不正、またはオブジェクトでない場合はnull
 */
function parsePostBody(e: GoogleAppsScript.Events.DoPost): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(e.postData.contents) as unknown;
    if (!isRecord(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * 値がJSONオブジェクトとして扱えるRecordかどうかを判定する。
 * @param value 判定対象の値
 * @returns Recordとして扱える場合はtrue
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
