import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  signal,
  viewChild
} from '@angular/core';
import {
  LucideDownload,
  LucideDynamicIcon,
  LucideEye,
  LucidePanelRightClose,
  LucidePanelRightOpen,
  LucidePaperclip,
  LucideSendHorizontal,
  LucideTrash2
} from '@lucide/angular';
import type { LucideIconData } from '@lucide/angular';
import { HttpErrorResponse } from '@angular/common/http';
import { EMPTY, catchError, finalize } from 'rxjs';
import { DragNDropComponent } from '../../shared/components/drag-n-drop/drag-n-drop.component';
import { ChatMessageComponent } from './chat-message.component';
import { ChatMessage, ChatMessageAttachment, ChatMessageStatus } from './chat-message.model';
import { AgentStatusComponent } from './agent-status.component';
import { FilePreviewComponent } from '../../shared/components/drag-n-drop/file-preview.component';
import { NotificationService } from '../../core/services/notification.service';
import { InitialChatStateService } from '../../core/services/initial-chat-state.service';
import { ChatMessageApi, KP_FILENAME } from '../../core/models/models';
import { ChatService } from '../../core/services/chat.service';
import { AttachmentDownloadService } from '../../core/services/attachment-download.service';
import { extractApiErrorMessage } from '../../shared/utils/api-error';
import { Router } from '@angular/router';
import { InputComponent } from '../../shared/components/input/input.component';
import { fileTypeStyleFor } from '../../shared/components/drag-n-drop/file-type-icons';
import { getFileExtension } from '../../shared/utils/upload-format';
import { DragOverlayComponent } from '../../shared/components/drag-n-drop/drag-overlay.component';

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

@Component({
  selector: 'app-calculation-chat',
  imports: [
    LucidePanelRightClose,
    LucidePanelRightOpen,
    LucidePaperclip,
    LucideSendHorizontal,
    LucideDownload,
    LucideEye,
    LucideDynamicIcon,
    DragNDropComponent,
    DragOverlayComponent,
    LucideTrash2,
    ChatMessageComponent,
    AgentStatusComponent,
    FilePreviewComponent,
    InputComponent
  ],
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.results-open]': 'isResultsOpen()'
  },
  templateUrl: './calculation-chat.html',
  styleUrl: './calculation-chat.scss'
})
export class CalculationChatComponent {
  readonly id = input.required<string>();
  readonly isResultsOpen = signal<boolean>(false);
  readonly agentStatus = signal<'thinking' | null>(null);
  readonly attachedFiles = signal<File[]>([]);
  readonly isUploading = signal(false);
  readonly isSending = signal(false);
  readonly lastMessageFailed = signal(false);
  readonly previewedFile = signal<File | null>(null);

  readonly sessionFiles = computed(() => {
    const seen = new Set<number>();
    const files: ChatMessageAttachment[] = [];
    for (const message of this.messages()) {
      for (const attachment of message.attachments ?? []) {
        if (attachment.attachmentId === undefined || seen.has(attachment.attachmentId)) {
          continue;
        }
        seen.add(attachment.attachmentId);
        files.push(attachment);
      }
    }
    return files;
  });

  fileIconFor(name: string): LucideIconData {
    return fileTypeStyleFor(getFileExtension(name)).icon;
  }

  fileColorFor(name: string): string {
    return fileTypeStyleFor(getFileExtension(name)).color;
  }

  openAttachmentPreview(attachment: ChatMessageAttachment) {
    if (attachment.file) {
      this.previewedFile.set(attachment.file);
      return;
    }
    this.fetchServerAttachment(attachment, (file) => this.previewedFile.set(file));
  }

  downloadAttachment(attachment: ChatMessageAttachment) {
    if (attachment.file) {
      this.attachmentDownload.save(attachment.file, attachment.file.name);
      return;
    }
    this.fetchServerAttachment(attachment, (file) => this.attachmentDownload.save(file, file.name));
  }

