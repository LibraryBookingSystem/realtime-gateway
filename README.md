# Realtime Gateway

WebSocket gateway service for real-time updates in the library booking system.

## Overview

The Realtime Gateway provides WebSocket connections for real-time updates about:
- Resource availability changes
- Booking status updates
- System notifications

## Features

- WebSocket server on port 3008
- RabbitMQ integration for event consumption
- Broadcasts real-time updates to connected clients
- Automatic reconnection to RabbitMQ on failure

## Environment Variables

- `PORT`: WebSocket server port (default: 3008)
- `RABBITMQ_HOST`: RabbitMQ host (default: rabbitmq)
- `RABBITMQ_PORT`: RabbitMQ port (default: 5672)
- `RABBITMQ_USER`: RabbitMQ username (default: admin)
- `RABBITMQ_PASS`: RabbitMQ password (default: admin)

## Building and Running

The service is automatically built and started with docker-compose:

```bash
cd docker-compose
docker-compose up -d realtime-gateway
```

Or build it separately:

```bash
cd realtime-gateway
docker build -t library-realtime-gateway .
docker run -p 3008:3008 library-realtime-gateway
```

## WebSocket Protocol

### Client Messages

Subscribe to updates:
```json
{
  "type": "subscribe",
  "topic": "resource_123"
}
```

### Server Messages

Availability update:
```json
{
  "type": "availability_update",
  "resourceId": 123,
  "status": "available"
}
```

Connection confirmation:
```json
{
  "type": "connected",
  "message": "Connected to realtime gateway"
}
```

## Integration

The gateway is accessible via the API Gateway at:
- `ws://localhost:8080/ws/` (when proxied through API Gateway)
- `ws://localhost:3008` (direct connection)
