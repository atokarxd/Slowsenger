import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';

import { SlowsengerDataService } from '../../../../core/supabase/slowsenger-data.service';
import { AI_CONSENT_MISSING, ChatSummaryResult } from '../../../../core/supabase/supabase.types';
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

describe('ChatSummary content', () => {
  const anna = { id: 'u2', name: 'Anna', username: 'anna', avatarUrl: '' };
  const lili = { id: 'u3', name: 'Lili', username: 'lili', avatarUrl: '' };
  const result: ChatSummaryResult = {
    summary: ['Anna kéri a diákat péntekig.', 'Holnap 10-kor találkoztok.', 'Lili küldött egy jegyzetet.'],
    commitments: [{ who: 'you', what: 'Diák elkészítése', when: 'péntekig' }, { who: null, what: 'Terem foglalása', when: null }],
    decisions: ['Holnap 10-kor a könyvtárban'],
    count: 34,
  };
  let fixture: ComponentFixture<ChatSummary>;
  let host: HTMLElement;
  let answers: Subject<ChatSummaryResult>[];
  const summarizeChat = vi.fn(() => {
    answers.push(new Subject<ChatSummaryResult>());
    return answers.at(-1)!;
  });
  const body = () => host.querySelector<HTMLElement>('.panel-body')!;
  const texts = (selector: string) => [...host.querySelectorAll(selector)].map((e) => e.textContent?.trim());
  const open = async () => {
    host.querySelector<HTMLButtonElement>('.summary-btn')!.click();
    await fixture.whenStable();
  };
  const answer = async (value: ChatSummaryResult | Error) => {
    if (value instanceof Error) answers.at(-1)!.error(value);
    else answers.at(-1)!.next(value);
    await fixture.whenStable();
  };

  beforeEach(async () => {
    answers = [];
    summarizeChat.mockClear();
    await TestBed.configureTestingModule({
      imports: [ChatSummary],
      providers: [{ provide: SlowsengerDataService, useValue: { summarizeChat } }],
    }).compileComponents();
    fixture = TestBed.createComponent(ChatSummary);
    fixture.componentRef.setInput('unread', 34);
    fixture.componentRef.setInput('conversation', anna);
    fixture.componentRef.setInput('since', '2026-11-25T08:00:00.000Z');
    host = fixture.nativeElement;
    await fixture.whenStable();
  });

  it('asks for nothing before it is opened', () => {
    expect(summarizeChat).not.toHaveBeenCalled();
  });

  it('asks for the summary of the chat since it was last read, and shows it on its way', async () => {
    await open();
    expect(summarizeChat).toHaveBeenCalledWith(anna, '2026-11-25T08:00:00.000Z');
    expect(body().getAttribute('aria-busy')).toBe('true');
    expect(host.querySelector('.lead')?.textContent).toContain('Reading the 34 unread messages');
    expect(host.querySelector('.skeleton')).not.toBeNull();
  });

  it('shows the points, the commitments and the decisions', async () => {
    await open();
    await answer(result);
    expect(body().getAttribute('aria-busy')).toBe('false');
    expect(host.querySelector('.skeleton')).toBeNull();
    expect(texts('.points li')).toEqual(result.summary);
    expect(texts('.commitments .who')).toEqual(['you', 'Someone?']);
    expect(texts('.commitments .what')).toEqual(['Diák elkészítése', 'Terem foglalása']);
    expect(texts('.commitments .when')).toEqual(['péntekig']); // none said for the second
    expect(texts('.decisions li')).toEqual(['Holnap 10-kor a könyvtárban']);
    expect(host.querySelector('.credit')?.textContent).toContain('Summed up by Claude');
  });

  it('leaves out the parts there is nothing for', async () => {
    await open();
    await answer({ ...result, commitments: [], decisions: [] });
    expect(texts('h3')).toEqual([]);
    expect(host.querySelector('.commitments')).toBeNull();
  });

  it('keeps it: opened again, it asks nothing more', async () => {
    await open();
    await answer(result);
    fixture.componentInstance.close();
    await fixture.whenStable();
    await open();
    expect(summarizeChat).toHaveBeenCalledTimes(1);
    expect(texts('.points li')).toEqual(result.summary);
  });

  it('asks again for another chat', async () => {
    await open();
    await answer(result);
    fixture.componentInstance.close();
    fixture.componentRef.setInput('conversation', lili);
    await fixture.whenStable();
    expect(host.querySelector('.points')).toBeNull();
    await open();
    expect(summarizeChat).toHaveBeenLastCalledWith(lili, '2026-11-25T08:00:00.000Z');
  });

  it('says when not everyone has turned on AI suggestions', async () => {
    await open();
    await answer(new Error(AI_CONSENT_MISSING));
    expect(host.querySelector('.notice')?.textContent).toContain('everyone in it has turned on AI suggestions');
    expect(host.querySelector('.retry')).toBeNull();
  });

  it('says what went wrong, and tries again', async () => {
    await open();
    await answer(new Error('The AI is busy; try again in a minute.'));
    expect(host.querySelector('.notice p')?.textContent).toBe('The AI is busy; try again in a minute.');
    host.querySelector<HTMLButtonElement>('.retry')!.click();
    await fixture.whenStable();
    expect(summarizeChat).toHaveBeenCalledTimes(2);
    await answer(result);
    expect(texts('.points li')).toEqual(result.summary);
  });

  it('says when there was nothing new from the others, and when it is the offline stand-in', async () => {
    await open();
    await answer({ summary: [], commitments: [], decisions: [], count: 0, standIn: true });
    expect(host.querySelector('.lead')?.textContent).toContain('Nothing new from the others');
    expect(host.querySelector('.credit')?.textContent).toContain('Offline stand-in');
  });
});

