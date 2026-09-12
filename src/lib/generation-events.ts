export type GenerationStage =
  | 'source'
  | 'rules'
  | 'waiting'
  | 'streaming'
  // 双语稿补译阶段：正文已流完，正在追加英文版补译调用。事件形状与普通 stage 事件一致，
  // 老消费者不识别该 stage 时按未知 stage 透传/忽略即可，不会崩。
  | 'translating'
  | 'checking'
  | 'done';

export type GenerationStreamEvent =
  | {
      type: 'stage';
      requestId: string;
      stage: GenerationStage;
      label: string;
      detail?: string;
      at: number;
    }
  | {
      type: 'delta';
      requestId: string;
      chars: number;
      preview: string;
      at: number;
    }
  | {
      type: 'done';
      requestId: string;
      md: string;
      title?: string;
      durationMs: number;
      issues: number;
      at: number;
    }
  | {
      type: 'error';
      requestId: string;
      message: string;
      retryable: boolean;
      at: number;
    };

export interface GenerationViewState {
  requestId: string;
  startedAt: number;
  stage: GenerationStage;
  label: string;
  detail?: string;
  chars: number;
  preview?: string;
  completed: GenerationStage[];
}

