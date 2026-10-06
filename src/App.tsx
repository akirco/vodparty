import { lazy } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';

// Route-level code splitting: Player (945 lines) + hls.js and Settings
// (559 lines) together used to ship in the entry bundle that the home page
// loads on first paint. Each page is now fetched on demand.
const Home = lazy(() =>
  import('./pages/Home').then((m) => ({ default: m.Home })),
);
const Player = lazy(() =>
  import('./pages/Player').then((m) => ({ default: m.Player })),
);
const Search = lazy(() =>
  import('./pages/Search').then((m) => ({ default: m.Search })),
);
const Settings = lazy(() =>
  import('./pages/Settings').then((m) => ({ default: m.Settings })),
);
const History = lazy(() =>
  import('./pages/History').then((m) => ({ default: m.History })),
);

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Layout stays eager: it owns the header/nav shell. */}
        <Route path="/" element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="search" element={<Search />} />
          <Route path="video/:sourceId/:id" element={<Player />} />
          <Route path="history" element={<History />} />
          <Route path="settings" element={<Settings />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
