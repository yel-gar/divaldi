import {
  afterRenderEffect,
  Component,
  DestroyRef,
  effect,
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
import { HttpErrorResponse } from '@angular/common/http';
import { EMPTY, catchError, finalize } from 'rxjs';
import { ProgressBarComponent } from '../../shared/components/progress-bar/progress-bar.component';
import { DragNDropComponent } from '../../shared/components/drag-n-drop/drag-n-drop.component';
import { ChatMessageComponent } from './chat-message.component';
import { ChatMessage, ChatMessageAttachment, ChatMessageStatus } from './chat-message.model';
import { AgentStatusComponent } from './agent-status.component';
import { FilePreviewComponent } from '../../shared/components/drag-n-drop/file-preview.component';
import { NotificationService } from '../../core/services/notification.service';
import { InitialChatStateService } from '../../core/services/initial-chat-state.service';
import { ChatMessageApi } from '../../core/models/models';
import { ChatService } from '../../core/services/chat.service';
import { InputComponent } from '../../shared/components/input/input.component';

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

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
    FilePreviewComponent,
    InputComponent
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
  readonly isSending = signal(false);
  readonly previewedFile = signal<File | null>(null);

  openAttachmentPreview(attachment: ChatMessageAttachment) {
    if (attachment.file) {
      this.previewedFile.set(attachment.file);
    }
  }

  private readonly attachAnchor = viewChild<ElementRef<HTMLElement>>('attachAnchor');
  private readonly chatMessages = viewChild<ElementRef<HTMLUListElement>>('chatMessages');
  private readonly dragNDrop = viewChild(DragNDropComponent);

  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private pollTimeoutTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly notifications = inject(NotificationService);
  private readonly initialChatState = inject(InitialChatStateService);
  private readonly chatService = inject(ChatService);

  constructor() {
    inject(DestroyRef).onDestroy(() => this.clearAgentTimers());

    const initial = this.initialChatState.consume();
    if (initial) {
      this.messages.set([
        {
          id: this.nextLocalMessageId--,
          direction: 'outgoing',
          text: initial.text,
          time: this.formatTime(),
          status: 'sent',
          attachments: initial.files.length
            ? initial.files.map((file) => ({ name: file.name, size: file.size, file }))
            : undefined
        }
      ]);
      this.hasLocalAttachments = initial.files.length > 0;
    }

    effect(() => {
      const sessionId = this.id();
      if (sessionId) {
        this.loadHistory(sessionId);
      }
    });

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

  readonly messages = signal<ChatMessage[]>([]);
  private nextLocalMessageId = -1;
  private hasLocalAttachments = false;

  private loadHistory(sessionId: string): void {
    this.chatService
      .messages(sessionId)
      .pipe(
        catchError((err: HttpErrorResponse) => {
          this.notifications.error(
            'Не удалось загрузить историю чата: ' +
              (err.error?.detail ?? err.message ?? 'Ошибка сервера')
          );
          return EMPTY;
        })
      )
      .subscribe((apiMessages) => {
        if (apiMessages.length === 0) {
          return;
        }
        const mapped = apiMessages.map((message) => this.mapApiMessage(message));
        if (this.hasLocalAttachments && mapped[0]?.direction === 'outgoing') {
          this.hasLocalAttachments = false;
          mapped[0] = { ...mapped[0], attachments: this.messages()[0]?.attachments };
        }
        this.messages.set(mapped);
      });
  }

  private mapApiMessage(message: ChatMessageApi): ChatMessage {
    return {
      id: message.id,
      direction: message.role === 'assistant' ? 'incoming' : 'outgoing',
      text: message.content,
      time: new Date(message.timestamp).toLocaleTimeString('ru-RU', {
        hour: '2-digit',
        minute: '2-digit'
      })
    };
  }

  readonly messageInputValue = signal('');

  handleResultsOpen() {
    this.isResultsOpen.set(!this.isResultsOpen());
  }

  onMessageInput(event: Event) {
    const target = event.target as HTMLTextAreaElement;
    this.messageInputValue.set(target.value);
  }

  onMessageKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.sendMessage();
    }
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
    if (this.isSending() || this.agentStatus() !== null) {
      return;
    }

    const text = this.messageInputValue().trim();
    if (!text) {
      return;
    }

    const attachments = this.attachedFiles().map((file) => ({
      name: file.name,
      size: file.size,
      file
    }));
    const messageId = this.nextLocalMessageId--;

    this.messages.update((messages) => [
      ...messages,
      {
        id: messageId,
        direction: 'outgoing',
        text,
        time: this.formatTime(),
        status: 'sending',
        attachments: attachments.length > 0 ? attachments : undefined
      }
    ]);
    this.messageInputValue.set('');
    this.attachedFiles.set([]);
    this.dragNDrop()?.reset();

    this.isSending.set(true);
    this.chatService
      .send(this.id(), text)
      .pipe(
        finalize(() => this.isSending.set(false)),
        catchError((err: HttpErrorResponse) => {
          this.notifications.error(
            'Не удалось отправить сообщение: ' +
              (err.error?.detail ?? err.error?.message ?? err.message ?? 'Ошибка сервера')
          );
          this.messages.update((messages) => messages.filter((m) => m.id !== messageId));
          this.messageInputValue.set(text);
          return EMPTY;
        })
      )
      .subscribe(() => {
        this.setStatusForMessage(messageId, 'sent');
        this.startReplyPolling();
      });
  }

  private setStatusForMessage(messageId: number, status: ChatMessageStatus): void {
    this.messages.update((messages) =>
      messages.map((message) => (message.id === messageId ? { ...message, status } : message))
    );
  }

  private startReplyPolling() {
    if (this.agentStatus() !== null) {
      return;
    }

    this.agentStatus.set('thinking');
    this.pollTimer = setInterval(() => this.checkForReply(), POLL_INTERVAL_MS);
    this.pollTimeoutTimer = setTimeout(() => {
      this.stopReplyPolling();
      this.notifications.error('Агент не ответил — попробуйте позже');
    }, POLL_TIMEOUT_MS);
  }

  private checkForReply() {
    this.chatService
      .messages(this.id())
      .pipe(catchError(() => EMPTY))
      .subscribe((apiMessages) => {
        const last = apiMessages[apiMessages.length - 1];
        if (!last || last.role !== 'assistant') {
          return;
        }
        this.stopReplyPolling();
        this.messages.update((messages) => {
          if (messages.some((message) => message.id === last.id)) {
            return messages;
          }
          return [...messages, this.mapApiMessage(last)];
        });
        this.notifications.info('Агент ответил на ваше сообщение');
      });
  }

  private stopReplyPolling() {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.pollTimeoutTimer !== null) {
      clearTimeout(this.pollTimeoutTimer);
      this.pollTimeoutTimer = null;
    }
    this.agentStatus.set(null);
  }

  private formatTime() {
    return new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  }

  private clearAgentTimers() {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer);
    }
    if (this.pollTimeoutTimer !== null) {
      clearTimeout(this.pollTimeoutTimer);
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
