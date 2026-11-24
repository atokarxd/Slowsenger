import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { of, switchMap } from 'rxjs';
import { FileStore, formatBytes } from '../../../../core/files/file-store';
import { MessageAttachment as Attachment } from '../../../../core/supabase/supabase.types';

/**
 * A GIF or a file in the chat. GIFs and pictures show as themselves; any other file as a tile to download.
 * Files come from the file store: until it answers the tile shows the size, if it has nothing it says so.
 */
@Component({
  selector: 'app-message-attachment',
  templateUrl: './message-attachment.html',
  styleUrl: './message-attachment.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.is-outgoing]': 'outgoing()' },
})
export class MessageAttachment {
  private readonly files = inject(FileStore);

  readonly attachment = input.required<Attachment>();
  /** Sent by the signed-in user: their side's colours and corner. */
  readonly outgoing = input(false);

  /** undefined while looking it up, null when the file is not here. */
  readonly fileUrl = toSignal(
    toObservable(this.attachment).pipe(
      switchMap((attachment) => (attachment.kind === 'file' ? this.files.url(attachment.fileId) : of(null))),
    ),
    { initialValue: undefined },
  );

  readonly isPicture = computed(() => {
    const attachment = this.attachment();
    return attachment.kind === 'file' && attachment.type.startsWith('image/');
  });

  readonly size = computed(() => {
    const attachment = this.attachment();
    return attachment.kind === 'file' ? formatBytes(attachment.size) : '';
  });
}
