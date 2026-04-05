# AutoDiag Pro — Agente J2534

Agente desktop para Windows que conecta interfaces **J2534 Pass-Thru** con la plataforma AutoDiag Pro, habilitando diagnóstico completo de **todos los módulos** del vehículo.

## Módulos soportados

| Módulo | Descripción |
|--------|-------------|
| 🔧 Motor (ECU/PCM) | DTCs P0xxx, live data, fuel trim, O2 |
| ⚙️ Transmisión (TCM) | DTCs P07xx, datos de cambio |
| 🛑 ABS/ESP | DTCs C0xxx, sensores de velocidad por rueda |
| 🫧 Airbag (SRS) | DTCs B0xxx, estado de airbags |
| 💡 Carrocería (BCM) | DTCs B1xxx, iluminación, cerraduras |
| 📊 Instrumentos (IPC) | DTCs U0xxx, tablero |
| ❄️ Climatizador (HVAC) | DTCs B1xxx, temperatura |
| 🎯 Dirección (EPS) | DTCs C1xxx, dirección asistida |

## Interfaces J2534 compatibles

- ✅ Tactrix Openport 2.0
- ✅ Drew Technologies MongoosePro
- ✅ OBDLINK EX / MX+
- ✅ Autel MaxiFlash J2534
- ✅ Cualquier interfaz J2534 certificada SAE
- ✅ Clones J2534 compatibles

## Instalación

### Opción 1 — Ejecutable (recomendado)
```
1. Descargar AutoDiagAgent.exe
2. Doble click para ejecutar
3. Ingresar token de AutoDiag Pro cuando lo pide
4. El agente detecta la interfaz J2534 automáticamente
```

### Opción 2 — Node.js
```bash
npm install
node agent.js
# O con DLL específica:
node agent.js "C:\Program Files\Tactrix\Openport 2.0\op20pt32.dll"
```

### Obtener token
1. Abrir AutoDiag Pro en el browser
2. Click en avatar (arriba derecha)
3. Copiar token de sesión

## Uso

El agente se conecta automáticamente a `autodiag-production.up.railway.app`.

En la plataforma web aparece un indicador **J2534** verde en el topbar cuando el agente está conectado.

Desde el Dashboard podés:
- **Escanear todos los módulos** — DTC completo de todos los módulos
- **Live data** — Datos en tiempo real del motor

## Configuración manual

Editar `%APPDATA%\AutoDiagAgent\config.json`:
```json
{
  "serverUrl": "wss://autodiag-production.up.railway.app",
  "authToken": "tu-token-aqui",
  "j2534Dll": "C:\\ruta\\a\\interfaz.dll",
  "protocol": "ISO15765",
  "baudRate": 500000,
  "scanInterval": 2000
}
```

## Protocolos soportados

- `ISO15765` — CAN OBD-II (autos modernos post-2008) ✅ Recomendado
- `ISO14230` — KWP2000 (autos 2000-2008)
- `ISO9141` — autos viejos pre-2000
- `CAN` — CAN bus directo
- `J1850VPW/PWM` — GM/Ford anteriores a 2003
