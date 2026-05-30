import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { log } from './log';

describe('log', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('info', () => {
    it('モジュール名とメッセージを含む形式で console.log を呼ぶ', () => {
      log.info('myModule', 'test message');
      expect(console.log).toHaveBeenCalledWith('[myModule] test message');
    });

    it('コンテキストを JSON で付加する', () => {
      log.info('myModule', 'test message', { key: 'value' });
      expect(console.log).toHaveBeenCalledWith('[myModule] test message | {"key":"value"}');
    });
  });

  describe('warn', () => {
    it('console.warn を呼ぶ', () => {
      log.warn('myModule', 'warning');
      expect(console.warn).toHaveBeenCalledWith('[myModule] warning');
    });

    it('コンテキストを JSON で付加する', () => {
      log.warn('myModule', 'warning', { code: 404 });
      expect(console.warn).toHaveBeenCalledWith('[myModule] warning | {"code":404}');
    });
  });

  describe('error', () => {
    it('モジュール名とメッセージを含む形式で console.error を呼ぶ', () => {
      log.error('myModule', 'error occurred');
      expect(console.error).toHaveBeenCalledWith('[myModule] error occurred');
    });

    it('Error オブジェクトのメッセージを付加する', () => {
      log.error('myModule', 'error occurred', new Error('something went wrong'));
      expect(console.error).toHaveBeenCalledWith('[myModule] error occurred Error: something went wrong');
    });

    it('文字列エラーをそのまま付加する', () => {
      log.error('myModule', 'error occurred', 'raw error');
      expect(console.error).toHaveBeenCalledWith('[myModule] error occurred raw error');
    });

    it('コンテキストとエラーの両方を付加する', () => {
      log.error('myModule', 'error occurred', new Error('fail'), { pageId: '123' });
      expect(console.error).toHaveBeenCalledWith(
        '[myModule] error occurred | {"pageId":"123"} Error: fail',
      );
    });

    it('エラーなしでコンテキストのみ付加する', () => {
      log.error('myModule', 'error occurred', undefined, { status: 500 });
      expect(console.error).toHaveBeenCalledWith('[myModule] error occurred | {"status":500}');
    });
  });
});
