import {
  afterRenderEffect,
  Component,
  DestroyRef,
  ElementRef,
  inject,
  input,
  signal,
  viewChild
} from '@angular/core';
import {
  LucideFileText,
  LucideHistory,
  LucidePanelRightClose,
  LucidePanelRightOpen,
  LucidePaperclip,
  LucideSendHorizontal
} from '@lucide/angular';
import { ProgressBarComponent } from '../../shared/components/progress-bar/progress-bar.component';
import { DragNDropComponent } from '../../shared/components/drag-n-drop/drag-n-drop.component';
import { ChatMessageComponent } from './chat-message.component';
import { ChatMessage, ChatMessageAttachment } from './chat-message.model';
import { AgentStatusComponent } from './agent-status.component';
import { FilePreviewComponent } from '../../shared/components/drag-n-drop/file-preview.component';
import { NotificationService } from '../../core/services/notification.service';

const AGENT_REPLY =
  'Готово! Предварительный расчёт для резервуара 10 м³ готов — итоговые параметры смотрите в панели «Результаты расчёта».';

const TYPING_AFTER_MS = 3200;
const REPLY_AFTER_MS = 1400;

const MOCK_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

function mockFile(name: string): File {
  const bytes = Uint8Array.from(atob(MOCK_PNG_BASE64), (char) => char.charCodeAt(0));
  return new File([bytes], name, { type: 'image/png' });
}

@Component({
  selector: 'app-calculation-chat',
  imports: [
    LucidePanelRightClose,
    LucidePanelRightOpen,
    LucidePaperclip,
    LucideSendHorizontal,
    LucideFileText,
    LucideHistory,
    ProgressBarComponent,
    DragNDropComponent,
    ChatMessageComponent,
    AgentStatusComponent,
    FilePreviewComponent
  ],
  standalone: true,
  host: {
    '[class.results-open]': 'isResultsOpen()',
    '(document:pointerdown)': 'onDocumentPointerdown($event)',
    '(document:keydown.escape)': 'closeAttachPopup()'
  },
  templateUrl: './calculation-chat.html',
  styleUrl: './calculation-chat.scss'
})
export class CalculationChatComponent {
  readonly id = input.required<string>();
  readonly isResultsOpen = signal<boolean>(false);
  readonly isAttachPopupOpen = signal<boolean>(false);
  readonly agentStatus = signal<'thinking' | 'typing' | null>(null);
  readonly attachedFiles = signal<File[]>([]);
  readonly isUploading = signal(false);
  readonly previewedFile = signal<File | null>(null);

  openAttachmentPreview(attachment: ChatMessageAttachment) {
    if (attachment.file) {
      this.previewedFile.set(attachment.file);
    }
  }

  private readonly attachAnchor = viewChild<ElementRef<HTMLElement>>('attachAnchor');
  private readonly messageInput =
    viewChild.required<ElementRef<HTMLTextAreaElement>>('messageInput');
  private readonly chatMessages = viewChild<ElementRef<HTMLUListElement>>('chatMessages');
  private readonly dragNDrop = viewChild(DragNDropComponent);

  private thinkingTimer: ReturnType<typeof setTimeout> | null = null;
  private replyTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly notifications = inject(NotificationService);

  constructor() {
    inject(DestroyRef).onDestroy(() => this.clearAgentTimers());

    afterRenderEffect({
      write: () => {
        const log = this.chatMessages()?.nativeElement;
        if (!log || (this.messages().length === 0 && this.agentStatus() === null)) {
          return;
        }
        const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        log.scrollTo({ top: log.scrollHeight, behavior: prefersReducedMotion ? 'auto' : 'smooth' });
      }
    });
  }

  readonly messages = signal<ChatMessage[]>([
    { id: 1, direction: 'incoming', text: 'Здравствуйте! Чем могу помочь?', time: '10:21' },
    {
      id: 2,
      direction: 'outgoing',
      text: 'Нужно рассчитать резервуар объёмом 10 м³...',
      time: '10:22',
      status: 'read',
      attachments: [{ name: 'tank-spec.png', size: 245760, file: mockFile('tank-spec.png') }]
    }
  ]);
  private nextMessageId = 3;

  handleResultsOpen() {
    this.isResultsOpen.set(!this.isResultsOpen());
  }

  onMessageKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.sendMessage();
    }
  }

  resizeMessageInput() {
    const textarea = this.messageInput().nativeElement;
    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight}px`;
  }

  onFilesChange(files: File[]) {
    this.attachedFiles.set(files);
  }

  sendMessage(event?: Event) {
    event?.preventDefault();

    if (this.isUploading()) {
      this.notifications.warning('Файлы ещё не все загрузились — дождитесь завершения');
      return;
    }

    const textarea = this.messageInput().nativeElement;
    const text = textarea.value.trim();
    if (!text) {
      return;
    }

    const attachments = this.attachedFiles().map((file) => ({
      name: file.name,
      size: file.size,
      file
    }));

    this.messages.update((messages) => [
      ...messages,
      {
        id: this.nextMessageId++,
        direction: 'outgoing',
        text,
        time: this.formatTime(),
        status: 'sent',
        attachments: attachments.length > 0 ? attachments : undefined
      }
    ]);
    textarea.value = '';
    this.resizeMessageInput();

    this.attachedFiles.set([]);
    this.dragNDrop()?.reset();

    this.simulateAgentReply();
  }

  private formatTime() {
    return new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  }

  private simulateAgentReply() {
    if (this.agentStatus() !== null) {
      return;
    }

    this.agentStatus.set('thinking');
    this.thinkingTimer = setTimeout(() => {
      this.agentStatus.set('typing');
      this.replyTimer = setTimeout(() => {
        this.messages.update((messages) => [
          ...messages,
          {
            id: this.nextMessageId++,
            direction: 'incoming',
            text: AGENT_REPLY,
            time: this.formatTime()
          }
        ]);
        this.notifications.info('Агент ответил на ваше сообщение');
        this.agentStatus.set(null);
      }, REPLY_AFTER_MS);
    }, TYPING_AFTER_MS);
  }

  private clearAgentTimers() {
    if (this.thinkingTimer !== null) {
      clearTimeout(this.thinkingTimer);
    }
    if (this.replyTimer !== null) {
      clearTimeout(this.replyTimer);
    }
  }

  toggleAttachPopup() {
    this.isAttachPopupOpen.set(!this.isAttachPopupOpen());
  }

  closeAttachPopup() {
    this.isAttachPopupOpen.set(false);
  }

  onDocumentPointerdown(event: PointerEvent) {
    if (!this.isAttachPopupOpen()) {
      return;
    }
    const anchor = this.attachAnchor()?.nativeElement;
    if (anchor && !anchor.contains(event.target as Node)) {
      this.closeAttachPopup();
    }
  }
}