  private fetchServerAttachment(
    attachment: ChatMessageAttachment,
    onLoaded: (file: File) => void
  ): void {
    const attachmentId = attachment.attachmentId;
    if (!attachmentId) {
      return;
    }
    this.attachmentDownload.fetchFile(this.id(), attachmentId).subscribe({
      next: onLoaded,
      error: (err: unknown) => {
        this.notifications.error(
          err instanceof HttpErrorResponse
            ? 'Не удалось получить файл: ' + extractApiErrorMessage(err)
            : err instanceof Error
              ? err.message
              : 'Не удалось получить файл'
        );
      }
    });
  }

  private readonly chatMessages = viewChild<ElementRef<HTMLUListElement>>('chatMessages');
  private readonly dragNDrop = viewChild(DragNDropComponent);

  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private pollTimeoutTimer: ReturnType<typeof setTimeout> | null = null;

  private readonly notifications = inject(NotificationService);
  private readonly initialChatState = inject(InitialChatStateService);
  private readonly chatService = inject(ChatService);
  private readonly attachmentDownload = inject(AttachmentDownloadService);
  private readonly router = inject(Router);

  constructor() {
    inject(DestroyRef).onDestroy(() => this.clearAgentTimers());

    const initial = this.initialChatState.consume();
    this.hasPendingInitialMessage = initial !== null;
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
    }

