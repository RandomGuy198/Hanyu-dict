import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './app/App';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/entries.css';

const container = document.getElementById('root');
if (!container) throw new Error('The page is missing its #root element.');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
