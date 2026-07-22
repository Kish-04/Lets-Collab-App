const fs = require('fs');
let content = fs.readFileSync('server/index.js', 'utf-8');

if (!content.includes("socket.on('permission-violation'")) {
    const violationHandler = `
    socket.on('permission-violation', (data) => {
      const { roomCode, action, controllerName, controllerEmail } = data;
      const room = rooms.get(roomCode);
      if (!room) return;
      
      const hostEmail = Array.from(room.controllers.values()).find(c => c.role === 'host')?.email || '';
      
      anchorEvent(
        roomCode,
        'PERMISSION_VIOLATION',
        { action, controller: controllerName, timestamp: nowTime() },
        hostEmail,
        controllerEmail || ''
      );
    });
`;
    // Find where socket events are defined for controllers
    // Let's insert it inside `io.on('connection', (socket) => {`
    // I will replace `socket.on('chat-message'` with `socket.on('chat-message', ...)\n` + violationHandler
    
    // First, let's just find `socket.on('chat-message'` and insert there
    const targetStr = "socket.on('chat-message', (data) => {";
    if (content.includes(targetStr)) {
        content = content.replace(targetStr, violationHandler + '\n    ' + targetStr);
        fs.writeFileSync('server/index.js', content);
        console.log('Backend patched with permission-violation event.');
    } else {
        console.log('Could not find socket.on("chat-message")');
    }
} else {
    console.log('permission-violation handler already exists.');
}