    effect(() => {
      const sessionId = this.id();
      if (!sessionId) {
        return;
      }
      const isSessionSwitch = this.currentSessionId !== null;
      this.currentSessionId = sessionId;
      if (isSessionSwitch) {
        this.stopReplyPolling();
        this.messages.set([]);
        this.lastMessageFailed.set(false);
      }
      this.loadHistory(sessionId);
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
  private currentSessionId: string | null = null;
  private hasPendingInitialMessage = false;

  private loadHistory(sessionId: string): void {
    this.chatService
      .messages(sessionId)
      .pipe(
        catchError((err: HttpErrorResponse) => {
          if (err.status === 403) {
            this.notifications.error('Заявка не найдена');
          } else {
            this.notifications.error(
              'Не удалось загрузить историю чата: ' + extractApiErrorMessage(err)
            );
          }

          return EMPTY;
        })
      )
      .subscribe((apiMessages) => {
        if (this.id() !== sessionId) {
          return;
        }
        this.mergeApiMessages(apiMessages);

        const wasInitialSend = this.hasPendingInitialMessage;
        this.hasPendingInitialMessage = false;

        const last = this.messages()[this.messages().length - 1];
        if (last && last.direction === 'outgoing') {
          if (wasInitialSend) {
            this.startReplyPolling();
          } else {
            this.resumePollingIfAgentRunning(sessionId);
          }
        }
      });
  }

  private resumePollingIfAgentRunning(sessionId: string): void {
    this.chatService
      .result(sessionId)
      .pipe(catchError(() => EMPTY))
      .subscribe((chatResult) => {
        if (chatResult.running && this.id() === sessionId) {
          this.startReplyPolling();
        }
      });
  }

  private mergeApiMessages(apiMessages: ChatMessageApi[]): void {
    if (apiMessages.length === 0) {
      return;
    }

    const mapped = apiMessages.map((message) => this.mapApiMessage(message));
    const pending = [...this.messages().filter((message) => message.id < 0)];
    const merged: ChatMessage[] = [];
    for (const message of mapped) {
      const candidates = pending.filter((local) => local.direction === message.direction);
      if (candidates.length !== 1) {
        merged.push(message);
        continue;
      }
      const pendingIndex = pending.indexOf(candidates[0]);
      merged.push({
        ...message,
        attachments: message.attachments ?? pending[pendingIndex].attachments,
        status: message.status ?? pending[pendingIndex].status
      });
      pending.splice(pendingIndex, 1);
    }
    this.messages.set([...merged, ...pending]);
  }

  private mapApiMessage(message: ChatMessageApi): ChatMessage {
    return {
      id: message.id,
      direction: message.role === 'assistant' ? 'incoming' : 'outgoing',
      text: message.content,
      time: new Date(message.timestamp).toLocaleTimeString('ru-RU', {
        hour: '2-digit',
        minute: '2-digit'
      }),
      timestamp: message.timestamp,
      attachments: message.attachments.length
        ? message.attachments.map((attachment) => ({
            name: attachment.name,
            attachmentId: attachment.id
          }))
        : undefined
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
      if (this.attachedFiles().length > 0) {
        this.notifications.error('Добавьте текст к сообщению');
      }
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

    this.isSending.set(true);
    this.chatService
      .send(this.id(), text)
      .pipe(
        finalize(() => this.isSending.set(false)),
        catchError((err: HttpErrorResponse) => {
          this.notifications.error(
            'Не удалось отправить сообщение: ' + extractApiErrorMessage(err)
          );
          this.messages.update((messages) => messages.filter((m) => m.id !== messageId));
          this.messageInputValue.set(text);
          return EMPTY;
        })
      )
      .subscribe(() => {
        this.setStatusForMessage(messageId, 'sent');
        this.attachedFiles.set([]);
        this.dragNDrop()?.reset();
        this.startReplyPolling();
      });
  }

  private setStatusForMessage(messageId: number, status: ChatMessageStatus): void {
    this.messages.update((messages) =>
      messages.map((message) => (message.id === messageId ? { ...message, status } : message))
    );
  }

  onRetryRequest(): void {
    this.chatService
      .retry(this.id())
      .pipe(
        catchError((err: HttpErrorResponse) => {
          this.notifications.error(
            'Не удалось отправить повторный запрос: ' + extractApiErrorMessage(err)
          );
          return EMPTY;
        })
      )
      .subscribe(() => {
        this.notifications.success('Повторный запрос отправлен');
        this.startReplyPolling();
      });
  }

  private startReplyPolling() {
    this.stopReplyPolling();

    this.lastMessageFailed.set(false);
    this.agentStatus.set('thinking');
    this.pollTimer = setInterval(() => this.checkForResult(), POLL_INTERVAL_MS);
    this.pollTimeoutTimer = setTimeout(() => {
      this.stopReplyPolling();
      this.lastMessageFailed.set(true);
      this.notifications.error('Агент не ответил — попробуйте позже');
    }, POLL_TIMEOUT_MS);
  }

  deleteSession(): void {
    this.chatService
      .remove(this.id())
      .pipe(
        catchError((err: HttpErrorResponse) => {
          const detail = extractApiErrorMessage(err);
          this.notifications.error(
            detail === 'Invalid session'
              ? 'Сессия не найдена или уже удалена'
              : 'Не удалось удалить сессию: ' + detail
          );
          return EMPTY;
        })
      )
      .subscribe(() => {
        this.notifications.success('Сессия удалена');
        this.router.navigate(['/create']);
      });
  }

  private checkForResult() {
    const sessionId = this.id();
    this.chatService
      .result(sessionId)
      .pipe(catchError(() => EMPTY))
      .subscribe((chatResult) => {
        if (this.id() !== sessionId) {
          return;
        }
        if (chatResult.running || chatResult.result === null) {
          return;
        }

        this.stopReplyPolling();
        if (chatResult.result.type === 'error') {
          this.lastMessageFailed.set(true);
          this.notifications.error('Агент не смог обработать запрос — попробуйте позже');
          return;
        }

        const reply = chatResult.result;
        this.messages.update((messages) => {
          if (
            messages.some(
              (message) => message.direction === 'incoming' && message.timestamp === reply.timestamp
            )
          ) {
            return messages;
          }
          return [
            ...messages,
            {
              id: this.nextLocalMessageId--,
              direction: 'incoming',
              text: reply.content,
              timestamp: reply.timestamp,
              time: new Date(reply.timestamp).toLocaleTimeString('ru-RU', {
                hour: '2-digit',
                minute: '2-digit'
              }),
              attachments: reply.attachment_id
                ? [{ name: KP_FILENAME, attachmentId: reply.attachment_id }]
                : undefined
            }
          ];
        });
        if (reply.attachment_id) {
          this.notifications.success('Коммерческое предложение готово');
        } else {
          this.notifications.info('Агент ответил на ваше сообщение');
        }
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

  openFilePicker(): void {
    this.dragNDrop()?.openPicker();
  }

  onFilesDropped(files: File[]): void {
    this.dragNDrop()?.enqueue(files);
  }
}
