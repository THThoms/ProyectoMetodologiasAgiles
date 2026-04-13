using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using ComprasAPI.Data;
using ComprasAPI.Models;

namespace ComprasAPI.Controllers;

[ApiController]
[Route("api/[controller]")]
public class ComprasController : ControllerBase
{
    private readonly ComprasContext _context;
    private readonly IHttpClientFactory _httpClientFactory;

    public ComprasController(ComprasContext context, IHttpClientFactory httpClientFactory)
    {
        _context = context;
        _httpClientFactory = httpClientFactory;
    }

    // GET: api/compras
    [HttpGet]
    public async Task<ActionResult<IEnumerable<CompraEncabezado>>> GetCompras()
    {
        return await _context.ComprasEncabezado
            .Include(c => c.Detalles)
            .ThenInclude(d => d.Producto)
            .ToListAsync();
    }

    // GET: api/compras/5
    [HttpGet("{id}")]
    public async Task<ActionResult<CompraEncabezado>> GetCompra(int id)
    {
        var compra = await _context.ComprasEncabezado
            .Include(c => c.Detalles)
            .ThenInclude(d => d.Producto)
            .FirstOrDefaultAsync(c => c.CompraId == id);

        if (compra == null) return NotFound();
        return compra;
    }

    // POST: api/compras
    [HttpPost]
    public async Task<ActionResult<CompraEncabezado>> PostCompra(CompraEncabezado compra)
    {
        // Validar que el cliente existe en ClientesAPI
        var httpClient = _httpClientFactory.CreateClient("ClientesAPI");
        var response = await httpClient.GetAsync($"api/clientes/{compra.ClienteId}");
        if (!response.IsSuccessStatusCode)
            return BadRequest("Cliente no encontrado en el sistema.");

        // Generar número de comprobante
        var count = await _context.ComprasEncabezado.CountAsync();
        compra.NumeroComprobante = $"FAC-{(count + 1):D6}";
        compra.FechaVenta = DateTime.Now;

        // Descontar stock
        foreach (var detalle in compra.Detalles)
        {
            var producto = await _context.Productos.FindAsync(detalle.ProductoId);
            if (producto == null) return BadRequest($"Producto {detalle.ProductoId} no encontrado.");
            if (producto.Stock < detalle.Cantidad)
                return BadRequest($"Stock insuficiente para {producto.Nombre}.");

            producto.Stock -= detalle.Cantidad;
            detalle.PrecioUnitario = producto.PrecioUnitario;
            detalle.Subtotal = detalle.Cantidad * detalle.PrecioUnitario;
        }

        // Calcular totales
        compra.Subtotal = compra.Detalles.Sum(d => d.Subtotal);
        compra.Iva = compra.Subtotal * 0.15m;
        compra.Total = compra.Subtotal + compra.Iva;

      _context.ComprasEncabezado.Add(compra);
await _context.SaveChangesAsync();

// Recargar sin ciclos
var resultado = await _context.ComprasEncabezado
    .Include(c => c.Detalles)
    .ThenInclude(d => d.Producto)
    .FirstOrDefaultAsync(c => c.CompraId == compra.CompraId);

return CreatedAtAction(nameof(GetCompra), new { id = compra.CompraId }, resultado);
    }
}
