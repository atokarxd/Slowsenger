const fs = require('fs');

const path = 'Slowsenger/src/app/pages/dashboard/user-list/user-list.scss';
let code = fs.readFileSync(path, 'utf8');

if (!code.includes('.swipe-container')) {
  // We need to inject styles for list-item wrapper
  code = code.replace(/\.list-item \{/g, 
  `.swipe-container {
      position: relative;
      overflow: hidden;
      width: 100%;
      border-radius: 12px;
      margin-bottom: 8px;

      .swipe-actions {
        position: absolute;
        right: 0;
        top: 0;
        height: 100%;
        display: flex;
        align-items: center;
        opacity: 0;
        transition: opacity 0.3s ease;
        padding-right: 8px;
        gap: 8px;
        z-index: 1;

        &.show {
          opacity: 1;
        }

        button {
          border: none;
          outline: none;
          color: white;
          width: 40px;
          height: 40px;
          border-radius: 50%;
          display: flex;
          justify-content: center;
          align-items: center;
          cursor: pointer;
          transition: transform 0.2s, filter 0.2s;

          &:hover {
            transform: scale(1.1);
            filter: brightness(1.2);
          }

          &.pin-btn {
            background-color: #f39c12; // Orange for pin
          }

          &.delete-btn {
            background-color: #e74c3c; // Red for delete
          }
        }
      }
    }

    .list-item {
      position: relative;
      z-index: 2;
      background: v.$bg-secondary;
      transition: transform 0.2s ease-out;
      width: 100%;
      will-change: transform;
      margin-bottom: 0 !important; // override the margin since container handles it
      
      &:active {
        transition: none; // disable transition while swiping active
      }`);
  
  // also hide the old statically positioned delete-btn inside .list-item
  code = code.replace(/\.delete-btn \{([\s\S]*?&:hover[\s\S]*?)\}/g, '.old-delete-btn { display: none; }');

  fs.writeFileSync(path, code);
}
