import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./config');

import { authenticatePostRequest } from './auth';
import { getSecretConfig } from './config';

const mockEvent = (contents: string): GoogleAppsScript.Events.DoPost =>
  ({ postData: { contents } }) as unknown as GoogleAppsScript.Events.DoPost;

describe('authenticatePostRequest', () => {
  beforeEach(() => {
    vi.mocked(getSecretConfig).mockReturnValue({
      secretToken: 'valid-token',
    });
  });

  it('不正なJSONの場合はInvalid JSONレスポンスを返す', () => {
    const result = authenticatePostRequest(mockEvent('invalid json'));

    expect(result.success).toBe(false);
    expect(ContentService.createTextOutput).toHaveBeenCalledWith(
      JSON.stringify({ success: false, message: 'Invalid JSON' })
    );
  });

  it('トークン不一致の場合はUnauthorizedレスポンスを返す', () => {
    const result = authenticatePostRequest(
      mockEvent(JSON.stringify({ token: 'wrong-token', url: 'https://example.com' }))
    );

    expect(result.success).toBe(false);
    expect(ContentService.createTextOutput).toHaveBeenCalledWith(
      JSON.stringify({ success: false, message: 'Unauthorized' })
    );
  });

  it('正常時はsuccess trueとパース済みボディを返す', () => {
    const body = { token: 'valid-token', url: 'https://example.com', extra: 123 };

    const result = authenticatePostRequest(mockEvent(JSON.stringify(body)));

    expect(result).toEqual({ success: true, body });
    expect(ContentService.createTextOutput).not.toHaveBeenCalled();
  });
});
