import { useState } from 'react'
import axios from 'axios'
import ModalProductos from '../components/ModalProductos'
import Factura from '../components/Factura'

const CLIENTES_API = 'http://localhost:5001'
const COMPRAS_API = 'http://localhost:5002'

const s = {
  page: { maxWidth: 960, margin: '0 auto', padding: '32px 24px' },
  header: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 32 },
  logo: { fontSize: 36 },
  title: { fontSize: 28, fontWeight: 700, color: '#f97316' },
  subtitle: { fontSize: 13, color: '#64748b' },
  card: { background: '#1e293b', borderRadius: 12, padding: 24, marginBottom: 20, border: '1px solid #334155' },
  label: { fontSize: 12, color: '#94a3b8', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 1 },
  row: { display: 'flex', gap: 10 },
  input: { flex: 1, padding: '10px 14px', background: '#0f172a', border: '1px solid #334155', borderRadius: 8, color: '#f1f5f9', fontSize: 14, outline: 'none' },
  btnOrange: { padding: '10px 20px', background: '#f97316', color: 'white', border: 'none', borderRadius: 8, fontWeight: 600, cursor: 'pointer', fontSize: 14 },
  btnBlue: { padding: '10px 20px', background: '#3b82f6', color: 'white', border: 'none', borderRadius: 8, fontWeight: 600, cursor: 'pointer', fontSize: 14 },
  btnGreen: { padding: '10px 20px', background: '#22c55e', color: 'white', border: 'none', borderRadius: 8, fontWeight: 600, cursor: 'pointer', fontSize: 14 },
  successBadge: { marginTop: 12, padding: '10px 14px', background: '#052e16', border: '1px solid #16a34a', borderRadius: 8, color: '#4ade80', fontSize: 14 },
  errorText: { color: '#f87171', fontSize: 14, marginTop: 8 },
  sectionTitle: { fontSize: 16, fontWeight: 600, color: '#cbd5e1', marginBottom: 16 },
  table: { width: '100%', borderCollapse: 'collapse' },
  th: { padding: '10px 12px', background: '#0f172a', color: '#94a3b8', fontSize: 12, textTransform: 'uppercase', letterSpacing: 1, textAlign: 'left' },
  td: { padding: '12px', borderBottom: '1px solid #334155', fontSize: 14, color: '#e2e8f0' },
  totalsBox: { background: '#0f172a', borderRadius: 8, padding: 16, marginTop: 16 },
  totalRow: { display: 'flex', justifyContent: 'space-between', padding: '6px 0', color: '#94a3b8', fontSize: 14 },
  totalFinal: { display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderTop: '1px solid #334155', marginTop: 8, color: '#f97316', fontSize: 20, fontWeight: 700 },
  btnConfirm: { width: '100%', padding: 14, background: 'linear-gradient(135deg, #f97316, #ea580c)', color: 'white', border: 'none', borderRadius: 8, fontSize: 16, fontWeight: 700, cursor: 'pointer', marginTop: 16 },
}

