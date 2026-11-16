import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  afterRenderEffect,
  inject,
  input,
  viewChild,
} from '@angular/core';
import { Commitment } from '../../../core/commitments/commitment';
import { CommitmentCard } from '../commitment-card/commitment-card';

/** One titled group of the list: "Due this day", "No deadline", ... */
export interface StackGroup {
  heading: string;
  commitments: Commitment[];
  /** A line under the heading, e.g. why these are not on the calendar. */
  note?: string | null;
  /** Shown when there are no commitments. */
  emptyText?: string | null;
  loading?: boolean;
}

const STEP = 8; // how much of each covered card stays in sight above the card in front of it
const DEPTH = 3; // edges in sight at most; further cards stop where the third one did
const BOTTOM_RESERVE = 92; // the taskbar floats over the bottom of the list
const NOT_SHOWN = Symbol('not shown yet');

/**
 * The selected day's commitments in titled groups that pile up while the list scrolls. A group's
 * heading, once it reaches the top, stays; each card then slides over the one before it and stops a
 * few pixels lower, so the edges of the covered cards stay in sight (a shorter card stops lower still,
 * with its bottom on the bottom of the stack). When the group's last card has joined the stack, the
 * whole group scrolls on up together, and the next heading takes its place at the top.
 *
 * A card that would not fit on the screen where it should stop scrolls on instead. Whatever goes up
 * past its heading is cut off at the heading's bottom edge, never shown behind it.
 *
 * Every heading and card sticks (position: sticky) inside a slot of its own. A sticky element stays
 * only while its containing block reaches below it, so each slot reaches exactly as far below its
 * element as it takes to let it go at the moment the group is complete: then they all move off
 * together. The slots overlap (negative bottom margin), so the list keeps its normal spacing.
 */
