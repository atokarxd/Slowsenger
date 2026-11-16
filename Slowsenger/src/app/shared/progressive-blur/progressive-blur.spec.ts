import { TestBed } from '@angular/core/testing';

import { ProgressiveBlur } from './progressive-blur';

describe('ProgressiveBlur', () => {
  it('has a layer per blur step and passes its inputs on as custom properties', async () => {
    const fixture = TestBed.createComponent(ProgressiveBlur);
    fixture.componentRef.setInput('edge', 'bottom');
    fixture.componentRef.setInput('radius', '0 0 16px 16px');
    fixture.componentRef.setInput('color', '#123456');
    fixture.componentRef.setInput('tint', 0.5);
    await fixture.whenStable();

    const host: HTMLElement = fixture.nativeElement;
    expect(host.querySelectorAll('span').length).toBe(6);
    expect(host.getAttribute('data-edge')).toBe('bottom');
    expect(host.getAttribute('aria-hidden')).toBe('true');
    expect(host.style.getPropertyValue('--progressive-blur-radius')).toBe('0 0 16px 16px');
    expect(host.style.getPropertyValue('--progressive-blur-color')).toBe('#123456');
    expect(host.style.getPropertyValue('--progressive-blur-tint')).toBe('50%');
  });

  it('leaves the colour to the stylesheet default when none is given', async () => {
    const fixture = TestBed.createComponent(ProgressiveBlur);
    fixture.componentRef.setInput('edge', 'top');
    await fixture.whenStable();

    expect((fixture.nativeElement as HTMLElement).style.getPropertyValue('--progressive-blur-color')).toBe('');
  });
});
