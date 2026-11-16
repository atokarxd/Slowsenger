import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { CommitmentSection } from './commitment-section';

@Component({
  imports: [CommitmentSection],
  template: `
    <app-commitment-section heading="Due this day" [count]="items().length" [loading]="loading()"
      note="A note" emptyText="Nothing is due.">
      @for (item of items(); track item) {
        <p class="item">{{ item }}</p>
      }
    </app-commitment-section>
  `,
})
class Host {
  readonly items = signal<string[]>([]);
  readonly loading = signal(false);
}

describe('CommitmentSection', () => {
  let fixture: ComponentFixture<Host>;
  let element: HTMLElement;

  beforeEach(async () => {
    fixture = TestBed.createComponent(Host);
    element = fixture.nativeElement;
    await fixture.whenStable();
  });

  it('shows the heading, the count and the projected items', async () => {
    fixture.componentInstance.items.set(['a', 'b']);
    await fixture.whenStable();
    expect(element.querySelector('h3')?.textContent).toContain('Due this day');
    expect(element.querySelector('.count')?.textContent).toBe('2');
    expect(element.querySelector('.note')?.textContent).toBe('A note');
    expect(element.querySelectorAll('.item').length).toBe(2);
    expect(element.querySelector('.empty')).toBeNull();
  });

  it('shows the empty text when there is nothing', () => {
    expect(element.querySelector('.empty')?.textContent).toBe('Nothing is due.');
  });

  it('shows placeholders and no count while loading', async () => {
    fixture.componentInstance.loading.set(true);
    await fixture.whenStable();
    expect(element.querySelectorAll('.skeleton-card').length).toBe(2);
    expect(element.querySelector('.count')).toBeNull();
    expect(element.querySelector('.empty')).toBeNull();
  });
});
