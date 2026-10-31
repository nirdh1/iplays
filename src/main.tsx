import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './theme/tokens.css';
import './theme/base.css';
import './theme/components.css';
import { App } from './App';
import { LiveProvider } from './data/liveStore';
import { AuthProvider } from './auth/AuthContext';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <LiveProvider>
        <App />
      </LiveProvider>
    </AuthProvider>
  </StrictMode>,
);
