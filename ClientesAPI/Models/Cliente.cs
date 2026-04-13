 namespace ClientesAPI.Models;

public class Cliente
{
    public int ClienteId { get; set; }
    public required string Cedula { get; set; }
    public required string Nombres { get; set; }
    public required string Apellidos { get; set; }
    public string? Telefono { get; set; }
    public string? Email { get; set; }
    public string? Direccion { get; set; }
    public DateTime FechaRegistro { get; set; } = DateTime.Now;
    public bool Activo { get; set; } = true;
}
