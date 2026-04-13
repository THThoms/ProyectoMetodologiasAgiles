using Microsoft.EntityFrameworkCore;
using ComprasAPI.Data;

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddDbContext<ComprasContext>(opt =>
    opt.UseSqlServer(builder.Configuration.GetConnectionString("DefaultConnection")));

builder.Services.AddControllers().AddJsonOptions(opt =>
    opt.JsonSerializerOptions.ReferenceHandler = System.Text.Json.Serialization.ReferenceHandler.IgnoreCycles);
builder.Services.AddEndpointsApiExplorer();
builder.Services.AddSwaggerGen();

builder.Services.AddCors(opt => opt.AddPolicy("ReactApp", p =>
    p.WithOrigins("http://localhost:5173")
     .AllowAnyHeader()
     .AllowAnyMethod()));

builder.Services.AddHttpClient("ClientesAPI", client =>
{
    client.BaseAddress = new Uri("http://localhost:5001/");
});

var app = builder.Build();

app.UseSwagger();
app.UseSwaggerUI();
app.UseCors("ReactApp");
app.UseAuthorization();
app.MapControllers();

app.Run();