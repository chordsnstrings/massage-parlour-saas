// Puck's own styles without its rsms.me font import (F10: pages load no outside stylesheets; the editor uses the
// local Inter Variable). Puck 0.23 still injects its built-in copy (which @imports rsms.me) unless it sees its
// stylesheet on :root (`--_puck-styles-loaded`) at first render — and async scripts can run before a stylesheet has
// loaded, so the flag is set here, before Puck renders. Import this first in every module that renders <Puck>.
import '@puckeditor/core/no-external.css'

if (typeof document !== 'undefined')
  document.documentElement.style.setProperty('--_puck-styles-loaded', '"true"')
