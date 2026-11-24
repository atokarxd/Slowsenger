import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { Commitment } from '../../../../core/commitments/commitment';
import { CommitmentService } from '../../../../core/commitments/commitment.service';
import { makeCommitment, makeUser } from '../../../../core/commitments/commitment.testing';
import { ChatCommitmentCard, relativeDay } from './chat-commitment-card';

describe('ChatCommitmentCard', () => {
  const demo = makeUser('demo', 'Demo');
  const anna = makeUser('anna', 'Anna');
  const store = signal<Commitment[]>([]);
  const me = signal(demo);
  const apply = vi.fn(() => null as string | null);
  let fixture: ComponentFixture<ChatCommitmentCard>;
  let host: HTMLElement;

  const invite = (overrides: Partial<Commitment> = {}) => makeCommitment({
    id: 'c1', title: 'Meeting about the draft', status: 'proposed', owner: anna, createdBy: 'demo', requestedBy: 'demo',
    due: new Date(2026, 10, 20, 14, 0).toISOString(), hasTime: true, ...overrides,
  });
  const buttons = () => [...host.querySelectorAll('button')].map((b) => b.textContent!.trim());
  const show = async (commitment: Commitment | null, viewer = demo) => {
    me.set(viewer);
    store.set(commitment ? [{ ...commitment, ownedByMe: commitment.owner?.id === viewer.id }] : []);
    await fixture.whenStable();
  };

  // A fixed today (Wednesday 18 November), so the invite for Friday stays ahead and is not overdue
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 10, 18, 12, 0));
  });
  afterEach(() => vi.useRealTimers());

  beforeEach(async () => {
    apply.mockClear();
    await TestBed.configureTestingModule({
      imports: [ChatCommitmentCard],
      providers: [{
        provide: CommitmentService,
        useValue: { commitments: store, me, myId: () => me().id, apply },
      }],
    }).compileComponents();
    fixture = TestBed.createComponent(ChatCommitmentCard);
    fixture.componentRef.setInput('commitmentId', 'c1');
    host = fixture.nativeElement;
  });

  it('waits for the commitment to load', async () => {
    await show(null);
    expect(host.textContent).toContain('Loading the commitment');
  });

  it('shows the sender who it is waiting for, without buttons', async () => {
    await show(invite());
    expect(host.getAttribute('data-status')).toBe('proposed');
    expect(host.textContent).toContain('Meeting about the draft');
    expect(host.textContent).toContain('Fri 20 Nov, 14:00');
    expect(host.textContent).toContain('Anna does it');
    expect(host.textContent).toContain('Waiting for Anna to accept it.');
    expect(buttons()).toEqual([]);
  });

  it('lets the owner accept or reject it', async () => {
    await show(invite(), anna);
    expect(host.textContent).toContain('You do it');
    expect(buttons()).toEqual(['Reject', 'Accept']);

    (host.querySelectorAll('button')[1] as HTMLButtonElement).click();
    expect(apply).toHaveBeenCalledWith('c1', { type: 'accept' });
  });

  it('offers to take it on when nobody is named', async () => {
    await show(invite({ owner: null }), anna);
    expect(buttons()).toEqual(['Take it on']);
    (host.querySelector('button') as HTMLButtonElement).click();
    expect(apply).toHaveBeenCalledWith('c1', { type: 'claim', owner: anna });
  });

  it('shows why an action was refused', async () => {
    apply.mockReturnValueOnce('Could not reach the server.');
    await show(invite(), anna);
    (host.querySelectorAll('button')[1] as HTMLButtonElement).click();
    await fixture.whenStable();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Could not reach the server.');
  });

  it('only shows the outcome once it is decided', async () => {
    await show(invite({ status: 'accepted' }), anna);
    expect(host.getAttribute('data-status')).toBe('accepted');
    expect(buttons()).toEqual([]);
    expect(host.textContent).not.toContain('Waiting');
    expect(host.querySelector('app-status-pill')?.textContent).toContain('Accepted');
  });

  it('shows the day on a calendar leaf, and says when there is none', async () => {
    await show(invite());
    const leaf = () => [...host.querySelectorAll('.leaf .band, .leaf .day, .leaf .weekday, .leaf .time')].map((e) => e.textContent!.trim());
    expect(leaf()).toEqual(['Nov', '20', 'Fri', '14:00']);
    expect(host.querySelector('.kind')?.textContent).toContain('In 2 days');

    await show(invite({ hasTime: false }));
    expect(leaf()).toEqual(['Nov', '20', 'Fri']);

    await show(invite({ due: null, hasTime: false }));
    expect(leaf()).toEqual(['Any', '–', 'No date']);
    expect(host.textContent).toContain('No date set');
  });

  it('puts the main action last, even when the sender may also reject it', async () => {
    await show(invite({ owner: null }));
    expect(buttons()).toEqual(['Reject', 'Take it on']);
  });

  it('cuts the tear line only while there is something under it', async () => {
    await show(invite());
    expect(host.classList).toContain('has-bar');
    await show(invite({ status: 'accepted' }), anna);
    expect(host.classList).not.toContain('has-bar');
  });

  it('folds a decided ticket into a small row that opens and closes again', async () => {
    await show(invite());
    const main = () => host.querySelector<HTMLElement>('.main')!;
    expect(host.classList).not.toContain('is-compact');
    expect(main().getAttribute('role')).toBeNull();
    main().click();
    await fixture.whenStable();
    expect(host.classList).not.toContain('is-compact');

    await show(invite({ status: 'rejected' }));
    expect(host.classList).toContain('is-compact');
    expect(main().getAttribute('role')).toBe('button');
    expect(main().getAttribute('aria-expanded')).toBe('false');

    main().click();
    await fixture.whenStable();
    expect(host.classList).not.toContain('is-compact');
    expect(main().getAttribute('aria-expanded')).toBe('true');

    main().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await fixture.whenStable();
    expect(host.classList).toContain('is-compact');
  });

  it('animates the outcome only for a decision made while it was open', async () => {
    await show(invite({ status: 'accepted' }), anna);
    expect(host.classList).not.toContain('is-live');
    expect(host.querySelector('.stamp')).not.toBeNull();

    await show(invite(), anna);
    await show(invite({ status: 'accepted' }), anna);
    expect(host.classList).toContain('is-live');
  });
});

describe('relativeDay', () => {
  const now = new Date(2026, 10, 23, 18, 0);

  it('names the days around today and counts the rest of the week', () => {
    expect(relativeDay(new Date(2026, 10, 23, 9, 0), now)).toBe('Today');
    expect(relativeDay(new Date(2026, 10, 24, 0, 30), now)).toBe('Tomorrow');
    expect(relativeDay(new Date(2026, 10, 22, 23, 0), now)).toBe('Yesterday');
    expect(relativeDay(new Date(2026, 10, 27), now)).toBe('In 4 days');
    expect(relativeDay(new Date(2026, 10, 20), now)).toBe('3 days ago');
  });

  it('leaves it to the date beyond a week', () => {
    expect(relativeDay(new Date(2026, 10, 30), now)).toBe('');
    expect(relativeDay(new Date(2026, 10, 16), now)).toBe('');
  });
});
