// const WebSocket = require('ws');

// const setupWebSocket = (server) => {
//     const wss = new WebSocket.Server({ server });

//     wss.on('connection', (ws) => {
//         console.log('New client connected');

//         ws.on('message', (message) => {
//             console.log(`Received: ${message}`);
//             // Broadcast to all clients
//             wss.clients.forEach((client) => {
//                 if (client.readyState === WebSocket.OPEN) {
//                     client.send(message);
//                 }
//             });
//         });

//         ws.on('close', () => {
//             console.log('Client disconnected');
//         });
//     });
// };

// module.exports = setupWebSocket;
