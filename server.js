const WebSocket = require("ws");
const amqp = require("amqplib");

const PORT = process.env.PORT || 3008;
const RABBITMQ_HOST = process.env.RABBITMQ_HOST || "rabbitmq";
const RABBITMQ_PORT = process.env.RABBITMQ_PORT || 5672;
const RABBITMQ_USER = process.env.RABBITMQ_USER || "admin";
const RABBITMQ_PASS = process.env.RABBITMQ_PASS || "admin";

let rabbitmqConnection = null;
let rabbitmqChannel = null;
const wss = new WebSocket.Server({ port: PORT });

// Connect to RabbitMQ
async function connectRabbitMQ() {
  try {
    const connectionString = `amqp://${RABBITMQ_USER}:${RABBITMQ_PASS}@${RABBITMQ_HOST}:${RABBITMQ_PORT}`;
    rabbitmqConnection = await amqp.connect(connectionString);
    rabbitmqChannel = await rabbitmqConnection.createChannel();

    console.log("Connected to RabbitMQ");

    // Set up exchanges
    await rabbitmqChannel.assertExchange("booking.events", "topic", {
      durable: true,
    });
    await rabbitmqChannel.assertExchange("resource.events", "topic", {
      durable: true,
    });

    // Listen for booking events (from booking.events exchange)
    const bookingQueue = "realtime.booking";
    await rabbitmqChannel.assertQueue(bookingQueue, { durable: false });
    await rabbitmqChannel.bindQueue(
      bookingQueue,
      "booking.events",
      "booking.created"
    );
    await rabbitmqChannel.bindQueue(
      bookingQueue,
      "booking.events",
      "booking.updated"
    );
    await rabbitmqChannel.bindQueue(
      bookingQueue,
      "booking.events",
      "booking.canceled"
    );
    await rabbitmqChannel.bindQueue(
      bookingQueue,
      "booking.events",
      "booking.checked_in"
    );

    // Listen for resource events (from resource.events exchange)
    const resourceQueue = "realtime.resource";
    await rabbitmqChannel.assertQueue(resourceQueue, { durable: false });
    await rabbitmqChannel.bindQueue(
      resourceQueue,
      "resource.events",
      "resource.created"
    );
    await rabbitmqChannel.bindQueue(
      resourceQueue,
      "resource.events",
      "resource.updated"
    );
    await rabbitmqChannel.bindQueue(
      resourceQueue,
      "resource.events",
      "resource.deleted"
    );

    // Consume booking messages and broadcast to WebSocket clients
    rabbitmqChannel.consume(bookingQueue, (msg) => {
      if (msg) {
        try {
          const content = JSON.parse(msg.content.toString());
          // Extract resourceId from booking and determine availability
          const resourceId = content.resourceId;
          let status = "available";

          // Determine status based on booking status
          if (
            content.status === "CONFIRMED" ||
            content.status === "CHECKED_IN"
          ) {
            status = "unavailable";
          } else if (
            content.status === "CANCELED" ||
            content.status === "NO_SHOW"
          ) {
            status = "available";
          }

          // Ensure resourceId is a number
          const resourceIdNum =
            typeof resourceId === "string"
              ? parseInt(resourceId, 10)
              : resourceId;

          console.log(
            `Broadcasting availability update: resourceId=${resourceIdNum}, status=${status}, event=${msg.fields.routingKey}`
          );

          broadcastToClients({
            type: "availability_update",
            resourceId: resourceIdNum,
            status: status,
            bookingId: content.id,
            event: msg.fields.routingKey,
          });
          rabbitmqChannel.ack(msg);
        } catch (error) {
          console.error("Error processing booking message:", error);
          rabbitmqChannel.nack(msg, false, false);
        }
      }
    });

    // Consume resource messages and broadcast to WebSocket clients
    // Note: WebSockets are primarily for availability status updates
    // Resource creation/deletion should use refresh button instead
    rabbitmqChannel.consume(resourceQueue, (msg) => {
      if (msg) {
        try {
          const content = JSON.parse(msg.content.toString());
          const routingKey = msg.fields.routingKey;

          // Handle resource status updates (availability changes)
          if (routingKey === "resource.updated") {
            const resourceId = content.id;
            const status = content.status
              ? content.status.toLowerCase()
              : "available";
            console.log(
              `Broadcasting resource status update: id=${resourceId}, status=${status}`
            );
            // Send availability_update for status changes
            broadcastToClients({
              type: "availability_update",
              resourceId: resourceId,
              status: status,
              event: routingKey,
            });
          } else if (
            routingKey === "resource.created" ||
            routingKey === "resource.deleted"
          ) {
            // For resource creation/deletion, just log - users should use refresh button
            console.log(
              `Resource ${routingKey} event received - users should refresh to see changes`
            );
          }

          rabbitmqChannel.ack(msg);
        } catch (error) {
          console.error("Error processing resource message:", error);
          rabbitmqChannel.nack(msg, false, false);
        }
      }
    });
  } catch (error) {
    console.error("Failed to connect to RabbitMQ:", error.message);
    // Retry connection after 5 seconds
    setTimeout(connectRabbitMQ, 5000);
  }
}

// Broadcast message to all connected WebSocket clients
function broadcastToClients(data) {
  const message = JSON.stringify(data);
  let sentCount = 0;
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      try {
        client.send(message);
        sentCount++;
      } catch (error) {
        console.error("Error sending message to client:", error);
      }
    }
  });
  console.log(`Broadcasted to ${sentCount} client(s): ${message}`);
}

// Handle WebSocket connections
wss.on("connection", (ws, req) => {
  console.log(
    `New WebSocket client connected from ${req.socket.remoteAddress}`
  );

  // Send welcome message
  ws.send(
    JSON.stringify({
      type: "connected",
      message: "Connected to realtime gateway",
    })
  );

  console.log("Sent welcome message to client");

  // Handle incoming messages from client
  ws.on("message", (message) => {
    try {
      const data = JSON.parse(message.toString());

      // Handle subscription requests (support both 'topic' and 'event' fields)
      if (data.type === "subscribe" && (data.topic || data.event)) {
        const topic = data.topic || data.event;
        console.log(`Client subscribed to: ${topic}`);
        ws.send(
          JSON.stringify({
            type: "subscribed",
            topic: topic,
          })
        );
      }
    } catch (error) {
      console.error("Error parsing client message:", error);
    }
  });

  // Handle client disconnect
  ws.on("close", () => {
    console.log("WebSocket client disconnected");
  });

  ws.on("error", (error) => {
    console.error("WebSocket error:", error);
  });
});

// Start server
console.log(`Realtime Gateway WebSocket server starting on port ${PORT}...`);
connectRabbitMQ();

// Graceful shutdown
process.on("SIGTERM", async () => {
  console.log("SIGTERM received, shutting down gracefully...");
  wss.close();
  if (rabbitmqChannel) await rabbitmqChannel.close();
  if (rabbitmqConnection) await rabbitmqConnection.close();
  process.exit(0);
});
