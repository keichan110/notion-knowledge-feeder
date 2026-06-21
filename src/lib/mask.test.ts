import { describe, expect, it } from 'vitest';
import { maskPii } from './mask';

describe('maskPii', () => {
  it('http/https のURLをパスとクエリごとリンクに置換する', () => {
    expect(
      maskPii(
        '詳細は https://example.com/users/token-123?email=user@example.com&id=abc と http://example.net/a/b?x=1 を確認'
      )
    ).toBe('詳細は [リンク] と [リンク] を確認');
  });

  it('URL直後の日本語本文は置換しない', () => {
    expect(maskPii('https://example.com/path?token=abcを確認してください')).toBe(
      '[リンク]を確認してください'
    );
  });

  it('メールアドレスを置換する', () => {
    expect(maskPii('連絡先は user.name+tag@example.co.jp です')).toBe(
      '連絡先は [メールアドレス] です'
    );
  });

  it('ラベル付き番号の値だけをIDに置換する', () => {
    expect(maskPii('会員番号: 12345\nお客様番号　98765\n購読者ID: abc-123\n会員ID xyz_789')).toBe(
      '会員番号: [ID]\nお客様番号　[ID]\n購読者ID: [ID]\n会員ID [ID]'
    );
  });

  it('ラベルの無い日付・金額・時刻・電話番号は置換しない', () => {
    const text = '2026/06/30まで、6月30日締切。参加費は1,000円、開始は19:30、電話は03-1234-5678。';

    expect(maskPii(text)).toBe(text);
  });

  it('マスク対象が無いテキストはそのまま返す', () => {
    expect(maskPii('セミナー申込期限は2026/06/30までです')).toBe(
      'セミナー申込期限は2026/06/30までです'
    );
  });
});
