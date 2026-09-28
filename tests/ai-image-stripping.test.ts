import { describe, expect, it } from "vitest";
import {
  stripImagePayloads,
  stripImagePayloadsForRefinement,
} from "@/src/lib/ai";

describe("stripImagePayloads", () => {
  it("converts markdown image syntax to numbered placeholders", () => {
    const out = stripImagePayloads("正文开始\n\n![一只猫](https://example.com/cat.jpg)\n\n更多正文");
    expect(out).toContain("[[图片 1]]");
    expect(out).toContain("配图说明：一只猫");
    expect(out).not.toContain("https://example.com/cat.jpg");
  });

  it("falls back to default description when alt is empty", () => {
    const out = stripImagePayloads("![](/a.png)");
    expect(out).toContain("图片 1");
    expect(out).not.toContain("](/a.png)");
  });

  it("numbers multiple images sequentially", () => {
    const out = stripImagePayloads("![一](a.png)\n\n中间\n\n![二](b.png)");
    expect(out).toContain("[[图片 1]]");
    expect(out).toContain("[[图片 2]]");
  });

  it("strips inline base64 payloads", () => {
    // Markdown ![alt](data:...) 走第一个 regex，变成编号占位符；
    // 这里验的是「不会有 base64 字符串泄露给 LLM」这一不变量。
    const big =
      "![内嵌](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=)";
    const out = stripImagePayloads(big);
    expect(out).not.toMatch(/base64,/i);
    expect(out).not.toMatch(/AAAANSUhEUg/i);
    expect(out).toContain("配图说明");
  });

  it("strips naked base64 data URLs that escape the markdown regex", () => {
    const naked = "正文 data:image/png;base64,AAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAA 结束";
    const out = stripImagePayloads(naked);
    expect(out).toContain("内嵌图片数据已省略");
    expect(out).not.toMatch(/base64,/i);
  });

  it("converts HTML img tags with alt to placeholders", () => {
    const out = stripImagePayloads('正文 <img src="x.png" alt="封面图" /> 结束');
    expect(out).toContain("配图说明：封面图");
    expect(out).not.toContain("<img");
  });

  it("returns text untouched when no images are present", () => {
    const text = "纯文字内容，没有图片。";
    expect(stripImagePayloads(text)).toBe(text);
  });
});

describe("stripImagePayloadsForRefinement", () => {
  it("keeps remote URLs intact for refinement", () => {
    const out = stripImagePayloadsForRefinement("![封面](https://example.com/x.jpg)");
    expect(out).toContain("https://example.com/x.jpg");
    expect(out).not.toContain("OMNIWRITER_LOCAL_IMAGE");
  });

  it("replaces base64 data URLs with stable local markers", () => {
    const out = stripImagePayloadsForRefinement(
      "![内嵌](data:image/png;base64,AAAAAAAAAAAA)",
    );
    expect(out).toContain("OMNIWRITER_LOCAL_IMAGE_1");
    expect(out).not.toMatch(/base64,/i);
  });

  it("numbers multiple local images sequentially", () => {
    const out = stripImagePayloadsForRefinement(
      "![一](data:image/png;base64,AAA)\n\n![二](data:image/jpeg;base64,BBB)",
    );
    expect(out).toContain("OMNIWRITER_LOCAL_IMAGE_1");
    expect(out).toContain("OMNIWRITER_LOCAL_IMAGE_2");
  });

  it("returns plain text untouched", () => {
    const text = "没有任何图片标记的文本。";
    expect(stripImagePayloadsForRefinement(text)).toBe(text);
  });
});