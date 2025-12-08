const WebSocket = require('ws');
const amqp = require('amqplib');

const PORT = process.env.PORT || 3008;
const RABBITMQ_HOST = process.env.RABBITMQ_HOST || 'rabbitmq';
const RABBITMQ_PORT = process.env.RABBITMQ_PORT || 5672;
const RABBITMQ_USER = process.env.RABBITMQ_USER || 'admin';
const RABBITMQ_PASS = process.env.RABBITMQ_PASS || 'admin';

let rabbitmqConnection = null;
let rabbitmqChannel = null;
const wss = new WebSocket.Server({ port: PORT });

// Connect to RabbitMQ
async function connectRabbitMQ() {
  try {
    const connectionString = `amqp://${RABBITMQ_USER}:${RABBITMQ_PASS}@${RABBITMQ_HOST}:${RABBITMQ_PORT}`;
    rabbitmqConnection = await amqp.connect(connectionString);
    rabbitmqChannel = await rabbitmqConnection.createChannel();
    
    console.log('Connected to RabbitMQ');
    
    // Set up exchange for real-time updates
    const exchange = 'library.realtime';
    await rabbitmqChannel.assertExchange(exchange, 'topic', { durable: false });
    
    // Listen for booking events
    const bookingQueue = 'realtime.booking';
    await rabbitmqChannel.assertQueue(bookingQueue, { durable: false });
    await rabbitmqChannel.bindQueue(bookingQueue, exchange, 'booking.*');
    
    // Listen for resource availability events
    const resourceQueue = 'realtime.resource';
    await rabbitmqChannel.assertQueue(resourceQueue, { durable: false });
    await rabbitmqChannel.bindQueue(resourceQueue, exchange, 'resource.*');
    
    // Consume messages and broadcast to WebSocket clients
    rabbitmqChannel.consume(bookingQueue, (msg) => {
      if (msg) {
        const content = JSON.parse(msg.content.toString());
        broadcastToClients({
          type: 'availability_update',
          resourceId: content.resourceId,
          status: content.status,
          ...content
        });
        rabbitmqChannel.ack(msg);
      }
    });
    
    rabbitmqChannel.consume(resourceQueue, (msg) => {
      if (msg) {
        const content = JSON.parse(msg.content.toString());
        broadcastToClients({
          type: 'availability_update',
          resourceId: content.resourceId,
          status: content.status,
          ...content
        });
        rabbitmqChannel.ack(msg);
      }
    });
    
  } catch (error) {
    console.error('Failed to connect to RabbitMQ:', error.message);
    // Retry connection after 5 seconds
    setTimeout(connectRabbitMQ, 5000);
  }
}

// Broadcast message to all connected WebSocket clients
function broadcastToClients(data) {
  const message = JSON.stringify(data);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

// Handle WebSocket connections
wss.on('connection', (ws, req) => {
  console.log('New WebSocket client connected');
  
  // Send welcome message
  ws.send(JSON.stringify({
    type: 'connected',
    message: 'Connected to realtime gateway'
  }));
  
  // Handle incoming messages from client
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message.toString());
      
      // Handle subscription requests
      if (data.type === 'subscribe' && data.topic) {
        console.log(`Client subscribed to: ${data.topic}`);
        ws.send(JSON.stringify({
          type: 'subscribed',
          topic: data.topic
        }));
      }
    } catch (error) {
      console.error('Error parsing client message:', error);
    }
  });
  
  // Handle client disconnect
  ws.on('close', () => {
    console.log('WebSocket client disconnected');
  });
  
  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

// Start server
console.log(`Realtime Gateway WebSocket server starting on port ${PORT}...`);
connectRabbitMQ();

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully...');
  wss.close();
  if (rabbitmqChannel) await rabbitmqChannel.close();
  if (rabbitmqConnection) await rabbitmqConnection.close();
  process.exit(0);
});
