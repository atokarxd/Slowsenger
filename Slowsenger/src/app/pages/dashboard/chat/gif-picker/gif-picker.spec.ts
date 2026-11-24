import { ComponentFixture, TestBed } from '@angular/core/testing';

import { GifResult, GiphyError, GiphyService } from '../../../../core/giphy/giphy.service';
import { GifPicker } from './gif-picker';

describe('GifPicker', () => {
  const result = (id: string): GifResult => ({
    id, title: `${id} gif`, gif: { kind: 'gif', giphyId: id, title: `${id} gif`, url: `https://g/${id}.webp`, width: 200, height: 150 },
  });
  // A new mock for every test: a rejecting implementation set on a reused mock leaves Vitest's own
  // promise unhandled, though the component handles the rejection it gets
  let find: ReturnType<typeof vi.fn>;
  let fixture: ComponentFixture<GifPicker>;
  let host: HTMLElement;
  const tiles = () => host.querySelectorAll<HTMLButtonElement>('.gif');
  const settle = async (ms = 0) => {
    await new Promise((resolve) => setTimeout(resolve, ms));
    await fixture.whenStable();
  };

  const create = async (configured: boolean) => {
    await TestBed.configureTestingModule({
      imports: [GifPicker],
      providers: [{ provide: GiphyService, useValue: { configured, find } }],
    }).compileComponents();
    fixture = TestBed.createComponent(GifPicker);
    host = fixture.nativeElement;
    fixture.componentRef.setInput('open', true);
    await settle();
  };

  beforeEach(() => {
    find = vi.fn(async () => [result('a'), result('b')]);
  });

  it('shows what is trending when it opens, with GIPHY named', async () => {
    await create(true);
    expect(find).toHaveBeenCalledWith('', expect.any(AbortSignal));
    expect(tiles().length).toBe(2);
    expect(host.querySelector('.attribution')?.textContent).toContain('Powered by GIPHY');
  });

  it('searches once typing stops, not on every key', async () => {
    await create(true);
    find.mockClear();
    const input = host.querySelector('input') as HTMLInputElement;
    for (const value of ['c', 'ca', 'cat']) {
      input.value = value;
      input.dispatchEvent(new Event('input'));
    }
    await settle(400);
    expect(find).toHaveBeenCalledTimes(1);
    expect(find).toHaveBeenCalledWith('cat', expect.any(AbortSignal));
  });

  it('hands over the picked GIF', async () => {
    await create(true);
    const picked = vi.fn();
    fixture.componentInstance.picked.subscribe(picked);
    tiles()[1].click();
    expect(picked).toHaveBeenCalledWith(result('b').gif);
  });

  it('says what went wrong', async () => {
    find = vi.fn(async () => {
      throw new GiphyError('The GIPHY key’s hourly limit is used up. Try again later.');
    });
    await create(true);
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('hourly limit');
  });

  it('says the key is missing instead of searching', async () => {
    await create(false);
    expect(find).not.toHaveBeenCalled();
    expect(host.textContent).toContain('No GIPHY API key yet');
    expect((host.querySelector('input') as HTMLInputElement).disabled).toBe(true);
    expect((host.querySelector('.toggle') as HTMLButtonElement).disabled).toBe(true);
  });

  describe('search circle', () => {
    const toggle = () => host.querySelector('.toggle') as HTMLButtonElement;
    const field = () => host.querySelector('.field') as HTMLInputElement;
    const isOpen = () => host.querySelector('.search')!.classList.contains('is-open');
    const type = (value: string) => {
      field().value = value;
      field().dispatchEvent(new Event('input'));
    };

    it('starts folded, with the circle focused and the field out of the tab order', async () => {
      await create(true);
      expect(isOpen()).toBe(false);
      expect(document.activeElement).toBe(toggle());
      expect(field().getAttribute('tabindex')).toBe('-1');
      expect(toggle().getAttribute('aria-expanded')).toBe('false');
    });

    it('pops the field out and puts the caret in it', async () => {
      await create(true);
      toggle().click();
      await settle();
      expect(isOpen()).toBe(true);
      expect(document.activeElement).toBe(field());
      expect(field().hasAttribute('tabindex')).toBe(false);
      expect(toggle().getAttribute('aria-expanded')).toBe('true');
    });

    it('folds back when an empty field is left, but stays out with a search in it', async () => {
      await create(true);
      toggle().click();
      await settle();
      field().dispatchEvent(new Event('blur'));
      await settle();
      expect(isOpen()).toBe(false);

      toggle().click();
      await settle();
      type('cat');
      field().dispatchEvent(new Event('blur'));
      await settle();
      expect(isOpen()).toBe(true);
    });

    it('closed from the circle, drops the search and brings back what is trending', async () => {
      await create(true);
      toggle().click();
      await settle();
      type('cat');
      await settle(400);
      find.mockClear();

      toggle().click();
      await settle();
      expect(isOpen()).toBe(false);
      expect(field().value).toBe('');
      expect(document.activeElement).toBe(toggle());
      expect(find).toHaveBeenCalledWith('', expect.any(AbortSignal));
    });
  });
});
