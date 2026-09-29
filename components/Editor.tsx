'use client';

import * as React from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import type { Editor as TiptapEditor } from '@tiptap/react';
import type { EditorView } from '@tiptap/pm/view';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import CharacterCount from '@tiptap/extension-character-count';
import { Bold, Italic, Heading1, Heading2, List, Quote, Code, Images } from 'lucide-react';
import { cn } from './ui/cn';
import { downscaleImage, blobToDataUrl } from '@/src/lib/images';

const EvidenceImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      sourceUrl: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-source-url'),
        renderHTML: (attributes) => attributes.sourceUrl ? { 'data-source-url': attributes.sourceUrl } : {},
      },
      sourceLabel: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-source-label'),
        renderHTML: (attributes) => attributes.sourceLabel ? { 'data-source-label': attributes.sourceLabel } : {},
      },
      imageLicense: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-image-license'),
        renderHTML: (attributes) => attributes.imageLicense ? { 'data-image-license': attributes.imageLicense } : {},
      },
      creator: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-creator'),
        renderHTML: (attributes) => attributes.creator ? { 'data-creator': attributes.creator } : {},
      },
    };
  },
});

export function Editor({
  html,
  onChange,
  onFindImages,
  editorRef,
  placeholder = '从这里开始写——或者在左侧创作指令面板里点「生成」。',
  className,
}: {
  html: string;
  onChange: (html: string) => void;
  onFindImages?: () => void;
  editorRef?: React.MutableRefObject<TiptapEditor | null>;
  placeholder?: string;
  className?: string;
}) {
  // 初始化阶段 Tiptap 会触发一次「空文档」onUpdate；用 ref 跳过首次回调，
  // 避免把刚 join 的双语内容或空白覆盖回 store。
  const firstUpdateRef = React.useRef(true);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      EvidenceImage.configure({ inline: false, allowBase64: true }),
      Placeholder.configure({ placeholder }),
      CharacterCount.configure({}),
    ],
    content: html || '',
    editorProps: {
      attributes: {
        class: 'prose-app max-w-prose focus:outline-none min-h-[40vh] sm:min-h-[60vh] py-6 px-8 mx-auto',
        role: 'textbox',
        'aria-label': '文章正文编辑器',
        'aria-multiline': 'true',
      },
      handlePaste(view, event) {
        const items = Array.from(event.clipboardData?.items ?? []);
        const imageItem = items.find((it) => it.type.startsWith('image/'));
        if (!imageItem) return false;
        const file = imageItem.getAsFile();
        if (!file) return false;
        event.preventDefault();
        void insertImageFile(view, file, null);
        return true;
      },
      handleDrop(view, event) {
        const file = event.dataTransfer?.files?.[0];
        if (!file || !file.type.startsWith('image/')) return false;
        event.preventDefault();
        void insertImageFile(view, file, { x: event.clientX, y: event.clientY });
        return true;
      },
    },
    onUpdate: ({ editor }) => {
      if (firstUpdateRef.current) {
        firstUpdateRef.current = false;
        return;
      }
      // 告诉 useEffect：下一帧到位的 prop 是我们自己写的，不是外部流入，
      // 这样就不会触发 setContent 把刚写入的内容再覆盖一次。
      pendingFromExternal.current = true;
      onChange(editor.getHTML());
    },
    immediatelyRender: false,
  });

  // 记录上一次传给编辑器的 html：仅当外部真的改写了内容（语言切换 / 生成 / 导入 / 改稿）
  // 才同步进编辑器，并保留一个可撤销步骤；自己的输入回传时不触发，避免打断撤销栈。
  const prevHtmlRef = React.useRef(html);
  // 区分「html 是用户输入产生的」和「html 是外部写入的」：用 pendingFromExternal 标记，
  // 避免 onUpdate → setContent 回流的同一个值被当成「外部变化」再覆盖回去。
  const pendingFromExternal = React.useRef(false);

  React.useEffect(() => {
    if (!editor) return;
    // 若是 onUpdate 触发的 prop 变化（前一次设置过 pendingFromExternal），跳过 setContent：
    // 这部分已经在编辑器里了，写回只会触发新一轮 onUpdate + 撤销栈错位。
    if (pendingFromExternal.current) {
      pendingFromExternal.current = false;
      prevHtmlRef.current = html;
      return;
    }
    if (prevHtmlRef.current !== html && editor.getHTML() !== html) {
      editor.commands.setContent(html || '', true);
    }
    prevHtmlRef.current = html;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html, editor]);

  // 把编辑器实例暴露给父组件（如联网配图面板在光标处插图）
  React.useEffect(() => {
    if (editorRef) editorRef.current = editor;
  }, [editor, editorRef]);

  if (!editor) return <div className={cn('text-ink-muted text-sm p-8', className)}>加载编辑器…</div>;

  const chars = editor.storage.characterCount?.characters?.() ?? 0;

  return (
    <div className={cn('flex flex-col h-full', className)}>
      <div className="sticky top-0 z-10 border-b border-ink-line bg-white/80 backdrop-blur">
        <div className="mx-auto max-w-prose flex items-center gap-1 overflow-x-auto px-4 py-2">
          <ToolbarBtn on={editor.isActive('heading', { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} title="一级标题" aria-label="H1"><Heading1 size={16}/></ToolbarBtn>
          <ToolbarBtn on={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} title="二级标题" aria-label="H2"><Heading2 size={16}/></ToolbarBtn>
          <Sep/>
          <ToolbarBtn on={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()} title="加粗" aria-label="加粗"><Bold size={16}/></ToolbarBtn>
          <ToolbarBtn on={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()} title="斜体" aria-label="斜体"><Italic size={16}/></ToolbarBtn>
          <ToolbarBtn on={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()} title="引用" aria-label="引用"><Quote size={16}/></ToolbarBtn>
          <ToolbarBtn on={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()} title="无序列表" aria-label="列表"><List size={16}/></ToolbarBtn>
          <ToolbarBtn on={editor.isActive('code')} onClick={() => editor.chain().focus().toggleCode().run()} title="行内代码" aria-label="代码"><Code size={16}/></ToolbarBtn>
          <Sep/>
          {/* 插入图片只保留「联网配图」入口；本地图片走粘贴/拖放（insertImageFile）。
              之前的 window.prompt 任意 URL 死代码已删除（iOS 键盘问题 + 危险 scheme 持久化的 XSS 风险）。 */}
          {onFindImages && (
            <button
              type="button"
              onClick={onFindImages}
              className="h-11 shrink-0 px-3 inline-flex items-center gap-1.5 rounded-md text-sm font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 transition-colors sm:h-8 sm:px-2 sm:text-xs"
              title="联网查找并插入有来源的图片"
            >
              <Images size={16}/> 配图
            </button>
          )}
          <div className="ml-auto shrink-0 text-[11px] text-ink-muted tabular-nums">{chars} 字</div>
        </div>
      </div>
      <EditorContent editor={editor} className="flex-1 overflow-y-auto" />
    </div>
  );
}

// 图片文件 → 降采样 dataURL → 单事务插入图片节点。
// 图注延后到用户主动编辑（点击图片后会出现在工具栏），避免 window.prompt 阻塞
// iOS PWA 键盘与 IME 输入流。
async function insertImageFile(
  view: EditorView,
  file: File,
  at: { x: number; y: number } | null,
) {
  let dataUrl: string;
  try {
    dataUrl = await downscaleImage(file);
  } catch {
    try {
      dataUrl = await blobToDataUrl(file);
    } catch {
      return;
    }
  }
  const { state } = view;
  const node = state.schema.nodes.image.create({ src: dataUrl, alt: '图片' });
  const pos = at
    ? view.posAtCoords({ left: at.x, top: at.y })?.pos ?? state.selection.from
    : state.selection.from;
  const tr = state.tr;
  if (at) {
    tr.insert(pos, node);
  } else {
    tr.replaceSelectionWith(node);
  }
  // 在图片之后插入一个空段落，让光标自动落在那里，避免 iOS 上 NodeSelection 没有键盘焦点。
  const afterPos = Math.min(tr.mapping.map(pos, 1), tr.doc.content.size);
  tr.insert(afterPos, state.schema.nodes.paragraph.create());
  view.dispatch(tr);
}

function ToolbarBtn({ on, onClick, children, ...rest }: { on?: boolean; onClick: () => void; children: React.ReactNode; [k: string]: unknown }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on ? 'true' : 'false'}
      className={cn(
        'h-11 w-11 shrink-0 inline-flex items-center justify-center rounded text-ink-soft hover:bg-ink-panel sm:h-8 sm:w-8',
        on && 'bg-ink-panel text-ink',
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
function Sep() { return <span className="mx-1 h-4 w-px shrink-0 bg-ink-line" />; }
