using System.ComponentModel.DataAnnotations;

namespace ComprasAPI.Models;

public class CompraEncabezado
{
    [Key]
    public int CompraId { get; set; }
    public int ClienteId { get; set; }
    public DateTime FechaVenta { get; set; } = DateTime.Now;
    public string NumeroComprobante { get; set; } = string.Empty;
    public decimal Subtotal { get; set; }
    public decimal Iva { get; set; }
    public decimal Total { get; set; }

    public ICollection<CompraDetalle> Detalles { get; set; } = new List<CompraDetalle>();
}