import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { FileStore, formatBytes } from '../../../../core/files/file-store';
import { MessageAttachment as Attachment } from '../../../../core/supabase/supabase.types';
import { MessageAttachment } from './message-attachment';

describe('formatBytes', () => {
  it('writes sizes the short way', () => {
    expect([120, 2048, 245760, 2.5 * 1024 * 1024].map(formatBytes)).toEqual(['120 B', '2 KB', '240 KB', '2.5 MB']);
  });
});

describe('MessageAttachment', () => {
  const url = vi.fn();
  let fixture: ComponentFixture<MessageAttachment>;
  let host: HTMLElement;
  const show = async (attachment: Attachment) => {
    fixture.componentRef.setInput('attachment', attachment);
    await fixture.whenStable();
  };
  const file = (type: string): Attachment => ({ kind: 'file', fileId: 'f1', name: 'terv.pdf', size: 245760, type });

  beforeEach(async () => {
    url.mockReset().mockReturnValue(of('blob:here'));
    await TestBed.configureTestingModule({
      imports: [MessageAttachment],
      providers: [{ provide: FileStore, useValue: { url } }],
    }).compileComponents();
    fixture = TestBed.createComponent(MessageAttachment);
    host = fixture.nativeElement;
  });

  it('shows a GIF at its size', async () => {
    await show({ kind: 'gif', giphyId: 'a', title: 'Happy cat', url: 'https://g/a.webp', width: 200, height: 150 });
    const img = host.querySelector('img') as HTMLImageElement;
    expect([img.getAttribute('src'), img.alt, img.width, img.height]).toEqual(['https://g/a.webp', 'Happy cat', 200, 150]);
    expect(url).not.toHaveBeenCalled();
  });

  it('shows a picture itself, to download on click', async () => {
    await show({ ...file('image/png'), name: 'board.png' } as Attachment);
    expect(url).toHaveBeenCalledWith('f1');
    expect(host.querySelector('img')?.getAttribute('src')).toBe('blob:here');
    expect(host.querySelector('a')?.getAttribute('download')).toBe('board.png');
  });

  it('shows any other file as a tile to download', async () => {
    await show(file('application/pdf'));
    const tile = host.querySelector('a.file')!;
    expect(tile.textContent).toContain('terv.pdf');
    expect(tile.textContent).toContain('240 KB');
    expect(tile.getAttribute('href')).toBe('blob:here');
    expect(tile.getAttribute('download')).toBe('terv.pdf');
  });

  it('says so when the file is not here', async () => {
    url.mockReturnValue(of(null));
    await show(file('application/pdf'));
    const tile = host.querySelector('a.file')!;
    expect(tile.classList).toContain('is-missing');
    expect(tile.hasAttribute('href')).toBe(false);
    expect(tile.textContent).toContain('Not on this device');
  });
});
