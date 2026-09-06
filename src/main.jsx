import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import WhatsNew from './views/WhatsNew'
import TrayFlyout from './views/TrayFlyout'
import './styles/global.css'

// The What's New window and the tray flyout load the same bundle with a
// #whatsnew / #tray hash so each renders only that view — a real separate
// OS window, not a renderer modal.
const isWhatsNew = window.location.hash === '#whatsnew'
const isTray = window.location.hash === '#tray'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {isWhatsNew ? <WhatsNew /> : isTray ? <TrayFlyout /> : <App />}
  </React.StrictMode>
)
