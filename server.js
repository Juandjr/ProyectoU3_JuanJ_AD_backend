require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const bcrypt = require('bcryptjs');

const db = require('./db');
const logger = require('./logger');
const authRoutes = require('./routes/auth.routes');
const gameRoutes = require('./routes/game.routes');
const profileRoutes = require('./routes/profile.routes');
const authService = require('./services/auth.service');
const storeRoutes = require('./routes/store.routes');
const paymentsRoutes = require('./routes/payments.routes');
const gameRoomState = require('./game-room-state');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);

const io = new Server(server, {
    cors: { origin: '*' }
});

const PORT = process.env.PORT || 3000;

// Connect DB (non-blocking - server runs even if DB fails for development)
let dbConnected = false;
async function bootstrapDatabase() {
    try {
        await db.connect();
        dbConnected = true;
        logger.info('Database connection established');
    } catch (err) {
        logger.warn('Database connection failed - running in degraded mode', { error: err.message });
    }
}

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ ok: true, dbConnected });
});

// Mount routes
app.use('/api/auth', authRoutes);
app.use('/api', gameRoutes);
app.use('/api', profileRoutes);
app.use('/api/store', storeRoutes);
app.use('/api/payments', paymentsRoutes);

/*
| UTILIDADES Y SALAS
*/

