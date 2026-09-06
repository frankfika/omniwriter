import type { Metadata, Viewport } from 'next';
import { AvailabilityStatus } from '@/components/AvailabilityStatus';
import './globals.css';

export const metadata: Metadata = {
  title: 'OmniWriter · 多平台 AI 创作工作台',
  description: '多平台 AI 创作工作台，专为公众号、X、知乎、小红书、B站、CSDN、Reddit、Hacker News、Product Hunt 设计。',
  manifest: '/manifest.webmanifest',
};

// viewport-fit=cover 让 iOS 刘海屏可用 env(safe-area-inset-*) 撑开安全区，
// 否则 CSS 里的 safe-area 变量全部失效（iOS 编辑器底栏会被 Home 条遮挡）。
export const viewport: Viewport = {
  viewportFit: 'cover',
  themeColor: '#f5f5f7',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <head>
        {/*
          ponytail: 屏蔽钱包插件(chrome-extension://…)抛出的脚本异常,最常见的是
          Rabby/MetaMask 互相 Object.defineProperty(window,'ethereum') 时第二次
          写入因 configurable:false 失败。源头不在我们代码里,但 dev overlay 会
          把这类 unhandled error 当成我们的运行时报错挡屏。这里在捕获阶段
          先一步 stopImmediatePropagation,阻止它冒泡到 Next 的错误处理。
          真实修复路径:卸掉冲突的钱包扩展;或保留一个、禁用另一个。
        */}
        <script
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{
            __html: `window.addEventListener('error',function(e){if(e.filename&&e.filename.indexOf('chrome-extension://')===0){e.stopImmediatePropagation();e.preventDefault();return true;}},true);window.addEventListener('unhandledrejection',function(e){var r=e.reason;var src=r&&(r.filename||(r.stack&&String(r.stack)));if(src&&String(src).indexOf('chrome-extension://')===0){e.stopImmediatePropagation();e.preventDefault();}},true);`,
          }}
        />
      </head>
      <body className="font-sans text-ink antialiased">
        {children}
        <AvailabilityStatus />
      </body>
    </html>
  );
}
