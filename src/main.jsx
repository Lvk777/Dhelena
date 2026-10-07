import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '@/App.jsx'
import '@/index.css'
import { installPreloadRecovery } from '@/lib/preloadRecovery'

installPreloadRecovery(window, () => window.sessionStorage, import.meta.url, () => window.location.reload())

ReactDOM.createRoot(document.getElementById('root')).render(
    <App />
)