function generateResourceId() {
    return `resource_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function getDifficultyConfig(difficulty = 'MEDIUM') {
    switch (difficulty) {
        case 'EASY':
            return {
                baseSpeed: 0.3,
                enemyCount: 1,
                fireDecayRate: 2,
                pointMultiplier: 10,
                dayDuration: 22000,
                nightDuration: 18000,
                resourceSpawnInterval: 2500,
                resourceSpawnCount: 1
            };
        case 'HARD':
            return {
                baseSpeed: 0.6,
                enemyCount: 3,
                fireDecayRate: 5,
                pointMultiplier: 25,
                dayDuration: 15000,
                nightDuration: 25000,
                resourceSpawnInterval: 1200,
                resourceSpawnCount: 3
            };
        case 'MEDIUM':
        default:
            return {
                baseSpeed: 0.45,
                enemyCount: 2,
                fireDecayRate: 3,
                pointMultiplier: 15,
                dayDuration: 18000,
                nightDuration: 22000,
                resourceSpawnInterval: 1800,
                resourceSpawnCount: 2
            };
    }
}

const activeSessions = {}; // Map of userId -> socket
const rooms = {};

function createRoom(id, name, maxPlayers, isPublic = false, passwordHash = null, difficulty = 'MEDIUM') {
    const config = getDifficultyConfig(difficulty);
    const baseSpeed = config.baseSpeed;
    const enemyCount = config.enemyCount;
    const fireDecayRate = config.fireDecayRate;
    const pointMultiplier = config.pointMultiplier;

    const enemies = [];
    for (let i = 0; i < enemyCount; i++) {
        // EASY/MEDIUM: all chaser, HARD: mix of ambusher and chaser
        const behaviorType = difficulty === 'HARD'
            ? (i % 2 === 0 ? 'ambusher' : 'chaser')
            : 'chaser';

        enemies.push({
            id: `enemy_${i + 1}`,
            x: 1000 + (i * 100),
            y: 360 + (i % 2 === 0 ? 50 : -50),
            baseSpeed,
            visible: false,
            behaviorType,
            drift: i * 0.18
        });
    }

    rooms[id] = {
        id,
        name,
        maxPlayers,
        isPublic,
        passwordHash,
        difficulty,
        fireDecayRate,
        pointMultiplier,
        players: {},
        worldState: {
            dayNight: 'DAY',
            resources: [],
            fire: {
                x: 640,
                y: 360,
                radius: 70,
                intensity: 100,
                maxIntensity: 100
            },
            cycleTime: 0,
            resourceSpawnTimer: 0,
            nightCount: 0,
            enemies
        }
    };
    return rooms[id];
}

function applyRoomDayNight(room, nextState) {
    if (!room || !room.worldState) return;
    if (room.worldState.dayNight === nextState) return;

    room.worldState.dayNight = nextState;
    room.worldState.enemies.forEach(enemy => {
        enemy.visible = nextState === 'NIGHT';
        if (nextState === 'NIGHT') {
            room.worldState.nightCount += 1;
        }
    });

    io.to(room.id).emit('dayNightChanged', room.worldState.dayNight);
    io.to(room.id).emit('enemiesUpdated', room.worldState.enemies);
}

function spawnResourcesForRoom(room) {
    if (!room || !room.worldState || room.worldState.dayNight !== 'DAY') return;

    const config = getDifficultyConfig(room.difficulty);
    for (let i = 0; i < config.resourceSpawnCount; i++) {
        const resource = {
            id: generateResourceId(),
            type: 'WOOD',
            x: Math.floor(Math.random() * 1280),
            y: Math.floor(Math.random() * 720)
        };
        room.worldState.resources.push(resource);
        io.to(room.id).emit('resourceCreated', resource);
    }
}

// 3 Salas Públicas por defecto (Fácil, Intermedia, Difícil)
createRoom('public-1', 'Sala 1 - Fácil', 4, true, null, 'EASY');
createRoom('public-2', 'Sala 2 - Intermedia', 4, true, null, 'MEDIUM');
createRoom('public-3', 'Sala 3 - Difícil', 4, true, null, 'HARD');

Object.values(rooms).forEach(room => spawnResourcesForRoom(room));

function getRoomsList() {
    return Object.values(rooms).map(r => ({
        id: r.id,
        name: r.name,
        currentPlayers: Object.keys(r.players).length,
        maxPlayers: r.maxPlayers,
        isPublic: r.isPublic,
        hasPassword: !!r.passwordHash,
        difficulty: r.difficulty || 'MEDIUM'
    }));
}

/*
| CICLO DIA / NOCHE Y RECURSOS POR SALA
*/

setInterval(() => {
    Object.values(rooms).forEach(room => {
        const config = getDifficultyConfig(room.difficulty);
        room.worldState.cycleTime = (room.worldState.cycleTime || 0) + 1000;
        room.worldState.resourceSpawnTimer = (room.worldState.resourceSpawnTimer || 0) + 1000;

        const isDay = room.worldState.dayNight === 'DAY';
        const phaseDuration = isDay ? config.dayDuration : config.nightDuration;

        if (room.worldState.cycleTime >= phaseDuration) {
            room.worldState.cycleTime = 0;
            const nextState = isDay ? 'NIGHT' : 'DAY';
            applyRoomDayNight(room, nextState);
        }

        if (room.worldState.dayNight === 'DAY' && room.worldState.resourceSpawnTimer >= config.resourceSpawnInterval) {
            room.worldState.resourceSpawnTimer = 0;
            spawnResourcesForRoom(room);
        }
    });
}, 1000);

// Decaimiento de fogata por sala según la dificultad
setInterval(() => {
    Object.values(rooms).forEach(room => {
        if (room.worldState.fire.intensity > 0) {
            const decay = room.fireDecayRate || 3;
            room.worldState.fire.intensity = clamp(room.worldState.fire.intensity - decay, 0, room.worldState.fire.maxIntensity);
            io.to(room.id).emit('fireUpdated', room.worldState.fire);
        }
    });
}, 5000);

/*
| SOCKETS
*/

io.use((socket, next) => {
    const token = socket.handshake.auth && socket.handshake.auth.token;
    if (!token) return next(new Error('Authentication error'));
    try {
        const payload = authService.verifyToken(token);
        socket.user = { id: payload.sub, username: payload.username };
        next();
    } catch (err) {
        logger.warn('Socket JWT invalid', { err: err.message });
        return next(new Error('Authentication error'));
    }
});

function leaveRoomInternal(socket) {
    const roomId = socket.currentRoomId;
    if (!roomId || !rooms[roomId]) return;
    const userId = socket.user && socket.user.id;

    const room = rooms[roomId];
    delete room.players[socket.id];
    socket.leave(roomId);
    socket.currentRoomId = null;

    // Evitar que quede asociada la última sala/dificultad del usuario al salir
    if (userId) {
        gameRoomState.clearUserRoom(userId);
    }

    io.to(roomId).emit('playersUpdated', room.players);

    // Si es sala personalizada y quedó vacía, eliminarla
    if (!room.isPublic && Object.keys(room.players).length === 0) {
        delete rooms[roomId];
    }

    io.emit('roomsUpdated', getRoomsList());
}

io.on('connection', (socket) => {
    const userId = socket.user && socket.user.id;
    if (userId) {
        if (activeSessions[userId]) {
            const oldSocket = activeSessions[userId];
            oldSocket.emit('forceDisconnect', { message: 'Se ha iniciado sesión desde otro dispositivo.' });
            oldSocket.disconnect(true);
            logger.info(`Desconectando socket anterior ${oldSocket.id} para usuario ${userId}`);
        }
        activeSessions[userId] = socket;
    }

    logger.info(`Jugador conectado: ${socket.id}`, { user: socket.user });

    // Enviar lista inicial de salas al conectarse
    socket.emit('roomsUpdated', getRoomsList());

    socket.on('getRooms', (callback) => {
        if (typeof callback === 'function') {
            callback(getRoomsList());
        } else {
            socket.emit('roomsUpdated', getRoomsList());
        }
    });

    socket.on('createRoom', async ({ name, maxPlayers, password, difficulty }, callback) => {
        const limit = Math.min(6, Math.max(2, parseInt(maxPlayers, 10) || 4));
        const roomName = (name || 'Nueva Sala').trim().substring(0, 30);
        const roomId = `custom_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
        const diff = ['EASY', 'MEDIUM', 'HARD'].includes(difficulty) ? difficulty : 'MEDIUM';

        let passwordHash = null;
        if (password && password.trim().length > 0) {
            passwordHash = await bcrypt.hash(password.trim(), 10);
        }

        createRoom(roomId, roomName, limit, false, passwordHash, diff);

        logger.info(`Sala personalizada creada: ${roomName} (${roomId}), max: ${limit}, difficulty: ${diff}, hasPassword: ${!!passwordHash}`);
        io.emit('roomsUpdated', getRoomsList());

        if (typeof callback === 'function') {
            callback({ success: true, roomId, difficulty: diff });
        }
    });

    socket.on('joinRoom', async ({ roomId, password }, callback) => {
        const room = rooms[roomId];
        if (!room) {
            if (typeof callback === 'function') callback({ success: false, error: 'La sala no existe' });
            return;
        }

        // Validate password if room is protected
        if (room.passwordHash) {
            if (!password || !(await bcrypt.compare(password.trim(), room.passwordHash))) {
                if (typeof callback === 'function') callback({ success: false, error: 'Contraseña incorrecta' });
                return;
            }
        }

        if (Object.keys(room.players).length >= room.maxPlayers) {
            if (typeof callback === 'function') callback({ success: false, error: 'La sala está llena' });
            return;
        }

        if (socket.currentRoomId) {
            leaveRoomInternal(socket);
        }

        socket.join(roomId);
        socket.currentRoomId = roomId;

        // Cargar cosmético equipado del usuario
        let cosmeticColor = null;
        let cosmeticIcon = null;
        try {
            if (dbConnected && userId) {
                const pool = db.getPool();
                const { rows: userRows } = await pool.query('SELECT "equippedCosmeticId" FROM public.users WHERE id = $1', [userId]);
                const equippedId = userRows[0]?.equippedCosmeticId || null;
                if (equippedId) {
                    const { rows: cosRows } = await pool.query('SELECT color, "imageUrl" FROM public.cosmetics WHERE id = $1', [equippedId]);
                    cosmeticColor = cosRows[0]?.color || null;
                    cosmeticIcon = cosRows[0]?.imageUrl || null;
                }
            }
        } catch (e) {
            logger.warn('Could not load cosmetic for player', { err: e.message });
        }

        room.players[socket.id] = {
            id: socket.id,
            x: 100,
            y: 100,
            vx: 0,
            vy: 0,
            collected: 0,
            score: 0,
            username: socket.user && socket.user.username,
            cosmeticColor,
            cosmeticIcon
        };

        if (userId) {
            gameRoomState.setUserRoom(userId, roomId, room.difficulty || 'MEDIUM');
        }

        socket.emit('initialWorldState', {
            players: room.players,
            resources: room.worldState.resources,
            dayNight: room.worldState.dayNight,
            fire: room.worldState.fire,
            enemies: room.worldState.enemies,
            difficulty: room.difficulty || 'MEDIUM'
        });

        io.to(roomId).emit('playersUpdated', room.players);
        io.emit('roomsUpdated', getRoomsList());

        logger.info(`Jugador ${socket.id} se unió a la sala ${roomId}`);

        if (typeof callback === 'function') callback({ success: true, roomId, difficulty: room.difficulty || 'MEDIUM' });
    });

    socket.on('leaveRoom', () => {
        leaveRoomInternal(socket);
    });

    socket.on('playerMove', (position) => {
        const roomId = socket.currentRoomId;
        if (!roomId || !rooms[roomId]) return;
        const room = rooms[roomId];
        const player = room.players[socket.id];
        if (!player) return;

        const previousX = player.x || 0;
        const previousY = player.y || 0;
        const now = Date.now();
        const deltaMs = Math.max(16, (player.lastMoveAt ? now - player.lastMoveAt : 16));
        const seconds = deltaMs / 1000;

        player.x = position.x;
        player.y = position.y;
        player.vx = seconds > 0 ? (player.x - previousX) / seconds : 0;
        player.vy = seconds > 0 ? (player.y - previousY) / seconds : 0;
        player.lastMoveAt = now;

        io.to(roomId).emit('playersUpdated', room.players);
    });

    socket.on('resourceCollected', (data) => {
        const roomId = socket.currentRoomId;
        if (!roomId || !rooms[roomId] || !data.resourceId) return;
        const room = rooms[roomId];

        room.worldState.resources = room.worldState.resources.filter(r => r.id !== data.resourceId);
        if (room.players[socket.id]) {
            room.players[socket.id].collected = (room.players[socket.id].collected || 0) + 1;
        }

        io.to(roomId).emit('resourceCollected', { playerId: socket.id, resourceId: data.resourceId });
        io.to(roomId).emit('playersUpdated', room.players);
    });

    socket.on('requestInitialWorldState', () => {
        const roomId = socket.currentRoomId;
        if (!roomId || !rooms[roomId]) return;
        const room = rooms[roomId];

        socket.emit('initialWorldState', {
            players: room.players,
            resources: room.worldState.resources,
            dayNight: room.worldState.dayNight,
            fire: room.worldState.fire,
            enemies: room.worldState.enemies,
            difficulty: room.difficulty || 'MEDIUM'
        });
    });

    socket.on('playerDied', () => {
        const roomId = socket.currentRoomId;
        if (!roomId || !rooms[roomId]) return;

        leaveRoomInternal(socket);
        io.to(roomId).emit('playersUpdated', rooms[roomId] ? rooms[roomId].players : {});
        io.emit('roomsUpdated', getRoomsList());
    });

    socket.on('depositResources', () => {
        const roomId = socket.currentRoomId;
        if (!roomId || !rooms[roomId]) return;
        const room = rooms[roomId];

        if (!room.players[socket.id]) return;
        const inventory = room.players[socket.id].collected || 0;
        if (inventory <= 0) return;

        const multiplier = room.pointMultiplier || 10;
        const points = inventory * multiplier;
        room.players[socket.id].score = (room.players[socket.id].score || 0) + points;
        room.players[socket.id].collected = 0;
        room.worldState.fire.intensity = clamp(room.worldState.fire.intensity + inventory * 12, 0, room.worldState.fire.maxIntensity);

        io.to(roomId).emit('playersUpdated', room.players);
        io.to(roomId).emit('fireUpdated', room.worldState.fire);
    });

    socket.on('disconnect', () => {
        logger.info(`Jugador desconectado: ${socket.id}`);
        leaveRoomInternal(socket);
        if (userId && activeSessions[userId] && activeSessions[userId].id === socket.id) {
            delete activeSessions[userId];
        }
    });
});

