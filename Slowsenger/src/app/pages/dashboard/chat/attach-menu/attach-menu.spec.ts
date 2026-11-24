import { ComponentFixture, TestBed } from '@angular/core/testing';

import { AttachAction, AttachMenu } from './attach-menu';

describe('AttachMenu', () => {
  let fixture: ComponentFixture<AttachMenu>;
  let host: HTMLElement;
  const toggle = () => host.querySelector('.toggle') as HTMLButtonElement;
  const actions = () => host.querySelector('.actions') as HTMLElement;
  const isOpen = () => host.classList.contains('is-open');

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [AttachMenu] }).compileComponents();
    fixture = TestBed.createComponent(AttachMenu);
    host = fixture.nativeElement;
    document.body.appendChild(host); // for the clicks outside it and the focus
    await fixture.whenStable();
  });

  afterEach(() => host.remove());

  it('starts closed, with the actions out of reach', () => {
    expect(isOpen()).toBe(false);
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(actions().hasAttribute('inert')).toBe(true);
  });

  it('opens and closes with the "+"', async () => {
    toggle().click();
    await fixture.whenStable();
    expect(isOpen()).toBe(true);
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(actions().hasAttribute('inert')).toBe(false);

    toggle().click();
    await fixture.whenStable();
    expect(isOpen()).toBe(false);
  });

  it('tells which action was picked, and closes', async () => {
    const picked: AttachAction[] = [];
    fixture.componentInstance.picked.subscribe((action) => picked.push(action));
    toggle().click();
    await fixture.whenStable();

    const labels = [...host.querySelectorAll<HTMLButtonElement>('.action')].map((b) => b.getAttribute('aria-label'));
    expect(labels).toEqual(['Attach a file', 'Commitment invite', 'GIFs', 'Send later']);

    host.querySelectorAll<HTMLButtonElement>('.action')[2].click();
    await fixture.whenStable();
    expect(picked).toEqual(['gif']);
    expect(isOpen()).toBe(false);
  });

  it('closes on a press outside it, but not on one inside', async () => {
    toggle().click();
    await fixture.whenStable();

    actions().dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    await fixture.whenStable();
    expect(isOpen()).toBe(true);

    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    await fixture.whenStable();
    expect(isOpen()).toBe(false);
  });

  it('offers no invite in a group', async () => {
    const invite = () => host.querySelector<HTMLButtonElement>('.action[aria-label="Commitment invite"]')!;
    expect(invite().disabled).toBe(false);
    fixture.componentRef.setInput('inviteDisabled', true);
    await fixture.whenStable();
    expect(invite().disabled).toBe(true);
    expect(invite().title).toContain('one-to-one');
  });

  it('closes on Escape and gives the focus back to the "+"', async () => {
    toggle().click();
    await fixture.whenStable();
    (host.querySelector('.action') as HTMLButtonElement).focus();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await fixture.whenStable();
    expect(isOpen()).toBe(false);
    expect(document.activeElement).toBe(toggle());
  });
});
