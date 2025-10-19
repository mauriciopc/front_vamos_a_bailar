import { Routes, Route } from 'react-router-dom'
import Eventos from './Eventos.jsx'
import SpotiList from './SpotiList.jsx';

function App() {
  return (
    <Routes>
      <Route path="/" element={<Eventos />} />
      <Route path="/spoti" element={<SpotiList />} />
    </Routes>
  )
}

export default App