// Loop IA Enemigos por Sala
setInterval(() => {
    const now = Date.now();
    Object.values(rooms).forEach(room => {
        const enemies = room.worldState.enemies;
        const playerList = Object.values(room.players);

        if (!enemies || enemies.length === 0) return;
        if (room.worldState.dayNight === 'DAY') return;
        if (!playerList || playerList.length === 0) return;

        enemies.forEach(enemy => {
            if (!enemy.visible) return;

            let nearest = null;
            let minDistSq = Infinity;
            let targetDx = 0;
            let targetDy = 0;

            playerList.forEach(p => {
                const dx = (p.x || 0) - enemy.x;
                const dy = (p.y || 0) - enemy.y;
                const distSq = dx * dx + dy * dy;

                if (distSq < minDistSq) {
                    minDistSq = distSq;
                    nearest = p;
                    targetDx = dx;
                    targetDy = dy;
                }
            });

            if (!nearest) return;

            const actualDist = Math.sqrt(minDistSq) || 1;
            const baseSpeed = enemy.baseSpeed || 0.3;
            const firePressure = (room.worldState.fire.intensity || 0) <= 0 ? 1.5 : 1;
            const difficultyFactor = room.difficulty === 'HARD' ? 1.3 : room.difficulty === 'MEDIUM' ? 1.1 : 1;
            let speed = baseSpeed * 8 * firePressure * difficultyFactor;

            let nx = targetDx / actualDist;
            let ny = targetDy / actualDist;

            if (enemy.behaviorType === 'ambusher') {
                const patrolCycle = 12000;
                const cyclePos = (now + enemy.drift * 1000) % patrolCycle;
                const waitTime = 7000;
                
                if (cyclePos < waitTime) {
                    const patrolAngle = Math.sin((now + enemy.drift) / 2000) * Math.PI * 0.3;
                    const lateralX = Math.cos(patrolAngle) * 0.3;
                    const lateralY = Math.sin(patrolAngle) * 0.3;
                    nx = nx * 0.4 + lateralX;
                    ny = ny * 0.4 + lateralY;
                } else {
                    const burstStrength = room.difficulty === 'HARD' ? 1.8 : 1.3;
                    nx *= burstStrength;
                    ny *= burstStrength;
                    const lateralX = -ny * 0.5;
                    const lateralY = nx * 0.5;
                    nx += lateralX;
                    ny += lateralY;
                }
            }

            if (enemy.behaviorType === 'chaser') {
                // Chaser es directo y agresivo: persigue constantemente sin patrones erráticos
                // Solo amplifica el vector de persecución según dificultad
                const aggressionFactor = room.difficulty === 'HARD' ? 1.5 : 1.1;
                nx *= aggressionFactor;
                ny *= aggressionFactor;
            }

            const magnitude = Math.sqrt(nx * nx + ny * ny) || 1;
            nx /= magnitude;
            ny /= magnitude;

            let newX = enemy.x + nx * speed;
            let newY = enemy.y + ny * speed;

            // Evitar sobreposición entre enemigos
            const enemyRadius = 12;
            for (const otherEnemy of enemies) {
                if (otherEnemy.id === enemy.id || !otherEnemy.visible) continue;
                const dx = newX - otherEnemy.x;
                const dy = newY - otherEnemy.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                const minDist = enemyRadius * 2 + 5; // 5 píxeles de separación
                
                if (dist < minDist) {
                    // Repeler enemy de otherEnemy
                    const angle = Math.atan2(dy, dx);
                    newX = otherEnemy.x + Math.cos(angle) * minDist;
                    newY = otherEnemy.y + Math.sin(angle) * minDist;
                }
            }

            enemy.x = clamp(newX, 0, 1280);
            enemy.y = clamp(newY, 0, 720);
            enemy.targetId = nearest.id;
        });

        io.to(room.id).emit('enemiesUpdated', room.worldState.enemies);
    });
}, 50);

function startServer(port, attempt = 1) {
    server.once('error', (err) => {
        if (err.code === 'EADDRINUSE' && attempt < 3) {
            const nextPort = Number(port) + 1;
            logger.warn(`Puerto ${port} ocupado, intentando ${nextPort}`);
            startServer(nextPort, attempt + 1);
            return;
        }

        logger.error('Error al iniciar el servidor', { error: err.message });
        process.exit(1);
    });

    server.listen(port, () => {
        logger.info(`Servidor iniciado en puerto ${port}`);
    });
}

async function bootstrap() {
    await bootstrapDatabase();
    startServer(PORT);
}

bootstrap();
