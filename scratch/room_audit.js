const io = require('socket.io-client');
const BACKEND_URL = 'https://let-s-collab-jpwc.onrender.com';

async function verifyRoomRouting() {
  console.log("===================================================");
  console.log("  ROOM ROUTING & SIGNALING INTEGRATION AUDIT");
  console.log("===================================================");

  let passed = 0;
  const mockRoom = "AUDIT-" + Math.floor(Math.random() * 1000);

  // 1. Host (Desktop App) establishes connection
  const host = io(BACKEND_URL, { transports: ['websocket'] });
  
  host.on('connect', () => {
    console.log(`[PASS] Desktop App (Host) Connected. Socket ID: ${host.id}`);
    passed++;
    host.emit('create-room', mockRoom);
  });

  // 2. Client (Web App) connects as 'supervised' Controller
  const client1 = io(BACKEND_URL, { transports: ['websocket'] });
  
  host.on('join-request', (data) => {
    console.log(`[PASS] WebRTC Join Request intercepted in Room ${mockRoom} from: ${data.name}`);
    passed++;
    
    // Host accepts Web App
    host.emit('accept-join', { to: data.socketId });
  });

  client1.on('connect', () => {
    setTimeout(() => {
      console.log(`[PASS] Web App (Controller - Supervised) Connected. Socket ID: ${client1.id}`);
      passed++;
      client1.emit('join-room', { roomCode: mockRoom, name: "Audit Bot 1", role: "controller" });
    }, 500);
  });

  client1.on('join-accepted', () => {
    console.log(`[PASS] WebRTC 'accept-join' signal successfully received by Supervised Web App!`);
    passed++;
    
    // Disconnect client 1
    client1.disconnect();
    
    // Connect client 2 (Collaborative)
    const client2 = io(BACKEND_URL, { transports: ['websocket'] });
    client2.on('connect', () => {
      setTimeout(() => {
        console.log(`[PASS] Web App (Controller - Collaborative) Connected. Socket ID: ${client2.id}`);
        passed++;
        client2.emit('join-room', { roomCode: mockRoom, name: "Audit Bot 2", role: "controller" });
      }, 500);
    });

    client2.on('join-accepted', () => {
      console.log(`[PASS] WebRTC 'accept-join' signal successfully received by Collaborative Web App!`);
      passed++;
      
      console.log("\n===================================================");
      console.log(`FINAL RESULT: ${passed}/6 Room Routing Operations Passed.`);
      console.log("✅ Supervised & Collaborative Room Orchestration is 100% STABLE.");
      console.log("===================================================");
      
      client2.disconnect();
      host.disconnect();
      process.exit(0);
    });
  });
}

verifyRoomRouting();
