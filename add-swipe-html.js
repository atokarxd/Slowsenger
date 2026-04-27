const fs = require('fs');

const path = 'Slowsenger/src/app/pages/dashboard/user-list/user-list.html';
let code = fs.readFileSync(path, 'utf8');

if (!code.includes('swipe-container')) {
  // Replace the old delete-btn with swipe buttons
  code = code.replace(/<button class="delete-btn" aria-label="Törlés" \(click\)="requestDelete\(\$event, user\.id\)">[\s\S]*?<\/button>/m, '');
  
  // Wrap list-item content
  code = code.replace(/<div class="list-item" \(click\)="selectChat\(user\)">([\s\S]*?)<\/div>\s*}/g, 
  `<div class="swipe-container list-item-wrapper" (mouseleave)="closeSwipe()">
      <div class="list-item" 
           (click)="selectChat(user)"
           [style.transform]="activeSwipedId === user.id ? 'translateX(-120px)' : (swipingId === user.id ? 'translateX(' + currentSwipeX + 'px)' : 'translateX(0)')"
           (touchstart)="onTouchStart($event, user.id)"
           (touchmove)="onTouchMove($event)"
           (touchend)="onTouchEnd(user.id)"
           (mousedown)="onTouchStart($event, user.id)"
           (mousemove)="swipingId === user.id ? onTouchMove($event) : null"
           (mouseup)="swipingId === user.id ? onTouchEnd(user.id) : null"
           (mouseleave)="swipingId === user.id ? onTouchEnd(user.id) : null">
        $1
      </div>
      <div class="swipe-actions" [class.show]="activeSwipedId === user.id || (swipingId === user.id && currentSwipeX < -20)">
        <button class="pin-btn" aria-label="Kitűzés" (click)="togglePin($event, user)">
           <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="transform: rotate(45deg)"><line x1="12" y1="17" x2="12" y2="22"></line><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.68V6a3 3 0 0 0-3-3 3 3 0 0 0-3 3v4.68a2 2 0 0 1-1.11 1.87l-1.78.9A2 2 0 0 0 5 15.24Z"></path></svg>
        </button>
        <button class="delete-btn" aria-label="Törlés" (click)="requestDelete($event, user.id)">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path></svg>
        </button>
      </div>
    </div>
    }`);
  fs.writeFileSync(path, code);
}
