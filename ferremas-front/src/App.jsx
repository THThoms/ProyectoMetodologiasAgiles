import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Ventas from './pages/Ventas'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Ventas />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App