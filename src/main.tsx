import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { IslandApp } from '@/components/island/IslandApp';
import { DemoApp } from '@/components/island/DemoApp';
import './styles/global.css';

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root');

declare global {
  interface Window {
    /** Set by the single-file preview build to show the island and panel together. */
    __ACC_PREVIEW__?: string;
  }
}

// One bundle, two windows: the island loads this page with #island.
const Root =
  window.location.hash === '#island' ? IslandApp : window.__ACC_PREVIEW__ === 'demo' ? DemoApp : App;

createRoot(container).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
