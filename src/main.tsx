import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { initFrontendSentry } from './lib/sentry'

initFrontendSentry()

const root = createRoot(document.getElementById('root')!)

// The pose-board example is a view only. Load it without Firebase so a
// missing client config cannot block the preview.
if (window.location.pathname === '/flow-example') {
  void import('./features/history/generation-flow/NodeWorkflowExample.tsx').then(({ NodeWorkflowExample }) => {
    root.render(<StrictMode><NodeWorkflowExample /></StrictMode>)
  })
} else {
  void Promise.all([
    import('./App.tsx'),
    import('./lib/WorkspaceContext.tsx'),
    import('./lib/FirebaseAuthContext.tsx'),
  ]).then(([{ default: App }, { WorkspaceProvider }, { FirebaseAuthProvider }]) => {
    root.render(
      <StrictMode>
        <FirebaseAuthProvider>
          <WorkspaceProvider>
            <App />
          </WorkspaceProvider>
        </FirebaseAuthProvider>
      </StrictMode>,
    )
  })
}
