using System.ComponentModel.DataAnnotations;

namespace ComprasAPI.Models;

public class CompraDetalle
{
    [Key]
    public int DetalleId { get; set; }
    public int CompraId { get; set; }
    public int ProductoId { get; set; }
    public int Cantidad { get; set; }
    public decimal PrecioUnitario { get; set; }
    public decimal Subtotal { get; set; }

    public CompraEncabezado? CompraEncabezado { get; set; }
    public Producto? Producto { get; set; }
}