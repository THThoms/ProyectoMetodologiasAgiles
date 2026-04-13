using Microsoft.EntityFrameworkCore;
using ComprasAPI.Models;

namespace ComprasAPI.Data;

public class ComprasContext : DbContext
{
    public ComprasContext(DbContextOptions<ComprasContext> options) : base(options) { }

    public DbSet<Producto> Productos => Set<Producto>();
    public DbSet<CompraEncabezado> ComprasEncabezado => Set<CompraEncabezado>();
    public DbSet<CompraDetalle> ComprasDetalle => Set<CompraDetalle>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Producto>()
            .HasIndex(p => p.Codigo)
            .IsUnique();

        modelBuilder.Entity<CompraEncabezado>()
            .HasIndex(c => c.NumeroComprobante)
            .IsUnique();

        modelBuilder.Entity<CompraDetalle>()
            .HasOne(d => d.CompraEncabezado)
            .WithMany(c => c.Detalles)
            .HasForeignKey(d => d.CompraId);

        modelBuilder.Entity<CompraDetalle>()
            .HasOne(d => d.Producto)
            .WithMany()
            .HasForeignKey(d => d.ProductoId);
    }
}
