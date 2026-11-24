import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ChatSummary, unreadCount } from './chat-summary';

describe('unreadCount', () => {
  const message = (direction: 'inbound' | 'outbound', minute: number) =>
    ({ direction, created_at: new Date(2026, 10, 23, 10, minute).toISOString() });
  const items = [message('inbound', 0), message('outbound', 5), message('inbound', 10), message('inbound', 20)];

  it('counts the messages that came in after the chat was last read', () => {
    expect(unreadCount(items, new Date(2026, 10, 23, 10, 5).toISOString())).toBe(2);
    expect(unreadCount(items, new Date(2026, 10, 23, 10, 20).toISOString())).toBe(0); // read at the last one
  });

  it('counts every message that came in, in a chat never read, and none of one\'s own', () => {
    expect(unreadCount(items, null)).toBe(3);
  });
});

describe('ChatSummary', () => {
  let fixture: ComponentFixture<ChatSummary>;
  let host: HTMLElement;
  const button = () => host.querySelector<HTMLButtonElement>('.summary-btn')!;
  const panel = () => host.querySelector<HTMLElement>('.panel')!;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ChatSummary] }).compileComponents();
    fixture = TestBed.createComponent(ChatSummary);
    fixture.componentRef.setInput('unread', 9);
    host = fixture.nativeElement;
    await fixture.whenStable();
  });

  it('is a button that says what it sums up, its panel closed', () => {
    expect(button().getAttribute('aria-label')).toBe('Summarise the 9 unread messages');
    expect(button().getAttribute('aria-expanded')).toBe('false');
    expect(host.classList).not.toContain('is-open');
    expect(panel().hasAttribute('inert')).toBe(true);
  });

  it('grows into the panel with its title, and takes the focus there', async () => {
    button().click();
    await fixture.whenStable();
    expect(fixture.componentInstance.open()).toBe(true);
    expect(host.classList).toContain('is-open');
    expect(button().getAttribute('aria-expanded')).toBe('true');
    expect(panel().hasAttribute('inert')).toBe(false);
    expect(panel().querySelector('h2')?.textContent).toBe('Conversation summary');
    expect(panel().getAttribute('aria-labelledby')).toBe('summary-title');
    expect(document.activeElement).toBe(panel());
  });

  it('waits thirty seconds for a first click, without a ring, then says it has expired', async () => {
    const expired = vi.fn();
    fixture.componentInstance.expired.subscribe(expired);
    expect(host.getAttribute('data-phase')).toBe('waiting');
    expect(host.style.getPropertyValue('--offer-time')).toBe('30s');
    expect(host.querySelector('.countdown')).toBeNull();
    host.querySelector('.offer-timer')!.dispatchEvent(new Event('animationend'));
    expect(expired).toHaveBeenCalledTimes(1);
  });

  it('opened and closed again: a ring counts down ten seconds, then it says it has expired', async () => {
    const expired = vi.fn();
    fixture.componentInstance.expired.subscribe(expired);
    button().click();
    await fixture.whenStable();
    expect(host.querySelector('.offer-timer')).toBeNull(); // no time runs while it is open
    expect(host.querySelector('.countdown')).toBeNull();
    fixture.componentInstance.onOfferEnd(); // a late end of the timer, already gone
    expect(expired).not.toHaveBeenCalled();

    fixture.componentInstance.close();
    await fixture.whenStable();
    expect(host.getAttribute('data-phase')).toBe('countdown');
    expect(host.style.getPropertyValue('--offer-time')).toBe('10s');
    host.querySelector('.countdown-left')!.dispatchEvent(new Event('animationend'));
    expect(expired).toHaveBeenCalledTimes(1);
  });

  it('opened again during the ring: no ring until it is closed once more', async () => {
    button().click();
    await fixture.whenStable();
    fixture.componentInstance.close();
    await fixture.whenStable();
    button().click();
    await fixture.whenStable();
    expect(host.querySelector('.countdown')).toBeNull();
    fixture.componentInstance.close();
    await fixture.whenStable();
    expect(host.querySelector('.countdown')).not.toBeNull();
  });

  it('closes with Escape or a click beside it, the focus back on the button', async () => {
    document.body.append(host); // focus needs it in the page
    button().click();
    await fixture.whenStable();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await fixture.whenStable();
    expect(host.classList).not.toContain('is-open');
    expect(document.activeElement).toBe(button());

    button().click();
    await fixture.whenStable();
    host.querySelector<HTMLElement>('.scrim')!.click();
    await fixture.whenStable();
    expect(fixture.componentInstance.open()).toBe(false);
    host.remove();
  });
});
