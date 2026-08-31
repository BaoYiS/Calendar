import { HashRouter, Link, Route, Routes } from 'react-router-dom'
import Aurora from './components/Aurora'
import { logout, useAuth } from './lib/auth'
import Create from './pages/Create'
import EventPage from './pages/EventPage'
import Home from './pages/Home'
import Login from './pages/Login'
import Respond from './pages/Respond'
import Settings from './pages/Settings'

function AuthControls() {
  const { status, user } = useAuth()
  if (status === 'loading') return <span className="topbar-auth" />
  return (
    <div className="topbar-auth">
      {user ? (
        <>
          <Link
            to="/settings"
            className="userchip"
            title={`Signed in as ${user.username} — settings`}
          >
            <span className="userchip-dot" aria-hidden="true" />
            {user.username}
          </Link>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={async () => {
              if (!(await logout())) {
                window.alert(
                  "Could not sign out — the server is unreachable, so you're still signed in. Check your connection and try again.",
                )
              }
            }}
          >
            Sign out
          </button>
        </>
      ) : (
        <Link to="/login" className="btn btn-ghost btn-sm">
          Sign in
        </Link>
      )}
      <Link to="/create" className="btn btn-primary btn-sm">
        New event
      </Link>
    </div>
  )
}

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
          <AuthControls />
        </header>
        <main>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/create" element={<Create />} />
            <Route path="/login" element={<Login />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/event/:id" element={<EventPage />} />
            <Route path="/respond/:id" element={<Respond />} />
            <Route path="*" element={<Home />} />
          </Routes>
        </main>
        <footer className="foot">
          Sign in to keep events on the server — or stay signed out and they live in this browser.
        </footer>
      </div>
    </HashRouter>
  )
}
