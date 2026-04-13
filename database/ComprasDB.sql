CREATE DATABASE ComprasDB;
GO

USE ComprasDB;
GO

CREATE TABLE dbo.Productos (
    ProductoId     INT IDENTITY(1,1) PRIMARY KEY NOT NULL,
    Codigo         NVARCHAR(20)      UNIQUE NOT NULL,
    Nombre         NVARCHAR(150)     NOT NULL,
    Marca          NVARCHAR(80)      NOT NULL,
    PrecioUnitario DECIMAL(10,2)     NOT NULL,
    Stock          INT               DEFAULT 0,
    Activo         BIT               DEFAULT 1
);
GO

CREATE TABLE dbo.ComprasEncabezado (
    CompraId           INT IDENTITY(1,1) PRIMARY KEY NOT NULL,
    ClienteId          INT               NOT NULL,
    FechaVenta         DATETIME          DEFAULT GETDATE(),
    NumeroComprobante  NVARCHAR(20)      NOT NULL DEFAULT '',
    Subtotal           DECIMAL(10,2)     NOT NULL,
    Iva                DECIMAL(10,2)     NOT NULL,
    Total              DECIMAL(10,2)     NOT NULL
);
GO

CREATE TABLE dbo.ComprasDetalle (
    DetalleId      INT IDENTITY(1,1) PRIMARY KEY NOT NULL,
    CompraId       INT               NOT NULL REFERENCES dbo.ComprasEncabezado(CompraId),
    ProductoId     INT               NOT NULL REFERENCES dbo.Productos(ProductoId),
    Cantidad       INT               NOT NULL,
    PrecioUnitario DECIMAL(10,2)     NOT NULL,
    Subtotal       DECIMAL(10,2)     NOT NULL
);
GO

-- Productos de ejemplo
INSERT INTO Productos (Codigo, Nombre, Marca, PrecioUnitario, Stock, Activo) VALUES
('MART-001', 'Martillo de Carpintero', 'Stanley', 12.50, 50, 1),
('DEST-001', 'Destornillador Phillips', 'Truper', 5.75, 100, 1),
('TADR-001', 'Taladro Percutor 600W', 'Bosch', 89.99, 15, 1),
('LIJA-001', 'Lija de Agua #120', 'Norton', 1.25, 200, 1),
('CINC-001', 'Cinta Métrica 5m', 'Stanley', 8.50, 60, 1),
('PINT-001', 'Pintura Blanca 1 galón', 'Condor', 18.00, 30, 1),
('TORN-001', 'Tornillos autorroscantes 1"', 'Hilti', 3.50, 500, 1),
('GUANT-001', 'Guantes de trabajo', 'Truper', 6.25, 80, 1);
GO