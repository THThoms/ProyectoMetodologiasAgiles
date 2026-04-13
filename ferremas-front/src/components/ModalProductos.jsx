import { useEffect, useState } from 'react'
import axios from 'axios'

export default function ModalProductos({ api, onSeleccionar, onCerrar }) {
  const [productos, setProductos] = useState([])
  const [busqueda, setBusqueda] = useState('')
  const [cantidades, setCantidades] = useState({})

  useEffect(() => {
    axios.get(`${api}/api/productos`).then(res => setProductos(res.data))
  }, [api])

  const filtrados = productos.filter(p =>
    p.nombre.toLowerCase().includes(busqueda.toLowerCase()) ||
    p.codigo.toLowerCase().includes(busqueda.toLowerCase())
  )

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{ background: '#1e293b', borderRadius: 12, padding: 24, width: '100%', maxWidth: 680, maxHeight: '85vh', display: 'flex', flexDirection: 'column', border: '1px solid #334155' }}>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ color: '#f1f5f9', margin: 0 }}>🛒 Seleccionar Producto</h3>
          <button onClick={onCerrar} style={{ background: '#334155', border: 'none', color: '#94a3b8', width: 32, height: 32, borderRadius: 6, cursor: 'pointer', fontSize: 16 }}>✕</button>
        </div>

        <input value={busqueda} onChange={e => setBusqueda(e.target.value)}
          placeholder="Buscar por nombre o código..."
          style={{ padding: '10px 14px', background: '#0f172a', border: '1px solid #334155', borderRadius: 8, color: '#f1f5f9', fontSize: 14, marginBottom: 16, outline: 'none' }} />

        <div style={{ overflowY: 'auto', flex: 1 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Producto', 'Precio', 'Stock', 'Cantidad', ''].map(h => (
                  <th key={h} style={{ padding: '10px 12px', background: '#0f172a', color: '#94a3b8', fontSize: 12, textTransform: 'uppercase', letterSpacing: 1, textAlign: h === 'Producto' ? 'left' : 'center', position: 'sticky', top: 0 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtrados.map(p => (
                <tr key={p.productoId} style={{ borderBottom: '1px solid #334155', opacity: p.stock === 0 ? 0.5 : 1 }}>
                  <td style={{ padding: '12px', color: '#e2e8f0' }}>
                    <div style={{ fontWeight: 600 }}>{p.nombre}</div>
                    <div style={{ fontSize: 12, color: '#64748b' }}>{p.marca} — {p.codigo}</div>
                  </td>
                  <td style={{ padding: 12, textAlign: 'center', color: '#4ade80', fontWeight: 600 }}>${p.precioUnitario.toFixed(2)}</td>
                  <td style={{ padding: 12, textAlign: 'center', fontWeight: p.stock === 0 ? 700 : 400, color: p.stock === 0 ? '#f87171' : p.stock < 5 ? '#fb923c' : '#94a3b8' }}>
                    {p.stock === 0 ? 'Sin stock' : p.stock}
                  </td>
                  <td style={{ padding: 12, textAlign: 'center' }}>
                    <input type="number" min="1" max={p.stock}
                      disabled={p.stock === 0}
                      value={cantidades[p.productoId] || 1}
                      onChange={e => setCantidades({ ...cantidades, [p.productoId]: parseInt(e.target.value) })}
                      style={{ width: 64, padding: '6px 8px', textAlign: 'center', background: '#0f172a', border: '1px solid #334155', borderRadius: 6, color: '#f1f5f9', opacity: p.stock === 0 ? 0.4 : 1 }} />
                  </td>
                  <td style={{ padding: 12, textAlign: 'center' }}>
                    <button
                      onClick={() => p.stock > 0 && onSeleccionar(p, cantidades[p.productoId] || 1)}
                      disabled={p.stock === 0}
                      style={{ padding: '6px 14px', background: p.stock === 0 ? '#334155' : '#f97316', color: p.stock === 0 ? '#64748b' : 'white', border: 'none', borderRadius: 6, cursor: p.stock === 0 ? 'not-allowed' : 'pointer', fontWeight: 600, fontSize: 13 }}>
                      {p.stock === 0 ? 'Agotado' : 'Agregar'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {filtrados.length === 0 && (
            <p style={{ textAlign: 'center', color: '#475569', padding: 32 }}>No se encontraron productos.</p>
          )}
        </div>
      </div>
    </div>
  )
}