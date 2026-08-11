import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { WorkspaceProvider } from './lib/WorkspaceContext.tsx'
import { FirebaseAuthProvider } from './lib/FirebaseAuthContext.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <FirebaseAuthProvider>
      <WorkspaceProvider>
        <App />
      </WorkspaceProvider>
    </FirebaseAuthProvider>
  </StrictMode>,
)