export default function Ventas() {
  const [cedula, setCedula] = useState('')
  const [cliente, setCliente] = useState(null)
  const [nuevoCliente, setNuevoCliente] = useState(false)
  const [form, setForm] = useState({ nombres: '', apellidos: '', telefono: '', email: '', direccion: '' })
  const [detalles, setDetalles] = useState([])
  const [modalOpen, setModalOpen] = useState(false)
  const [factura, setFactura] = useState(null)

  const buscarCliente = async () => {
  const validacion = validarIdentificacion(cedula)
  if (!validacion.valido) {
    alert(validacion.mensaje)
    return
  }
  try {
    const res = await axios.get(`${CLIENTES_API}/api/clientes/cedula/${cedula}`)
    setCliente(res.data)
    setNuevoCliente(false)
  } catch {
    setCliente(null)
    setNuevoCliente(true)
  }
}

  const registrarCliente = async () => {
    const res = await axios.post(`${CLIENTES_API}/api/clientes`, { cedula, ...form, activo: true })
    setCliente(res.data)
    setNuevoCliente(false)
  }

  const agregarProducto = (producto, cantidad) => {
    const existente = detalles.find(d => d.productoId === producto.productoId)
    if (existente) {
      setDetalles(detalles.map(d => d.productoId === producto.productoId
        ? { ...d, cantidad: d.cantidad + cantidad }
        : d))
    } else {
      setDetalles([...detalles, {
        productoId: producto.productoId,
        nombre: producto.nombre,
        precioUnitario: producto.precioUnitario,
        cantidad,
        subtotal: producto.precioUnitario * cantidad
      }])
    }
    setModalOpen(false)
  }

  const eliminarDetalle = (productoId) => {
    setDetalles(detalles.filter(d => d.productoId !== productoId))
  }

  const subtotal = detalles.reduce((acc, d) => acc + d.precioUnitario * d.cantidad, 0)
  const iva = subtotal * 0.15
  const total = subtotal + iva

  const confirmarCompra = async () => {
    const compra = {
      clienteId: cliente.clienteId,
      subtotal, iva, total,
      numeroComprobante: '',
      detalles: detalles.map(d => ({
        productoId: d.productoId,
        cantidad: d.cantidad,
        precioUnitario: d.precioUnitario,
        subtotal: d.precioUnitario * d.cantidad
      }))
    }
    const res = await axios.post(`${COMPRAS_API}/api/compras`, compra)
    setFactura({ ...res.data, clienteNombre: `${cliente.nombres} ${cliente.apellidos}`, clienteCedula: cedula })
    setDetalles([])
    setCliente(null)
    setCedula('')
  }

  if (factura) return <Factura factura={factura} onNuevaVenta={() => setFactura(null)} />
const validarIdentificacion = (valor) => {
  const soloNumeros = /^\d+$/.test(valor)
  if (soloNumeros) {
    if (valor.length === 10) return { valido: true, tipo: 'Cédula' }
    if (valor.length === 13 && valor.endsWith('001')) return { valido: true, tipo: 'RUC' }
    return { valido: false, tipo: null, mensaje: 'Cédula debe tener 10 dígitos o RUC 13 dígitos terminando en 001' }
  } else {
    if (valor.length >= 5 && valor.length <= 20) return { valido: true, tipo: 'Pasaporte' }
    return { valido: false, tipo: null, mensaje: 'Pasaporte debe tener entre 5 y 20 caracteres' }
  }
}
  return (
    <div style={s.page}>
      <div style={s.header}>
        <span style={s.logo}>🔧</span>
        <div>
          <div style={s.title}>Ferretería</div>
          <div style={s.subtitle}>Sistema de Ventas</div>
        </div>
      </div>

      {/* Card Cliente */}
      <div style={s.card}>
        <div style={s.sectionTitle}>👤 Identificación del Cliente</div>
        <div style={s.row}>
          <input style={s.input} value={cedula}
  onChange={e => {
    const val = e.target.value
    
    if (/^[a-zA-Z0-9]*$/.test(val)) setCedula(val)
  }}
            onKeyDown={e => e.key === 'Enter' && buscarCliente()}
            placeholder="Ingrese número de cédula..." />
          <button style={s.btnOrange} onClick={buscarCliente}>Buscar</button>
        </div>

        {cliente && (
          <div style={s.successBadge}>
            ✅ <strong>{cliente.nombres} {cliente.apellidos}</strong> — {cliente.email || 'Sin email'}
          </div>
        )}

        {nuevoCliente && (
          <div style={{ marginTop: 16 }}>
            <p style={s.errorText}>⚠ Cliente no encontrado. Complete los datos para registrarlo:</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 12 }}>
              {[['nombres', 'Nombres'], ['apellidos', 'Apellidos'], ['telefono', 'Teléfono'], ['email', 'Email'], ['direccion', 'Dirección']].map(([campo, label]) => (
                <input key={campo} placeholder={label} value={form[campo]}
                  onChange={e => setForm({ ...form, [campo]: e.target.value })}
                  style={{ ...s.input, flex: 'none', gridColumn: campo === 'direccion' ? 'span 2' : 'auto' }} />
              ))}
            </div>
            <button style={{ ...s.btnGreen, marginTop: 12 }} onClick={registrarCliente}>
              ✚ Registrar Cliente
            </button>
          </div>
        )}
      </div>

      {/* Card Productos */}
      {cliente && (
        <div style={s.card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div style={s.sectionTitle}>🛒 Detalle de Compra</div>
            <button style={s.btnBlue} onClick={() => setModalOpen(true)}>+ Agregar Producto</button>
          </div>

          {detalles.length === 0 ? (
            <p style={{ color: '#475569', textAlign: 'center', padding: 32 }}>No hay productos agregados aún.</p>
          ) : (
            <>
              <table style={s.table}>
                <thead>
                  <tr>
                    <th style={s.th}>Producto</th>
                    <th style={{ ...s.th, textAlign: 'center' }}>Cant.</th>
                    <th style={{ ...s.th, textAlign: 'right' }}>Precio</th>
                    <th style={{ ...s.th, textAlign: 'right' }}>Subtotal</th>
                    <th style={s.th}></th>
                  </tr>
                </thead>
                <tbody>
                  {detalles.map(d => (
                    <tr key={d.productoId}>
                      <td style={s.td}>{d.nombre}</td>
                      <td style={{ ...s.td, textAlign: 'center' }}>{d.cantidad}</td>
                      <td style={{ ...s.td, textAlign: 'right' }}>${d.precioUnitario.toFixed(2)}</td>
                      <td style={{ ...s.td, textAlign: 'right' }}>${(d.precioUnitario * d.cantidad).toFixed(2)}</td>
                      <td style={{ ...s.td, textAlign: 'center' }}>
                        <button onClick={() => eliminarDetalle(d.productoId)}
                          style={{ background: 'none', border: 'none', color: '#f87171', cursor: 'pointer', fontSize: 16 }}>✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div style={s.totalsBox}>
                <div style={s.totalRow}><span>Subtotal</span><span>${subtotal.toFixed(2)}</span></div>
                <div style={s.totalRow}><span>IVA 15%</span><span>${iva.toFixed(2)}</span></div>
                <div style={s.totalFinal}><span>TOTAL</span><span>${total.toFixed(2)}</span></div>
              </div>

              <button style={s.btnConfirm} onClick={confirmarCompra}>
                Confirmar Compra
              </button>
            </>
          )}
        </div>
      )}

      {modalOpen && <ModalProductos api={COMPRAS_API} onSeleccionar={agregarProducto} onCerrar={() => setModalOpen(false)} />}
    </div>
  )
}