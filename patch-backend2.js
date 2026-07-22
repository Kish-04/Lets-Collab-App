const fs = require('fs');
let content = fs.readFileSync('server/index.js', 'utf-8');

if (!content.includes("socket.on('permission-violation'")) {
    const violationHandler = `
  socket.on('permission-violation', (data) => {
    const { roomCode, action, controllerName, controllerEmail } = data;
    const room = rooms.get(roomCode);
    if (!room) return;
    
    pushEvent(roomCode, 'permission', \`\${controllerName}'s input was blocked (\${action})\`);
    
    anchorEvent(
      roomCode,
      'PERMISSION_VIOLATION',
      { action, controller: controllerName, timestamp: nowTime() },
      room.hostEmail || '',
      controllerEmail || ''
    );
    emitRoomState(roomCode);
  });
`;
    content = content.replace("  socket.on('disconnect', async () => {", violationHandler + "\n  socket.on('disconnect', async () => {");
    fs.writeFileSync('server/index.js', content);
    console.log('Backend patched with permission-violation event.');
} else {
    console.log('permission-violation handler already exists.');
}
