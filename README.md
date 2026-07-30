# Backend - Survival Game Server

## Requisitos

- Node.js v18+ (v25.9.0 es impar y no es recomendado para producción)
- MongoDB local o MongoDB Atlas (remoto)
- npm

## Instalación

1. Instala las dependencias:
```bash
npm install
```

2. Crea un archivo `.env` en la raíz del backend (basado en `.env.example`):
```bash
cp .env.example .env
```

3. Configura tus credenciales en `.env`:
   - `MONGODB_URI`: URI de conexión a MongoDB
   - `JWT_SECRET`: Clave secreta para JWT (cambiar en producción)
   - `SESSION_CLIENT_ID` y `SESSION_SECRET`: Credenciales de Google OAuth
     - `SESSION_CLIENT_ID` debe ser el Client ID de tipo "Web application"
     - Agrega `http://localhost:4200` a los Authorized JavaScript origins en Google Cloud Console

## Configuración de MongoDB

### Opción 1: MongoDB Local (Desarrollo Rápido)

1. Descarga MongoDB Community: https://www.mongodb.com/try/download/community
2. Instala y arranca el servicio (en Windows: `mongod`)
3. En `.env`, configura:
```env
MONGODB_URI=mongodb://localhost:27017/survival_game
```

### Opción 2: MongoDB Atlas (Nube - Recomendado)

1. Ve a https://www.mongodb.com/cloud/atlas
2. Crea una cuenta y un clúster
3. Configura un usuario con contraseña
4. Obtén la URI de conexión (como `mongodb+srv://user:password@cluster.mongodb.net/dbname`)
5. En `.env`, configura:
```env
MONGODB_URI=mongodb+srv://user:password@cluster.mongodb.net/survival_game
```

**Nota**: La URI remota ya configurada en el `.env` usa credenciales de ejemplo. Si no funciona, configura las tuyas propias desde MongoDB Atlas.

## Ejecución

```bash
npm start
```

El servidor se iniciará en el puerto 3000 (o el especificado en `PORT` del `.env`).

### Salida esperada:
```
2026-06-23T01:46:50.626Z [info] Servidor iniciado en puerto 3000 
2026-06-23T01:46:55.637Z [info] Fogata - intensidad actual: 97 
```

Si MongoDB no está disponible:
```
2026-06-23T01:47:20.622Z [warn] Database connection failed - running in degraded mode
```

El servidor seguirá funcionando en modo degradado, permitiendo pruebas de sockets.

## Verificar Salud del Servidor

```bash
curl http://localhost:3000/api/health
```

Respuesta:
```json
{"ok":true,"dbConnected":true}
```

Si `dbConnected` es `false`, MongoDB no está disponible pero el servidor sigue activo.

## Endpoints de Autenticación

### Registro
```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"testuser","password":"password123"}'
```

### Login
```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"testuser","password":"password123"}'
```

Devuelve un `token` JWT que debe usarse en las llamadas posteriores.

### Google OAuth
```bash
curl -X POST http://localhost:3000/api/auth/google \
  -H "Content-Type: application/json" \
  -d '{"idToken":"google-id-token-aqui"}'
```

## Estructura del Proyecto

```
backend/
├── server.js                 # Servidor principal
├── db.js                     # Conexión a MongoDB
├── logger.js                 # Sistema de logs (genera logs/app.logs)
├── entorno-worker.js         # Worker thread para ciclos día/noche
├── models/
│   └── user.model.js        # Modelo de usuario
├── services/
│   └── auth.service.js      # Lógica de autenticación
├── controllers/
│   ├── auth.controller.js   # Endpoints de auth
│   └── scoreboard.controller.js  # Endpoints de scoreboard
├── middleware/
│   └── auth.middleware.js   # Middleware de validación JWT
├── routes/
│   ├── auth.routes.js       # Rutas de autenticación
│   └── game.routes.js       # Rutas de juego
├── logs/
│   └── app.logs             # Log del sistema
├── .env                     # Configuración (no incluir en git)
├── .env.example             # Ejemplo de configuración
└── package.json             # Dependencias
```

## Estructura de Datos (MongoDB)

### Colección: users

```javascript
{
  _id: ObjectId,
  username: String,              // Único
  passwordHash: String,          // Opcional (para login local)
  oauthProvider: String,         // 'local' o 'google'
  results: [
    {
      score: Number,
      date: Date
    }
  ],
  createdAt: Date
}
```

## ACID y SOLID

- **ACID**: Transacciones de Mongoose en operaciones de registro (con startSession y withTransaction)
- **SOLID**:
  - Single Responsibility: Cada módulo tiene una responsabilidad clara
  - Open/Closed: Fácil extender con nuevos servicios
  - Liskov Substitution: Servicios implementan interfaces predecibles
  - Interface Segregation: Controladores usan solo lo necesario
  - Dependency Inversion: Servicios inyectados, no acoplados

## Solución de Problemas

### Error: "MongoDB connection failed"
- Verifica que MongoDB esté corriendo (local) o la URI sea correcta (Atlas)
- Comprueba las credenciales en el `.env`
- En modo degradado, el servidor sigue funcionando; usa `/api/health` para diagnosticar

### Error: "JWT verification failed"
- Asegúrate de que el token sea válido y no haya expirado
- Verifica que `JWT_SECRET` sea el mismo en `.env`

### Puerto en uso (Puerto 3000)
- Cambia `PORT` en `.env` a otro puerto, ej: `PORT=3001`

## Logging

Los logs se guardan en `logs/app.logs` y se muestran en consola también.

```bash
tail -f logs/app.logs  # En Linux/Mac
Get-Content logs/app.logs -Tail 10 -Wait  # En PowerShell Windows
```

---

**Última actualización**: 2026-06-23
