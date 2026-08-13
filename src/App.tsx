import { HashRouter, Link, Route, Routes } from 'react-router-dom'
import Aurora from './components/Aurora'
import Create from './pages/Create'
import EventPage from './pages/EventPage'
import Home from './pages/Home'
import Respond from './pages/Respond'

export default function App() {
  return (
    <HashRouter>
      <Aurora />
      <div className="shell">
        <header className="topbar glass">
          <Link to="/" className="brand">
            <span className="brand-orb" aria-hidden="true" />
            <span className="brand-name">AquaPlan</span>
          </Link>
          <Link to="/create" className="btn btn-primary btn-sm">
            New event
          </Link>
        </header>
        <main>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/create" element={<Create />} />
            <Route path="/event/:id" element={<EventPage />} />
            <Route path="/respond/:id" element={<Respond />} />
            <Route path="*" element={<Home />} />
          </Routes>
        </main>
        <footer className="foot">Everything stays in your browser — no accounts, no servers.</footer>
      </div>
    </HashRouter>
  )
}
