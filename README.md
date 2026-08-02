# ProyectoInd_JuanJ

Aplicación web de juego multijugador con frontend en Angular y backend en Node.js.  
El proyecto incluye:

- autenticación con correo y contraseña
- verificación por código y recuperación de contraseña
- MFA
- salas multijugador en tiempo real con `Socket.IO`
- tablero de puntuaciones
- perfil de usuario
- tienda de cosméticos
- pagos con PayPal y PayPhone
- subida de avatar a almacenamiento remoto

## Estructura del repositorio

- `backend/`: API REST, sockets y lógica del juego
- `frontend/`: aplicación Angular
- `main.tex`: documento principal del informe
- `Informe_Proyecto_JuanJ_Actualizado_editado.docx`: versión editable del informe

## Tecnologías

- Backend: Node.js, Express, Socket.IO, PostgreSQL, JWT, bcryptjs, dotenv
- Frontend: Angular 21, TypeScript, RxJS, Socket.IO Client
- Integraciones: Supabase, Vercel Blob, PayPal, PayPhone, Google OAuth, correo SMTP

## Requisitos

- Node.js 18 o superior
- npm
- Base de datos PostgreSQL accesible desde el backend
- Variables de entorno configuradas en `backend/.env`

## Configuración del backend

1. Entrar a la carpeta del backend:

```bash
cd backend
```

2. Instalar dependencias:

```bash
npm install
```

3. Crear el archivo de entorno a partir del ejemplo:

```bash
copy .env.example .env
```

4. Completar las variables según tu entorno. Las más importantes son:

- `JWT_SECRET`
- `PORT`
- `BASE_URL`
- credenciales de correo para verificación y recuperación
- credenciales de Google OAuth
- credenciales de PayPal
- credenciales de PayPhone

### Ejecución del backend

```bash
npm start
```

Por defecto el servidor arranca en `http://localhost:3000`.

### Salud del backend

```bash
curl http://localhost:3000/api/health
```

Respuesta esperada:

```json
{ "ok": true, "dbConnected": true }
```

Si la base de datos no responde, el servidor puede seguir levantado en modo degradado para pruebas de sockets y desarrollo local.

## Configuración del frontend

1. Entrar a la carpeta del frontend:

```bash
cd frontend
```

2. Instalar dependencias:

```bash
npm install
```

3. Ejecutar la app:

```bash
npm start
```

La app Angular se abre normalmente en `http://localhost:4200`.

El frontend usa `src/app/utils/backend-config.ts` para apuntar al backend local o a despliegues en Render/Railway/Vercel.

## Rutas principales del frontend

- `/login`
- `/login-mfa`
- `/register`
- `/verify`
- `/forgot-password`
- `/reset-password`
- `/start`
- `/game`
- `/scoreboard`
- `/profile`
- `/store`
- `/payment/complete`

## Rutas principales del backend

- `GET /api/health`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/google`
- `POST /api/auth/verify-code`
- `POST /api/auth/resend-code`
- `POST /api/auth/forgot-password`
- `POST /api/auth/reset-password`
- `GET /api/auth/mfa/status`
- `POST /api/auth/mfa/setup`
- `POST /api/auth/mfa/confirm`
- `POST /api/auth/mfa/disable`
- `POST /api/auth/mfa/verify`
- `POST /api/auth/refresh`
- `GET /api/profile`
- `POST /api/profile/avatar`
- `GET /api/store/items`
- `POST /api/store/buy`
- `POST /api/store/equip`
- `GET /api/store/equipped`
- `GET /api/scoreboard`
- `POST /api/scoreboard`
- `POST /api/payments/paypal/create`
- `POST /api/payments/paypal/capture`
- `GET /api/payments/paypal/success`
- `GET /api/payments/paypal/cancel`
- `POST /api/payments/paypal/confirm`
- `POST /api/payments/payphone/create`
- `POST /api/payments/payphone/confirm`
- `GET /api/payments/payphone/success`
- `GET /api/payments/payphone/cancel`

## Juego en tiempo real

El backend mantiene salas públicas por defecto:

- `public-1` - fácil
- `public-2` - intermedia
- `public-3` - difícil

También permite crear salas personalizadas con contraseña y dificultad.  
La comunicación del juego se maneja con `Socket.IO` para:

- unir y dejar salas
- mover jugadores
- recolectar recursos
- depositar recursos para puntaje
- actualizar la fogata
- cambiar entre día y noche
- sincronizar enemigos y estado del mundo

## Carpetas importantes del backend

- `controllers/`: lógica de los endpoints
- `routes/`: definición de rutas HTTP
- `services/`: servicios de autenticación y pagos
- `middleware/`: validaciones y auth
- `models/`: modelos y estructura de datos
- `logs/`: archivos de log

## Notas de uso

- El servidor backend no se detiene si la base de datos falla al inicio; registra el error y sigue en modo degradado.
- El frontend permite seleccionar el backend desde el almacenamiento local del navegador.
- La subida de avatar usa `Vercel Blob`.

## Desarrollo

Para trabajar en ambos lados, normalmente se levantan dos terminales:

```bash
cd backend
npm start
```

```bash
cd frontend
npm start
```

## Estado del proyecto

Este README describe la estructura actual del proyecto y reemplaza la documentación anterior que estaba basada en otra versión del backend.

