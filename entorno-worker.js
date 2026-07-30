const { parentPort } = require('worker_threads');

let isDay = true;
let phaseTime = 0;
const DAY_DURATION = 15000;
const NIGHT_DURATION = 45000;
const CANVAS_WIDTH = 1280;
const CANVAS_HEIGHT = 720;

/*
| CICLO DIA / NOCHE
*/

setInterval(() => {
    phaseTime += 1000;

    if (isDay && phaseTime >= DAY_DURATION) {
        isDay = false;
        phaseTime = 0;
        parentPort.postMessage({
            type: 'DAY_NIGHT',
            payload: 'NIGHT'
        });
    }

    if (!isDay && phaseTime >= NIGHT_DURATION) {
        isDay = true;
        phaseTime = 0;
        parentPort.postMessage({
            type: 'DAY_NIGHT',
            payload: 'DAY'
        });
    }
}, 1000);

/*
| GENERACION DE RECURSOS (solo en el día)
*/

setInterval(() => {
    // Only generate resources during day
    if (isDay) {
        for (let i = 0; i < 2; i++) {
            const resource = {
                id: `${Date.now()}_${Math.random().toString(36).substr(2, 8)}`,
                type: 'WOOD',
                x: Math.floor(Math.random() * CANVAS_WIDTH),
                y: Math.floor(Math.random() * CANVAS_HEIGHT)
            };

            parentPort.postMessage({
                type: 'RESOURCE_CREATED',
                payload: resource
            });
        }
    }

}, 5000);