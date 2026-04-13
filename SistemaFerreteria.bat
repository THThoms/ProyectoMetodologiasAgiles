@echo off
title Sistema Ferreteria
echo Iniciando Sistema Ferreteria...

start "ClientesAPI" cmd /k "cd C:\Users\USER\FerreteriaMS\ClientesAPI && dotnet run"
timeout /t 3 /nobreak

start "ComprasAPI" cmd /k "cd C:\Users\USER\FerreteriaMS\ComprasAPI && dotnet run"
timeout /t 3 /nobreak

start "Vite" cmd /k "cd C:\Users\USER\FerreteriaMS\ferremas-front && npm run dev"
timeout /t 5 /nobreak

cd C:\Users\USER\FerreteriaMS\ferremas-front
npm run electron