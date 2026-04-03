# AutoDiag Pro

Plataforma de diagnóstico automotriz con conexión OBD-II en tiempo real, IA integrada y gestión de taller.

## Stack

- **Backend**: Node.js + Express + WebSocket
- **Base de datos**: PostgreSQL (Railway)
- **IA**: Claude API + Web Search
- **Frontend**: HTML/CSS/JS (Vanilla)
- **OBD-II**: ELM327 WiFi / USB / Bluetooth
- **Deploy**: Railway + GitHub

## Setup local

```bash
# 1. Clonar
git clone https://github.com/matiimeneghello-ai/autodiag
cd autodiag

# 2. Instalar dependencias
npm install

# 3. Configurar variables
cp .env.example .env
# Editar .env con tus valores

# 4. Iniciar en desarrollo
npm run dev
```

## Variables de entorno requeridas

| Variable | Descripción |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string (Railway la provee automáticamente) |
| `ANTHROPIC_API_KEY` | API key de Anthropic |
| `OBD_HOST` | IP del adaptador ELM327 WiFi (dejar vacío para simulación) |
| `OBD_PORT` | Puerto TCP del ELM327 (default: 35000) |

## Deploy en Railway

1. Push al repo de GitHub
2. Ir a [railway.app](https://railway.app) → New Project → Deploy from GitHub
3. Seleccionar `matiimeneghello-ai/autodiag`
4. Agregar servicio PostgreSQL → Railway conecta automáticamente `DATABASE_URL`
5. Configurar variables de entorno en Railway dashboard:
   - `ANTHROPIC_API_KEY`
   - `OBD_HOST` (opcional — sin esto corre en modo simulación)

## Arquitectura OBD-II

```
Auto → Puerto OBD-II (bajo el volante)
         ↓
    Adaptador ELM327 WiFi
         ↓
    Red WiFi del taller
         ↓
    Node.js Server (Railway)  ←→  PostgreSQL
         ↓ WebSocket
    Browser del mecánico (Dashboard)
         ↓
    Claude API (IA Research + Web Search)
```

## Módulos

- **Dashboard** — Live data OBD-II en tiempo real
- **Multi-DTC** — Análisis de causa raíz entre múltiples códigos
- **Síntomas → DTC** — Diagnóstico inverso con IA
- **Escaneo** — Lectura completa de DTCs y freeze frame
- **Taller** — CRM Kanban para gestión de trabajos
- **IA Research** — Búsqueda en fuentes técnicas con web search
- **Aprendizaje** — Base de conocimiento colectivo de resoluciones

## Adaptadores OBD-II compatibles

| Tipo | Protocolo | Recomendado |
|------|-----------|-------------|
| ELM327 WiFi | TCP 192.168.0.10:35000 | ✓ Mejor opción |
| ELM327 USB | Serial /dev/ttyUSB0 | ✓ Estable |
| ELM327 Bluetooth | Serial /dev/rfcomm0 | ⚠ Variable |

## Vehículos compatibles

Todos los vehículos con puerto OBD-II (obligatorio desde 1996 en USA, 2001 en Europa, presente en la gran mayoría de autos latinoamericanos desde 2000).
