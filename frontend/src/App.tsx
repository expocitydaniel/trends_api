import { NavLink, Route, Routes } from 'react-router-dom'
import { HomePage } from './pages/HomePage'
import { CreateRulePage } from './pages/CreateRulePage'
import { RulesPage } from './pages/RulesPage'
import { EditRulePage } from './pages/EditRulePage'
import { CollectPage } from './pages/CollectPage'
import { LabelPage } from './pages/LabelPage'
import { ExportPage } from './pages/ExportPage'
import './App.css'

export default function App() {
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">◈</span>
          <div>
            <strong>Trends ML Data</strong>
            <div className="tagline">Collect · Label · Export</div>
          </div>
        </div>
        <nav className="nav">
          <NavLink to="/" end>
            Home
          </NavLink>
          <NavLink to="/rules" end>
            Rules
          </NavLink>
          <NavLink to="/rules/new">New rule</NavLink>
          <NavLink to="/collect">Collect</NavLink>
          <NavLink to="/label">Label</NavLink>
          <NavLink to="/export">Export</NavLink>
        </nav>
      </header>

      <main className="main">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/rules" element={<RulesPage />} />
          <Route path="/rules/new" element={<CreateRulePage />} />
          <Route path="/rules/:ruleId" element={<EditRulePage />} />
          <Route path="/collect" element={<CollectPage />} />
          <Route path="/label" element={<LabelPage />} />
          <Route path="/export" element={<ExportPage />} />
        </Routes>
      </main>
    </div>
  )
}
