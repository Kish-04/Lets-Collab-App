const io = require('socket.io-client');

const socket = io('http://localhost:3001');

socket.on('connect', () => {
  console.log('Connected to backend as test client:', socket.id);
  
  // 1. Authenticate (identify-user)
  socket.emit('identify-user', 'test-host@example.com');
  
  // 2. Create room
  socket.emit('create-room', { mode: 'collaboration', name: 'Test Host' });
});

socket.on('session-state', (state) => {
  const code = state.roomCode;
  if (!code) return;
  console.log('Room created successfully. Code:', code);
  
  // Emit violation to this room
  const violationData = {
    roomCode: code,
    action: 'mousedown (attempted click)',
    controllerName: 'Hacker123',
    controllerEmail: 'hacker@example.com'
  };
  
  console.log('Emitting permission-violation event:', violationData);
  socket.emit('permission-violation', violationData);
  
  setTimeout(() => {
    console.log('Test complete, disconnecting.');
    socket.disconnect();
    process.exit(0);
  }, 2000);
});

socket.on('connect_error', (err) => {
  console.error('Connection error:', err);
  process.exit(1);
});
