import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { EMPTY, of } from 'rxjs';

import { Chat, sendsAt } from './chat';
import { nextMorning, scheduleLabel } from './send-later/send-later';
import { SlowsengerDataService } from '../../../core/supabase/slowsenger-data.service';

describe('sendsAt', () => {
  const now = new Date(2026, 10, 17, 14, 0);
  it('says today and tomorrow by name, other days by date', () => {
    expect(sendsAt(new Date(2026, 10, 17, 20, 0).toISOString(), now)).toBe('today, 20:00');
    expect(sendsAt(new Date(2026, 10, 18, 9, 0).toISOString(), now)).toBe('tomorrow, 09:00');
    expect(sendsAt(new Date(2026, 10, 21, 9, 5).toISOString(), now)).toBe('Sat 21 Nov, 09:05');
  });
});

describe('Chat', () => {
  let component: Chat;
  let fixture: ComponentFixture<Chat>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Chat],
      providers: [provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(Chat);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('shows the today button only inside a conversation', async () => {
    const todayButton = () => fixture.nativeElement.querySelector('app-today-button');
    expect(todayButton()).toBeNull();

    fixture.componentRef.setInput('selectedUser', { id: 'u2', name: 'Anna', username: 'anna', avatarUrl: '' });
    await fixture.whenStable();
    expect(todayButton()).not.toBeNull();

    fixture.componentRef.setInput('selectedUser', null);
    await fixture.whenStable();
    expect(todayButton()).toBeNull();
  });

  it('closes the today panel when another user is picked, but not for the same user again', async () => {
    const anna = { id: 'u2', name: 'Anna', username: 'anna', avatarUrl: '' };
    const todayButton = () => fixture.nativeElement.querySelector('app-today-button') as HTMLElement;
    fixture.componentRef.setInput('selectedUser', anna);
    await fixture.whenStable();

    todayButton().querySelector('button')!.click();
    await fixture.whenStable();
    expect(component.isTodayOpen()).toBe(true);
    expect(todayButton().classList).toContain('is-expanded'); // faded out while the panel is open

    fixture.componentRef.setInput('selectedUser', { ...anna });
    await fixture.whenStable();
    expect(component.isTodayOpen()).toBe(true);

    fixture.componentRef.setInput('selectedUser', { id: 'u3', name: 'Péter', username: 'peter', avatarUrl: '' });
    await fixture.whenStable();
    expect(component.isTodayOpen()).toBe(false);
    expect(todayButton().classList).not.toContain('is-expanded');
  });

  it('offers the AI summary for a chat opened with many unread messages, and for that chat only', async () => {
    const data = TestBed.inject(SlowsengerDataService);
    const thread = { id: 't1', owner_user_id: 'me', external_thread_id: 'user:u2', title: 'Anna', last_message_at: null, created_at: '' };
    const row = (minute: number) => ({
      id: `m${minute}`, thread_id: 't1', sender_user_id: 'u2', content: `${minute}`, direction: 'inbound',
      created_at: new Date(2026, 10, 23, 10, minute).toISOString(),
    });
    const rows = Array.from({ length: 32 }, (_, i) => row(i + 1)); // 10:01 … 10:32
    vi.spyOn(data, 'getOrCreateDirectThread').mockReturnValue(of(thread) as never);
    vi.spyOn(data, 'getMessages').mockReturnValue(of(rows) as never);
    vi.spyOn(data, 'getScheduledMessages').mockReturnValue(of([]));
    vi.spyOn(component as unknown as { subscribeToThread: () => void }, 'subscribeToThread').mockImplementation(() => undefined);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const summary = () => fixture.nativeElement.querySelector('app-chat-summary');

    // Last read at 10:02: thirty came in since, the rule's number
    fixture.componentRef.setInput('unreadSince', new Date(2026, 10, 23, 10, 2).toISOString());
    fixture.componentRef.setInput('selectedUser', { id: 'u2', name: 'Anna', username: 'anna', avatarUrl: '' });
    await fixture.whenStable();
    expect(component.unreadAtOpen()).toBe(30);
    expect(summary()).not.toBeNull();
    component.summaryOpen.set(true);

    // Another chat, read at 10:03: twenty-nine, no summary (and the open one is closed)
    fixture.componentRef.setInput('unreadSince', new Date(2026, 10, 23, 10, 3).toISOString());
    fixture.componentRef.setInput('selectedUser', { id: 'u3', name: 'Péter', username: 'peter', avatarUrl: '' });
    await fixture.whenStable();
    expect(component.unreadAtOpen()).toBe(29);
    expect(summary()).toBeNull();
    expect(component.summaryOpen()).toBe(false);

    // Back with thirty: its offer runs out unused and it goes, until the chat is opened again
    fixture.componentRef.setInput('unreadSince', new Date(2026, 10, 23, 10, 2).toISOString());
    fixture.componentRef.setInput('selectedUser', { id: 'u2', name: 'Anna', username: 'anna', avatarUrl: '' });
    await fixture.whenStable();
    summary()!.querySelector('.offer-timer')!.dispatchEvent(new Event('animationend'));
    await fixture.whenStable();
    expect(summary()).toBeNull();
    fixture.componentRef.setInput('selectedUser', { id: 'u3', name: 'Péter', username: 'peter', avatarUrl: '' });
    await fixture.whenStable();
    fixture.componentRef.setInput('selectedUser', { id: 'u2', name: 'Anna', username: 'anna', avatarUrl: '' });
    await fixture.whenStable();
    expect(summary()).not.toBeNull();
  });

  it('runs messages by who wrote them, so a group shows each person’s name once per run', () => {
    const message = (id: string, type: 'incoming' | 'outgoing', senderId: string) => ({
      id, text: id, time: '', type, createdAt: '', replyTo: null, commitmentId: null, attachment: null,
      senderId, senderName: senderId, senderColor: '',
    });
    component.messages.set([
      message('1', 'incoming', 'eszter'), message('2', 'incoming', 'eszter'), message('3', 'incoming', 'anna'),
      message('4', 'outgoing', 'me'),
    ]);
    expect([0, 1, 2, 3].map((i) => component.isFirstInRun(i))).toEqual([true, false, true, true]);
    expect([0, 1, 2, 3].map((i) => component.isLastInGroup(i))).toEqual([false, true, true, true]);
  });

  describe('message input', () => {
    const anna = { id: 'u2', name: 'Anna', username: 'anna', avatarUrl: '' };
    let field: HTMLInputElement;
    const pill = () => fixture.nativeElement.querySelector('.chat-input-area') as HTMLElement;
    const type = async (value: string, caret = value.length) => {
      field.value = value;
      field.setSelectionRange(caret, caret);
      field.dispatchEvent(new Event('input'));
      await fixture.whenStable();
    };

    beforeEach(async () => {
      // Nothing to load, so the input shows at once instead of the skeleton
      vi.spyOn(TestBed.inject(SlowsengerDataService), 'getOrCreateDirectThread').mockReturnValue(EMPTY);
      // jsdom has no canvas to measure text with; the input's growing is checked in a real browser
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
      fixture.componentRef.setInput('selectedUser', anna);
      await fixture.whenStable();
      field = fixture.nativeElement.querySelector('.message-input');
    });

    it('shows the send button only once there is text', async () => {
      expect(pill().classList).not.toContain('has-text');
      await type('S');
      expect(pill().classList).toContain('has-text');
      await type('');
      expect(pill().classList).not.toContain('has-text');
    });

    it('drops blanks typed into the empty field, whatever kind of space they are', async () => {
      await type(' \t\u00A0\u3000\u200B\u3164\u2800');
      expect(field.value).toBe('');
      expect(pill().classList).not.toContain('has-text');
    });

    it('drops blanks put before the text, keeping the caret, but leaves the ones inside alone', async () => {
      await type('  Szia', 2); // two spaces typed in front of "Szia"
      expect(field.value).toBe('Szia');
      expect(field.selectionStart).toBe(0);

      await type('Szia  te');
      expect(field.value).toBe('Szia  te');
    });

    it('sends the text without blanks at either end, then empties the field', async () => {
      const send = vi.spyOn(TestBed.inject(SlowsengerDataService), 'sendDirectMessage').mockReturnValue(of(undefined));
      await type('Szia!\u00A0 \u200B');
      field.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter' }));
      await fixture.whenStable();

      expect(send).toHaveBeenCalledWith(anna, 'Szia!', null);
      expect(field.value).toBe('');
      expect(pill().classList).not.toContain('has-text');
    });
  });
  describe('swipes and replies', () => {
    const anna = { id: 'u2', name: 'Anna Kovács', username: 'anna', avatarUrl: '' };
    const message = (id: string, type: 'incoming' | 'outgoing', text: string) => ({
      id, text, time: '12:00', type, createdAt: `2026-11-18T10:0${id}:00.000Z`, replyTo: null, commitmentId: null,
      attachment: null, senderId: type === 'incoming' ? 'u2' : 'me', senderName: 'Anna', senderColor: '',
    });
    const section = () => fixture.nativeElement.querySelector('.chat-messages') as HTMLElement;
    const bubble = (id: string) => fixture.nativeElement.querySelector(`[data-message-id="${id}"] p`) as HTMLElement;
    const at = (target: Element, x: number, y = 0) =>
      ({ button: 0, pointerId: 1, clientX: x, clientY: y, target, currentTarget: section() }) as unknown as PointerEvent;
    /** A press on target, moved by dx (and dy) in two steps, not let go yet. */
    const drag = async (target: Element, dx: number, dy = 0) => {
      component.onPointerDown(at(target, 200));
      component.onPointerMove(at(target, 200 + dx / 2, dy / 2));
      component.onPointerMove(at(target, 200 + dx, dy));
      await fixture.whenStable();
    };
    const release = async (target: Element, dx: number) => {
      component.onPointerUp(at(target, 200 + dx));
      await fixture.whenStable();
    };
    const replyBar = () => fixture.nativeElement.querySelector('.reply-bar') as HTMLElement | null;

    beforeEach(async () => {
      vi.spyOn(TestBed.inject(SlowsengerDataService), 'getOrCreateDirectThread').mockReturnValue(EMPTY);
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
      fixture.componentRef.setInput('selectedUser', anna);
      await fixture.whenStable();
      component.messages.set([message('1', 'incoming', 'Jössz holnap?'), message('2', 'outgoing', 'Igen, 10-re')]);
      await fixture.whenStable();
    });

    it('answers someone else’s message swiped left to right, and sends the reply with it', async () => {
      await drag(bubble('1'), 80);
      expect(component.swipeOffset(component.messages()[0])).toBeGreaterThanOrEqual(56);
      expect(fixture.nativeElement.querySelector('.reply-hint.is-armed')).not.toBeNull();
      await release(bubble('1'), 80);

      expect(replyBar()?.textContent).toContain('Replying to Anna');
      expect(replyBar()?.textContent).toContain('Jössz holnap?');
      expect(component.swipe()).toBeNull(); // the bubble slides back

      const send = vi.spyOn(TestBed.inject(SlowsengerDataService), 'sendDirectMessage').mockReturnValue(of(undefined));
      const field = fixture.nativeElement.querySelector('.message-input') as HTMLInputElement;
      field.value = 'Megyek!';
      field.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter' }));
      await fixture.whenStable();
      expect(send).toHaveBeenCalledWith(anna, 'Megyek!', {
        sender_user_id: 'u2', created_at: '2026-11-18T10:01:00.000Z', preview: 'Jössz holnap?',
      });
      expect(replyBar()).toBeNull();
    });

    it('answers your own message swiped right to left', async () => {
      await drag(bubble('2'), -80);
      await release(bubble('2'), -80);
      expect(replyBar()?.textContent).toContain('Replying to You');
    });

    it('does nothing with a bubble swiped the other way, too short, or mostly up and down', async () => {
      await drag(bubble('1'), -80);
      await release(bubble('1'), -80);
      await drag(bubble('2'), 80);
      await release(bubble('2'), 80);
      await drag(bubble('1'), 40);
      await release(bubble('1'), 40);
      await drag(bubble('1'), 30, 90);
      await release(bubble('1'), 30);
      expect(replyBar()).toBeNull();
    });

    it('beside the bubbles, right to left shows every message’s time until let go', async () => {
      await drag(section(), -80);
      expect(component.globalOffsetX).toBe(-60);
      expect(component.getRevealOpacity()).toBe(1);
      expect(component.swipe()).toBeNull();
      await release(section(), -80);
      expect(component.globalOffsetX).toBe(0);

      await drag(section(), 80); // left to right does nothing there
      expect(component.globalOffsetX).toBe(0);
    });

    it('keeps a touch swipe going when the bubble’s own hold on the finger ends, not when the list’s does', async () => {
      await drag(bubble('1'), 40);
      component.onLostPointerCapture({ target: bubble('1'), currentTarget: section() } as unknown as PointerEvent);
      expect(component.swipe()).not.toBeNull();
      component.onLostPointerCapture({ target: section(), currentTarget: section() } as unknown as PointerEvent);
      expect(component.swipe()).toBeNull();
    });

    it('lets the reply go with its × or Escape', async () => {
      component.startReply(component.messages()[0]);
      await fixture.whenStable();
      (fixture.nativeElement.querySelector('.reply-bar-cancel') as HTMLButtonElement).click();
      await fixture.whenStable();
      expect(component.replyingTo()).toBeNull();

      component.startReply(component.messages()[0]);
      await fixture.whenStable();
      fixture.nativeElement.querySelector('.message-input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      expect(component.replyingTo()).toBeNull();
    });

    it('shows a reply’s quote over its bubble, named as the chat calls its writer', async () => {
      const reply = { ...message('3', 'outgoing', 'Megyek!'), replyTo: { sender_user_id: 'u2', created_at: 'x', preview: 'Jössz holnap?' } };
      component.messages.update((list) => [...list, reply]);
      await fixture.whenStable();
      const quote = fixture.nativeElement.querySelector('[data-message-id="3"] .reply-quote') as HTMLElement;
      expect(quote.textContent).toContain('Anna');
      expect(quote.textContent).toContain('Jössz holnap?');
    });
  });
  describe('send later', () => {
    const anna = { id: 'u2', name: 'Anna Kovács', username: 'anna', avatarUrl: '' };
    let data: SlowsengerDataService;
    let field: HTMLInputElement;
    const chip = () => fixture.nativeElement.querySelector('app-schedule-chip') as HTMLElement | null;
    const send = async (text: string) => {
      field.value = text;
      field.dispatchEvent(new Event('input'));
      field.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter' }));
      await fixture.whenStable();
    };

    beforeEach(async () => {
      data = TestBed.inject(SlowsengerDataService);
      vi.spyOn(data, 'getOrCreateDirectThread').mockReturnValue(EMPTY);
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
      fixture.componentRef.setInput('selectedUser', anna);
      await fixture.whenStable();
      field = fixture.nativeElement.querySelector('.message-input');
      component.onAttach('send-later');
      await fixture.whenStable();
    });

    it('puts the next morning above the input, as "Weekday, 9:00 AM"', () => {
      expect(chip()?.textContent).toContain(scheduleLabel(nextMorning()));
      expect(chip()?.textContent).toContain('9:00 AM');
      expect(fixture.nativeElement.querySelector('.chat-input-area').classList).toContain('is-scheduling');
    });

    it('opens the card from the button, to change the day and time', async () => {
      (chip()!.querySelector('.chip') as HTMLButtonElement).click();
      await fixture.whenStable();
      expect(fixture.nativeElement.querySelectorAll('app-send-later .day')).toHaveLength(8);
    });

    it('schedules the message for then instead of sending it, and is done', async () => {
      const row = { id: 's1', sender_user_id: 'me', recipient_user_id: 'u2', content: 'Holnap!', send_at: nextMorning().toISOString(), created_at: '' };
      const schedule = vi.spyOn(data, 'scheduleMessage').mockReturnValue(of(row));
      const now = vi.spyOn(data, 'sendDirectMessage');
      await send('Holnap!');

      expect(schedule).toHaveBeenCalledWith(anna, 'Holnap!', nextMorning());
      expect(now).not.toHaveBeenCalled();
      expect(component.scheduled()).toEqual([row]);
      expect(field.value).toBe('');
      expect(component.scheduleAt()).toBeNull();
    });

    it('sends at once again after its ×', async () => {
      (chip()!.querySelector('.cancel') as HTMLButtonElement).click();
      await fixture.whenStable();
      expect(chip()).toBeNull();
      const now = vi.spyOn(data, 'sendDirectMessage').mockReturnValue(of(undefined));
      await send('Most!');
      expect(now).toHaveBeenCalledWith(anna, 'Most!', null);
    });

    it('does not schedule for a time already gone, and opens the card instead', async () => {
      component.scheduleAt.set(new Date(Date.now() - 60_000));
      const schedule = vi.spyOn(data, 'scheduleMessage');
      await send('Késő');
      expect(schedule).not.toHaveBeenCalled();
      expect(field.value).toBe('Késő');
      expect(component.schedulePickerOpen()).toBe(true);
    });
  });
});