@Component({
  selector: 'app-commitment-stack',
  imports: [CommitmentCard],
  templateUrl: './commitment-stack.html',
  styleUrl: './commitment-stack.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommitmentStack {
  readonly groups = input.required<StackGroup[]>();
  /**
   * When this changes (another day is picked), the list goes back to where it starts, so the stacks
   * build up anew. Not on every change of the groups: a card changing must not move the list.
   */
  readonly resetKey = input<unknown>();

  private readonly host: HTMLElement = inject(ElementRef).nativeElement;
  private readonly spacer = viewChild.required<ElementRef<HTMLElement>>('spacer');
  private frame = 0;
  private needsLayout = true;

  constructor() {
    const destroyRef = inject(DestroyRef);
    const onScroll = () => this.schedule(false);
    const onResize = () => this.schedule(true);

    afterNextRender(() => {
      // Scroll events don't bubble; capturing on the document catches whichever element scrolls the list
      document.addEventListener('scroll', onScroll, { capture: true, passive: true });
      window.addEventListener('resize', onResize, { passive: true });
      if (typeof ResizeObserver !== 'undefined') {
        // Cards growing or shrinking, e.g. a form opening in one, change the list's height
        const observer = new ResizeObserver(onResize);
        observer.observe(this.host);
        destroyRef.onDestroy(() => observer.disconnect());
      }
    });

    // Other groups or cards: lay them out again once they are on the page
    afterRenderEffect(() => {
      this.groups();
      this.schedule(true);
    });

    let shownKey: unknown = NOT_SHOWN;
    afterRenderEffect(() => {
      const key = this.resetKey();
      if (shownKey !== NOT_SHOWN && key !== shownKey) this.rewind();
      shownKey = key;
    });

    destroyRef.onDestroy(() => {
      document.removeEventListener('scroll', onScroll, { capture: true });
      window.removeEventListener('resize', onResize);
      cancelAnimationFrame(this.frame);
    });
  }

  /**
   * Back to before the first heading stops: the top of the list on wider screens. On phones, where the
   * whole page scrolls, only if the list had already started piling up; the month above stays in view.
   */
  private rewind(): void {
    const firstHeading = this.headingSlots()[0];
    if (!firstHeading) return;
    const scroller = scrollParent(this.host);
    const paddingTop = parseFloat(getComputedStyle(scroller).paddingTop) || 0;
    const start = layoutTop(firstHeading) - (layoutTop(scroller) + scroller.clientTop + paddingTop);
    if (scroller.scrollTop > start) scroller.scrollTo({ top: Math.max(0, start), behavior: 'instant' });
    this.schedule(true);
  }

  /** At most once a frame: the stopping points only after a size change, the cut-offs on every scroll. */
  private schedule(relayout: boolean): void {
    this.needsLayout ||= relayout;
    this.frame ||= requestAnimationFrame(() => {
      this.frame = 0;
      if (this.needsLayout) {
        this.needsLayout = false;
        this.layout();
      }
      this.cut();
    });
  }

  /**
   * Where each card stops (its sticky top, measured from the top of the scrolling area), and how long
   * each slot holds its element: until the scroll position at which the group is complete.
   */
  private layout(): void {
    const scroller = scrollParent(this.host);
    const paddingTop = parseFloat(getComputedStyle(scroller).paddingTop) || 0;
    const contentTop = layoutTop(scroller) + scroller.clientTop + paddingTop;
    const bottomLimit = scroller.clientHeight - paddingTop - BOTTOM_RESERVE;
    // A slot is never sticky itself, so its top is its element's place in the list. As laid out, not
    // as seen: the load intro slides the list in, and that must not move the stopping points.
    const flowTop = (slot: HTMLElement) => layoutTop(slot) - contentTop;

    let lastRelease = 0;
    for (const [group, headingSlot] of this.headingSlots().entries()) {
      const heading = headingSlot.firstElementChild as HTMLElement;
      const headingHeight = heading.offsetHeight;
      // The scroll position at which the group is complete, from where it all moves on together
      let release = flowTop(headingSlot);
      let stackBottom = headingHeight;
      let stopped = 0;
      const stops: { slot: HTMLElement; top: number; flowTop: number }[] = [];

      for (const slot of this.itemSlots(group)) {
        const item = slot.firstElementChild as HTMLElement;
        const height = item.offsetHeight;
        let top: number | null = null;
        if (item.classList.contains('card-item')) {
          const stepTop = headingHeight + Math.min(stopped, DEPTH - 1) * STEP;
          // A card shorter than the stack it covers stops lower, its bottom on the stack's bottom, so
          // the bigger card behind it doesn't stick out below it
          const cardTop = Math.max(stepTop, stackBottom - height);
          if (cardTop + height <= bottomLimit) top = cardTop;
          item.classList.toggle('stops', top !== null);
          item.style.top = top !== null ? `${top}px` : '';
        }

        if (top !== null) {
          stackBottom = Math.max(stackBottom, top + height);
          stopped++;
          release = Math.max(release, flowTop(slot) - top); // when it arrives where it stops
          stops.push({ slot, top, flowTop: flowTop(slot) });
        } else {
          release = Math.max(release, flowTop(slot) + height - headingHeight); // when it has gone under the heading
          this.holdUntil(slot, 0);
        }
      }

      this.holdUntil(headingSlot, release - flowTop(headingSlot));
      for (const stop of stops) this.holdUntil(stop.slot, release + stop.top - stop.flowTop);
      lastRelease = Math.max(lastRelease, release);
    }

    this.sizeSpacer(scroller, lastRelease);
  }

  /** Makes a slot reach `extra` px below its element, so the element sticks that much longer (--reach, see the scss). */
  private holdUntil(slot: HTMLElement, extra: number): void {
    slot.style.setProperty('--reach', `${Math.max(0, extra)}px`);
  }

  /** Room at the end, so the last group can be scrolled up until it is complete: a bit of scrolling past the end. */
  private sizeSpacer(scroller: HTMLElement, lastRelease: number): void {
    const spacer = this.spacer().nativeElement;
    for (let tries = 0; tries < 3; tries++) {
      const missing = lastRelease - (scroller.scrollHeight - scroller.clientHeight);
      const height = Math.max(0, spacer.offsetHeight + missing);
      if (Math.abs(height - spacer.offsetHeight) < 0.5) return;
      spacer.style.height = `${height}px`;
    }
  }

  /** Everything that has gone up past its heading is cut off at the heading's bottom edge. */
  private cut(): void {
    const headingBottoms = this.headingSlots().map((slot) => slot.firstElementChild!.getBoundingClientRect().bottom);
    for (const item of this.host.querySelectorAll<HTMLElement>(':scope > .slot > .item')) {
      const cut = headingBottoms[Number(item.dataset['group'])] - item.getBoundingClientRect().top;
      item.style.setProperty('--cut', `${Math.max(0, cut)}px`);
    }
  }

  private headingSlots(): HTMLElement[] {
    return [...this.host.querySelectorAll<HTMLElement>(':scope > .heading-slot')];
  }

  private itemSlots(group: number): HTMLElement[] {
    return [...this.host.querySelectorAll<HTMLElement>(`:scope > .slot:not(.heading-slot)[data-group="${group}"]`)];
  }
}

/**
 * An element's top as laid out, without scrolling or transforms. Only differences between two of
 * these mean anything: positioned (or sticky) ancestors they share cancel out.
 */
function layoutTop(element: HTMLElement): number {
  let top = 0;
  for (let box: HTMLElement | null = element; box; box = box.offsetParent as HTMLElement | null) top += box.offsetTop;
  return top;
}

/** The nearest ancestor that scrolls: the day list on wider screens, the whole page on phones. */
function scrollParent(element: HTMLElement): HTMLElement {
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const { overflowY } = getComputedStyle(parent);
    if (overflowY === 'auto' || overflowY === 'scroll') return parent;
  }
  return document.scrollingElement as HTMLElement;
}
