namespace ComprasAPI.Models;

public class Producto
{
    public int ProductoId { get; set; }
    public required string Codigo { get; set; }
    public required string Nombre { get; set; }
    public required string Marca { get; set; }
    public decimal PrecioUnitario { get; set; }
    public int Stock { get; set; } = 0;
    public bool Activo { get; set; } = true;
}