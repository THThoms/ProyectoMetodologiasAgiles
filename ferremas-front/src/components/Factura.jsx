import { QRCodeSVG } from 'qrcode.react'

export default function Factura({ factura, onNuevaVenta }) {
  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '32px 24px', fontFamily: 'Segoe UI, sans-serif' }}>
      
      <div style={{ background: '#1e293b', borderRadius: 12, padding: 32, border: '1px solid #334155' }}>
        
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
          <div>
            <div style={{ fontSize: 26, fontWeight: 800, color: '#f97316' }}>🔧 Ferretería</div>
            <div style={{ color: '#64748b', fontSize: 13, marginTop: 4 }}>Sistema de Ventas</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ background: '#f97316', color: 'white', padding: '4px 14px', borderRadius: 20, fontSize: 12, fontWeight: 700, marginBottom: 6 }}>FACTURA</div>
            <div style={{ color: '#f1f5f9', fontWeight: 700, fontSize: 18 }}>{factura.numeroComprobante}</div>
            <div style={{ color: '#64748b', fontSize: 12, marginTop: 4 }}>{new Date(factura.fechaVenta).toLocaleString()}</div>
          </div>
        </div>

        <div style={{ height: 1, background: '#334155', marginBottom: 24 }} />

        {/* Cliente */}
        <div style={{ background: '#0f172a', borderRadius: 8, padding: 16, marginBottom: 24 }}>
          <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Datos del Cliente</div>
          <div style={{ color: '#f1f5f9', fontWeight: 600, fontSize: 16 }}>{factura.clienteNombre}</div>
          <div style={{ color: '#94a3b8', fontSize: 14, marginTop: 4 }}>Cédula: {factura.clienteCedula}</div>
        </div>

        {/* Tabla */}
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 24 }}>
          <thead>
            <tr>
              {['Producto', 'Cant.', 'P. Unit.', 'Subtotal'].map(h => (
                <th key={h} style={{ padding: '10px 12px', background: '#0f172a', color: '#94a3b8', fontSize: 12, textTransform: 'uppercase', letterSpacing: 1, textAlign: h === 'Producto' ? 'left' : 'right' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {factura.detalles.map((d, i) => (
              <tr key={i} style={{ borderBottom: '1px solid #334155' }}>
                <td style={{ padding: '12px', color: '#e2e8f0' }}>{d.producto?.nombre || 'Producto'}</td>
                <td style={{ padding: '12px', textAlign: 'right', color: '#94a3b8' }}>{d.cantidad}</td>
                <td style={{ padding: '12px', textAlign: 'right', color: '#94a3b8' }}>${d.precioUnitario.toFixed(2)}</td>
                <td style={{ padding: '12px', textAlign: 'right', color: '#f1f5f9', fontWeight: 600 }}>${d.subtotal.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Totales y QR */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <div>
            <div style={{ fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>Código de verificación</div>
            <div style={{ background: 'white', padding: 8, borderRadius: 8, display: 'inline-block' }}>
              <QRCodeSVG value={factura.numeroComprobante} size={90} />
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 48, color: '#94a3b8', fontSize: 14, marginBottom: 6 }}>
              <span>Subtotal</span><span>${factura.subtotal.toFixed(2)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 48, color: '#94a3b8', fontSize: 14, marginBottom: 12 }}>
              <span>IVA 15%</span><span>${factura.iva.toFixed(2)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 48, color: '#f97316', fontSize: 24, fontWeight: 800, borderTop: '1px solid #334155', paddingTop: 12 }}>
              <span>TOTAL</span><span>${factura.total.toFixed(2)}</span>
            </div>
          </div>
        </div>
      </div>

      <button onClick={onNuevaVenta}
        style={{ marginTop: 16, width: '100%', padding: 14, background: 'linear-gradient(135deg, #f97316, #ea580c)', color: 'white', border: 'none', borderRadius: 8, fontSize: 16, fontWeight: 700, cursor: 'pointer' }}>
        Nueva Venta
      </button>
    </div>
  )
}