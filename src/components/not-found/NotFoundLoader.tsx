'use client';

import React from 'react';
import dynamic from 'next/dynamic';

// Same approach as the main page: skip server rendering. The sky, the flock
// and the sender lookup are all client-side anyway, and MUI's server-rendered
// styles do not hydrate cleanly in this app's root layout. The fallback uses
// no MUI so the prerendered 404.html is just a space-coloured screen.
const NotFoundExperience = dynamic(() => import('./NotFoundExperience'), {
  ssr: false,
  loading: () => <div style={{ minHeight: '100vh', background: '#04030c' }} />,
});

// Known quirk: `next dev` renders the 404 on demand and logs a hydration
// warning about Emotion's global <style> sitting ahead of this subtree. The
// static export (dist/404.html, what hosts actually serve) hydrates cleanly.
export default function NotFoundLoader() {
  return (
    <div>
      <NotFoundExperience />
    </div>
  );
}
