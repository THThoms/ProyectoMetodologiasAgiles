CREATE DATABASE ClientesDB;
GO

USE ClientesDB;
GO

CREATE TABLE dbo.Clientes (
    ClienteId     INT IDENTITY(1,1)  PRIMARY KEY NOT NULL,
    Cedula        NVARCHAR(13)        UNIQUE NOT NULL,
    Nombres       NVARCHAR(100)       NOT NULL,
    Apellidos     NVARCHAR(100)       NOT NULL,
    Telefono      NVARCHAR(15)        NULL,
    Email         NVARCHAR(150)       NULL,
    Direccion     NVARCHAR(250)       NULL,
    FechaRegistro DATETIME            DEFAULT GETDATE(),
    Activo        BIT                 DEFAULT 1
);
GO