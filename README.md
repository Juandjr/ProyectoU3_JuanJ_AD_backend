# ProyectoInd_JuanJ

Multiplayer web game built with an Angular frontend and a Node.js backend.
The project includes:

- email and password authentication
- code verification and password recovery
- MFA
- real-time multiplayer rooms with `Socket.IO`
- scoreboard
- user profile
- cosmetic store
- PayPal and PayPhone payments
- avatar upload to remote storage

## Repository Structure

- `backend/`: REST API, sockets, and game logic
- `frontend/`: Angular application
- `main.tex`: main report document
- `Informe_Proyecto_JuanJ_Actualizado_editado.docx`: editable report version

## Technologies

- Backend: Node.js, Express, Socket.IO, PostgreSQL, JWT, bcryptjs, dotenv
- Frontend: Angular 21, TypeScript, RxJS, Socket.IO Client
- Integrations: Supabase, Vercel Blob, PayPal, PayPhone, Google OAuth, SMTP email

## Requirements

- Node.js 18 or newer
- npm
- PostgreSQL database accessible from the backend
- Environment variables configured in `backend/.env`

## Backend Setup

1. Go to the backend folder:

```bash
cd backend
```

2. Install dependencies:

```bash
npm install
```

3. Create the environment file from the example:

```bash
copy .env.example .env
```

4. Fill in the variables for your environment. The most important ones are:

- `JWT_SECRET`
- `PORT`
- `BASE_URL`
- email credentials for verification and recovery
- Google OAuth credentials
- PayPal credentials
- PayPhone credentials

### Run the Backend

```bash
npm start
```

By default, the server runs at `http://localhost:3000`.

### Backend Health Check

```bash
curl http://localhost:3000/api/health
```

Expected response:

```json
{ "ok": true, "dbConnected": true }
```

If the database does not respond, the server can still stay up in degraded mode for socket testing and local development.

## Frontend Setup

1. Go to the frontend folder:

```bash
cd frontend
```

2. Install dependencies:

```bash
npm install
```

3. Run the app:

```bash
npm start
```

The Angular app usually runs at `http://localhost:4200`.

The frontend uses `src/app/utils/backend-config.ts` to point to the local backend or to Render/Railway/Vercel deployments.

## Main Frontend Routes

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

## Main Backend Routes

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

## Real-Time Game

The backend keeps three default public rooms:

- `public-1` - easy
- `public-2` - medium
- `public-3` - hard

It also allows custom rooms with passwords and difficulty settings.
Game communication is handled with `Socket.IO` for:

- joining and leaving rooms
- moving players
- collecting resources
- depositing resources for score
- updating the campfire
- switching between day and night
- syncing enemies and world state

## Important Backend Folders

- `controllers/`: endpoint logic
- `routes/`: HTTP route definitions
- `services/`: authentication and payment services
- `middleware/`: validation and auth
- `models/`: data structures and models
- `logs/`: log files

## Usage Notes

- The backend server does not stop if the database fails on startup; it logs the error and continues in degraded mode.
- The frontend lets you select the backend from browser local storage.
- Avatar upload uses `Vercel Blob`.

## Development

To work on both sides, open two terminals:

```bash
cd backend
npm start
```

```bash
cd frontend
npm start
```

## Project Status

This README reflects the current project structure and replaces the previous documentation that was based on an older backend version.
