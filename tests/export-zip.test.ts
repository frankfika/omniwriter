// export-zip.buildZip 自检：ZIP 条目名校验（路径穿越防护）。
import { describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import { buildZip } from '../src/lib/export-zip';

const base = { title: '测试标题', mdBody: '# 测试标题\n\n正文', mdRaw: '# 测试标题\n\n正文' };

async function entryNames(blob: Blob): Promise<string[]> {
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  return Object.keys(zip.files).sort();
}

describe('buildZip 图片条目名校验', () => {
  it('路径穿越（../、子目录、反斜杠）一律拒绝', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const blob = await buildZip({
      ...base,
      images: {
        '../evil.png': 'data:image/png;base64,aGk=',
        'images/../../evil.png': 'data:image/png;base64,aGk=',
        'images/../evil.png': 'data:image/png;base64,aGk=',
        '..\\evil.png': 'data:image/png;base64,aGk=',
        'sub/dir.png': 'data:image/png;base64,aGk=',
        'my photo.png': 'data:image/png;base64,aGk=',
        '01_ok.png': 'data:image/png;base64,aGk=',
      },
    });
    const names = await entryNames(blob);
    expect(names).toContain('images/01_ok.png');
    expect(names.some((n) => n.includes('evil') || n.includes('sub') || n.includes('photo'))).toBe(false);
    expect(warn).toHaveBeenCalledTimes(6);
    warn.mockRestore();
  });

  it('合法名统一写入 images/（客户端带的 images/ 前缀不嵌套）', async () => {
    const blob = await buildZip({
      ...base,
      images: {
        '01_a.png': 'data:image/png;base64,aGk=',
        'images/02_b.jpg': 'data:image/jpeg;base64,aGk=',
      },
    });
    const names = await entryNames(blob);
    expect(names).toContain('article.md');
    expect(names).toContain('article.html');
    expect(names).toContain('images/01_a.png');
    expect(names).toContain('images/02_b.jpg');
    expect(names.some((n) => n.startsWith('images/images/'))).toBe(false);
  });

  it('base64 内容解码正确', async () => {
    const blob = await buildZip({ ...base, images: { '01_a.txt': 'data:text/plain;base64,aGVsbG8=' } });
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    await expect(zip.file('images/01_a.txt')!.async('string')).resolves.toBe('hello');
  });
});
