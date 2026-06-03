import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import WhatsNew from './views/WhatsNew'
import './styles/global.css'

// The What's New window loads the same bundle with a #whatsnew hash so it
// renders only that view — a real separate OS window, not a renderer modal.
const isWhatsNew = window.location.hash === '#whatsnew'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {isWhatsNew ? <WhatsNew /> : <App />}
  </React.StrictMode>
)
