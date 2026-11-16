import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { TodayPanel } from './today-panel';

describe('TodayPanel', () => {
  let component: TodayPanel;
  let fixture: ComponentFixture<TodayPanel>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [TodayPanel],
      providers: [provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(TodayPanel);
    component = fixture.componentInstance;
    await fixture.whenStable();
  });

  it('is closed and out of the tab order by default', () => {
    expect(fixture.nativeElement.classList.contains('is-open')).toBe(false);
    expect(fixture.nativeElement.querySelector('.drawer').hasAttribute('inert')).toBe(true);
  });

  it('opens with the input and asks to close on Escape', async () => {
    const closed = vi.fn();
    component.closed.subscribe(closed);
    fixture.componentRef.setInput('open', true);
    await fixture.whenStable();

    expect(fixture.nativeElement.classList.contains('is-open')).toBe(true);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(closed).toHaveBeenCalled();
  });
});
